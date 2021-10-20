"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const toolrunnner = __importStar(require("@actions/exec/lib/toolrunner"));
const http = __importStar(require("@actions/http-client"));
const toolcache = __importStar(require("@actions/tool-cache"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const semver = __importStar(require("semver"));
const stream = __importStar(require("stream"));
const globalutil = __importStar(require("util"));
const v4_1 = __importDefault(require("uuid/v4"));
const api = __importStar(require("./api-client"));
const defaults = __importStar(require("./defaults.json")); // Referenced from codeql-action-sync-tool!
const error_matcher_1 = require("./error-matcher");
const toolrunner_error_catcher_1 = require("./toolrunner-error-catcher");
const util = __importStar(require("./util"));
/**
 * Stores the CodeQL object, and is populated by `setupCodeQL` or `getCodeQL`.
 * Can be overridden in tests using `setCodeQL`.
 */
let cachedCodeQL = undefined;
const CODEQL_BUNDLE_VERSION = defaults.bundleVersion;
const CODEQL_BUNDLE_NAME = "codeql-bundle.tar.gz";
const CODEQL_DEFAULT_ACTION_REPOSITORY = "github/codeql-action";
function getCodeQLActionRepository(mode) {
    if (mode !== "actions") {
        return CODEQL_DEFAULT_ACTION_REPOSITORY;
    }
    // Actions do not know their own repository name,
    // so we currently use this hack to find the name based on where our files are.
    // This can be removed once the change to the runner in https://github.com/actions/runner/pull/585 is deployed.
    const runnerTemp = util.getRequiredEnvParam("RUNNER_TEMP");
    const actionsDirectory = path.join(path.dirname(runnerTemp), "_actions");
    const relativeScriptPath = path.relative(actionsDirectory, __filename);
    // This handles the case where the Action does not come from an Action repository,
    // e.g. our integration tests which use the Action code from the current checkout.
    if (relativeScriptPath.startsWith("..") ||
        path.isAbsolute(relativeScriptPath)) {
        return CODEQL_DEFAULT_ACTION_REPOSITORY;
    }
    const relativeScriptPathParts = relativeScriptPath.split(path.sep);
    return `${relativeScriptPathParts[0]}/${relativeScriptPathParts[1]}`;
}
async function getCodeQLBundleDownloadURL(githubAuth, githubUrl, mode, logger) {
    const codeQLActionRepository = getCodeQLActionRepository(mode);
    const potentialDownloadSources = [
        // This GitHub instance, and this Action.
        [githubUrl, codeQLActionRepository],
        // This GitHub instance, and the canonical Action.
        [githubUrl, CODEQL_DEFAULT_ACTION_REPOSITORY],
        // GitHub.com, and the canonical Action.
        [util.GITHUB_DOTCOM_URL, CODEQL_DEFAULT_ACTION_REPOSITORY],
    ];
    // We now filter out any duplicates.
    // Duplicates will happen either because the GitHub instance is GitHub.com, or because the Action is not a fork.
    const uniqueDownloadSources = potentialDownloadSources.filter((url, index, self) => index === self.indexOf(url));
    for (const downloadSource of uniqueDownloadSources) {
        const [apiURL, repository] = downloadSource;
        // If we've reached the final case, short-circuit the API check since we know the bundle exists and is public.
        if (apiURL === util.GITHUB_DOTCOM_URL &&
            repository === CODEQL_DEFAULT_ACTION_REPOSITORY) {
            break;
        }
        const [repositoryOwner, repositoryName] = repository.split("/");
        try {
            const release = await api
                .getApiClient(githubAuth, githubUrl)
                .repos.getReleaseByTag({
                owner: repositoryOwner,
                repo: repositoryName,
                tag: CODEQL_BUNDLE_VERSION,
            });
            for (const asset of release.data.assets) {
                if (asset.name === CODEQL_BUNDLE_NAME) {
                    logger.info(`Found CodeQL bundle in ${downloadSource[1]} on ${downloadSource[0]} with URL ${asset.url}.`);
                    return asset.url;
                }
            }
        }
        catch (e) {
            logger.info(`Looked for CodeQL bundle in ${downloadSource[1]} on ${downloadSource[0]} but got error ${e}.`);
        }
    }
    return `https://github.com/${CODEQL_DEFAULT_ACTION_REPOSITORY}/releases/download/${CODEQL_BUNDLE_VERSION}/${CODEQL_BUNDLE_NAME}`;
}
// We have to download CodeQL manually because the toolcache doesn't support Accept headers.
// This can be removed once https://github.com/actions/toolkit/pull/530 is merged and released.
async function toolcacheDownloadTool(url, headers, tempDir, logger) {
    const client = new http.HttpClient("CodeQL Action");
    const dest = path.join(tempDir, v4_1.default());
    const response = await client.get(url, headers);
    if (response.message.statusCode !== 200) {
        logger.info(`Failed to download from "${url}". Code(${response.message.statusCode}) Message(${response.message.statusMessage})`);
        throw new Error(`Unexpected HTTP response: ${response.message.statusCode}`);
    }
    const pipeline = globalutil.promisify(stream.pipeline);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await pipeline(response.message, fs.createWriteStream(dest));
    return dest;
}
async function setupCodeQL(codeqlURL, githubAuth, githubUrl, tempDir, toolsDir, mode, logger) {
    // Setting these two env vars makes the toolcache code safe to use outside,
    // of actions but this is obviously not a great thing we're doing and it would
    // be better to write our own implementation to use outside of actions.
    process.env["RUNNER_TEMP"] = tempDir;
    process.env["RUNNER_TOOL_CACHE"] = toolsDir;
    try {
        const codeqlURLVersion = getCodeQLURLVersion(codeqlURL || `/${CODEQL_BUNDLE_VERSION}/`, logger);
        let codeqlFolder = toolcache.find("CodeQL", codeqlURLVersion);
        if (codeqlFolder) {
            logger.debug(`CodeQL found in cache ${codeqlFolder}`);
        }
        else {
            if (!codeqlURL) {
                codeqlURL = await getCodeQLBundleDownloadURL(githubAuth, githubUrl, mode, logger);
            }
            const headers = { accept: "application/octet-stream" };
            // We only want to provide an authorization header if we are downloading
            // from the same GitHub instance the Action is running on.
            // This avoids leaking Enterprise tokens to dotcom.
            if (codeqlURL.startsWith(`${githubUrl}/`)) {
                logger.debug("Downloading CodeQL bundle with token.");
                headers.authorization = `token ${githubAuth}`;
            }
            else {
                logger.debug("Downloading CodeQL bundle without token.");
            }
            logger.info(`Downloading CodeQL tools from ${codeqlURL}. This may take a while.`);
            const codeqlPath = await toolcacheDownloadTool(codeqlURL, headers, tempDir, logger);
            logger.debug(`CodeQL bundle download to ${codeqlPath} complete.`);
            const codeqlExtracted = await toolcache.extractTar(codeqlPath);
            codeqlFolder = await toolcache.cacheDir(codeqlExtracted, "CodeQL", codeqlURLVersion);
        }
        let codeqlCmd = path.join(codeqlFolder, "codeql", "codeql");
        if (process.platform === "win32") {
            codeqlCmd += ".exe";
        }
        else if (process.platform !== "linux" && process.platform !== "darwin") {
            throw new Error(`Unsupported platform: ${process.platform}`);
        }
        cachedCodeQL = getCodeQLForCmd(codeqlCmd);
        return cachedCodeQL;
    }
    catch (e) {
        logger.error(e);
        throw new Error("Unable to download and extract CodeQL CLI");
    }
}
exports.setupCodeQL = setupCodeQL;
function getCodeQLURLVersion(url, logger) {
    const match = url.match(/\/codeql-bundle-(.*)\//);
    if (match === null || match.length < 2) {
        throw new Error(`Malformed tools url: ${url}. Version could not be inferred`);
    }
    let version = match[1];
    if (!semver.valid(version)) {
        logger.debug(`Bundle version ${version} is not in SemVer format. Will treat it as pre-release 0.0.0-${version}.`);
        version = `0.0.0-${version}`;
    }
    const s = semver.clean(version);
    if (!s) {
        throw new Error(`Malformed tools url ${url}. Version should be in SemVer format but have ${version} instead`);
    }
    return s;
}
exports.getCodeQLURLVersion = getCodeQLURLVersion;
/**
 * Use the CodeQL executable located at the given path.
 */
function getCodeQL(cmd) {
    if (cachedCodeQL === undefined) {
        cachedCodeQL = getCodeQLForCmd(cmd);
    }
    return cachedCodeQL;
}
exports.getCodeQL = getCodeQL;
function resolveFunction(partialCodeql, methodName, defaultImplementation) {
    if (typeof partialCodeql[methodName] !== "function") {
        if (defaultImplementation !== undefined) {
            return defaultImplementation;
        }
        const dummyMethod = () => {
            throw new Error(`CodeQL ${methodName} method not correctly defined`);
        };
        return dummyMethod;
    }
    return partialCodeql[methodName];
}
/**
 * Set the functionality for CodeQL methods. Only for use in tests.
 *
 * Accepts a partial object and any undefined methods will be implemented
 * to immediately throw an exception indicating which method is missing.
 */
function setCodeQL(partialCodeql) {
    cachedCodeQL = {
        getPath: resolveFunction(partialCodeql, "getPath", () => "/tmp/dummy-path"),
        printVersion: resolveFunction(partialCodeql, "printVersion"),
        getTracerEnv: resolveFunction(partialCodeql, "getTracerEnv"),
        databaseInit: resolveFunction(partialCodeql, "databaseInit"),
        runAutobuild: resolveFunction(partialCodeql, "runAutobuild"),
        extractScannedLanguage: resolveFunction(partialCodeql, "extractScannedLanguage"),
        finalizeDatabase: resolveFunction(partialCodeql, "finalizeDatabase"),
        resolveQueries: resolveFunction(partialCodeql, "resolveQueries"),
        databaseAnalyze: resolveFunction(partialCodeql, "databaseAnalyze"),
    };
    return cachedCodeQL;
}
exports.setCodeQL = setCodeQL;
/**
 * Get the cached CodeQL object. Should only be used from tests.
 *
 * TODO: Work out a good way for tests to get this from the test context
 * instead of having to have this method.
 */
function getCachedCodeQL() {
    if (cachedCodeQL === undefined) {
        // Should never happen as setCodeQL is called by testing-utils.setupTests
        throw new Error("cachedCodeQL undefined");
    }
    return cachedCodeQL;
}
exports.getCachedCodeQL = getCachedCodeQL;
function getCodeQLForCmd(cmd) {
    return {
        getPath() {
            return cmd;
        },
        async printVersion() {
            await new toolrunnner.ToolRunner(cmd, [
                "version",
                "--format=json",
            ]).exec();
        },
        async getTracerEnv(databasePath) {
            // Write tracer-env.js to a temp location.
            const tracerEnvJs = path.resolve(databasePath, "working", "tracer-env.js");
            fs.mkdirSync(path.dirname(tracerEnvJs), { recursive: true });
            fs.writeFileSync(tracerEnvJs, `
        const fs = require('fs');
        const env = {};
        for (let entry of Object.entries(process.env)) {
          const key = entry[0];
          const value = entry[1];
          if (typeof value !== 'undefined' && key !== '_' && !key.startsWith('JAVA_MAIN_CLASS_')) {
            env[key] = value;
          }
        }
        process.stdout.write(process.argv[2]);
        fs.writeFileSync(process.argv[2], JSON.stringify(env), 'utf-8');`);
            const envFile = path.resolve(databasePath, "working", "env.tmp");
            await new toolrunnner.ToolRunner(cmd, [
                "database",
                "trace-command",
                databasePath,
                ...getExtraOptionsFromEnv(["database", "trace-command"]),
                process.execPath,
                tracerEnvJs,
                envFile,
            ]).exec();
            return JSON.parse(fs.readFileSync(envFile, "utf-8"));
        },
        async databaseInit(databasePath, language, sourceRoot) {
            await new toolrunnner.ToolRunner(cmd, [
                "database",
                "init",
                databasePath,
                `--language=${language}`,
                `--source-root=${sourceRoot}`,
                ...getExtraOptionsFromEnv(["database", "init"]),
            ]).exec();
        },
        async runAutobuild(language) {
            const cmdName = process.platform === "win32" ? "autobuild.cmd" : "autobuild.sh";
            const autobuildCmd = path.join(path.dirname(cmd), language, "tools", cmdName);
            // Update JAVA_TOOL_OPTIONS to contain '-Dhttp.keepAlive=false'
            // This is because of an issue with Azure pipelines timing out connections after 4 minutes
            // and Maven not properly handling closed connections
            // Otherwise long build processes will timeout when pulling down Java packages
            // https://developercommunity.visualstudio.com/content/problem/292284/maven-hosted-agent-connection-timeout.html
            const javaToolOptions = process.env["JAVA_TOOL_OPTIONS"] || "";
            process.env["JAVA_TOOL_OPTIONS"] = [
                ...javaToolOptions.split(/\s+/),
                "-Dhttp.keepAlive=false",
                "-Dmaven.wagon.http.pool=false",
            ].join(" ");
            await new toolrunnner.ToolRunner(autobuildCmd).exec();
        },
        async extractScannedLanguage(databasePath, language) {
            // Get extractor location
            let extractorPath = "";
            await new toolrunnner.ToolRunner(cmd, [
                "resolve",
                "extractor",
                "--format=json",
                `--language=${language}`,
                ...getExtraOptionsFromEnv(["resolve", "extractor"]),
            ], {
                silent: true,
                listeners: {
                    stdout: (data) => {
                        extractorPath += data.toString();
                    },
                    stderr: (data) => {
                        process.stderr.write(data);
                    },
                },
            }).exec();
            // Set trace command
            const ext = process.platform === "win32" ? ".cmd" : ".sh";
            const traceCommand = path.resolve(JSON.parse(extractorPath), "tools", `autobuild${ext}`);
            // Run trace command
            await toolrunner_error_catcher_1.toolrunnerErrorCatcher(cmd, [
                "database",
                "trace-command",
                ...getExtraOptionsFromEnv(["database", "trace-command"]),
                databasePath,
                "--",
                traceCommand,
            ], error_matcher_1.errorMatchers);
        },
        async finalizeDatabase(databasePath) {
            await toolrunner_error_catcher_1.toolrunnerErrorCatcher(cmd, [
                "database",
                "finalize",
                ...getExtraOptionsFromEnv(["database", "finalize"]),
                databasePath,
            ], error_matcher_1.errorMatchers);
        },
        async resolveQueries(queries, extraSearchPath) {
            const codeqlArgs = [
                "resolve",
                "queries",
                ...queries,
                "--format=bylanguage",
                ...getExtraOptionsFromEnv(["resolve", "queries"]),
            ];
            if (extraSearchPath !== undefined) {
                codeqlArgs.push("--search-path", extraSearchPath);
            }
            let output = "";
            await new toolrunnner.ToolRunner(cmd, codeqlArgs, {
                listeners: {
                    stdout: (data) => {
                        output += data.toString();
                    },
                },
            }).exec();
            return JSON.parse(output);
        },
        async databaseAnalyze(databasePath, sarifFile, querySuite, memoryFlag, addSnippetsFlag, threadsFlag) {
            await new toolrunnner.ToolRunner(cmd, [
                "database",
                "analyze",
                memoryFlag,
                threadsFlag,
                databasePath,
                "--format=sarif-latest",
                `--output=${sarifFile}`,
                addSnippetsFlag,
                ...getExtraOptionsFromEnv(["database", "analyze"]),
                querySuite,
            ]).exec();
        },
    };
}
/**
 * Gets the options for `path` of `options` as an array of extra option strings.
 */
function getExtraOptionsFromEnv(path) {
    const options = util.getExtraOptionsEnvParam();
    return getExtraOptions(options, path, []);
}
/**
 * Gets the options for `path` of `options` as an array of extra option strings.
 *
 * - the special terminal step name '*' in `options` matches all path steps
 * - throws an exception if this conversion is impossible.
 */
function getExtraOptions(options, path, pathInfo) {
    var _a, _b, _c;
    /**
     * Gets `options` as an array of extra option strings.
     *
     * - throws an exception mentioning `pathInfo` if this conversion is impossible.
     */
    function asExtraOptions(options, pathInfo) {
        if (options === undefined) {
            return [];
        }
        if (!Array.isArray(options)) {
            const msg = `The extra options for '${pathInfo.join(".")}' ('${JSON.stringify(options)}') are not in an array.`;
            throw new Error(msg);
        }
        return options.map((o) => {
            const t = typeof o;
            if (t !== "string" && t !== "number" && t !== "boolean") {
                const msg = `The extra option for '${pathInfo.join(".")}' ('${JSON.stringify(o)}') is not a primitive value.`;
                throw new Error(msg);
            }
            return `${o}`;
        });
    }
    const all = asExtraOptions((_a = options) === null || _a === void 0 ? void 0 : _a["*"], pathInfo.concat("*"));
    const specific = path.length === 0
        ? asExtraOptions(options, pathInfo)
        : getExtraOptions((_b = options) === null || _b === void 0 ? void 0 : _b[path[0]], (_c = path) === null || _c === void 0 ? void 0 : _c.slice(1), pathInfo.concat(path[0]));
    return all.concat(specific);
}
exports.getExtraOptions = getExtraOptions;
//# sourceMappingURL=codeql.js.map