"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isScannedLanguage = exports.isTracedLanguage = exports.parseLanguage = exports.KnownLanguage = void 0;
/**
 *  All the languages known to be supported by CodeQL
 */
var KnownLanguage;
(function (KnownLanguage) {
    KnownLanguage["csharp"] = "csharp";
    KnownLanguage["cpp"] = "cpp";
    KnownLanguage["go"] = "go";
    KnownLanguage["java"] = "java";
    KnownLanguage["javascript"] = "javascript";
    KnownLanguage["python"] = "python";
    KnownLanguage["ruby"] = "ruby";
})(KnownLanguage = exports.KnownLanguage || (exports.KnownLanguage = {}));
// Additional names for languages
const LANGUAGE_ALIASES = {
    c: KnownLanguage.cpp,
    "c++": KnownLanguage.cpp,
    "c#": KnownLanguage.csharp,
    typescript: KnownLanguage.javascript,
};
// Translate from user input or GitHub's API names for languages to CodeQL's names for languages
function parseLanguage(language) {
    // Normalise to lower case
    language = language.toLowerCase();
    // See if it's an exact match
    if (language in KnownLanguage) {
        return language;
    }
    // Check language aliases
    if (language in LANGUAGE_ALIASES) {
        return LANGUAGE_ALIASES[language];
    }
    return language;
}
exports.parseLanguage = parseLanguage;
function isTracedLanguage(language) {
    return ([KnownLanguage.cpp, KnownLanguage.java, KnownLanguage.csharp].includes(language) ||
        (process.env["CODEQL_EXTRACTOR_GO_BUILD_TRACING"] === "on" &&
            language === KnownLanguage.go));
}
exports.isTracedLanguage = isTracedLanguage;
function isScannedLanguage(language) {
    return !isTracedLanguage(language);
}
exports.isScannedLanguage = isScannedLanguage;
//# sourceMappingURL=languages.js.map