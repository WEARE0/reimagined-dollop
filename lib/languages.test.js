"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ava_1 = __importDefault(require("ava"));
const languages_1 = require("./languages");
const testing_utils_1 = require("./testing-utils");
(0, testing_utils_1.setupTests)(ava_1.default);
(0, ava_1.default)("parseLanguage", async (t) => {
    // Exact matches
    t.deepEqual((0, languages_1.parseLanguage)("csharp"), languages_1.KnownLanguage.csharp);
    t.deepEqual((0, languages_1.parseLanguage)("cpp"), languages_1.KnownLanguage.cpp);
    t.deepEqual((0, languages_1.parseLanguage)("go"), languages_1.KnownLanguage.go);
    t.deepEqual((0, languages_1.parseLanguage)("java"), languages_1.KnownLanguage.java);
    t.deepEqual((0, languages_1.parseLanguage)("javascript"), languages_1.KnownLanguage.javascript);
    t.deepEqual((0, languages_1.parseLanguage)("python"), languages_1.KnownLanguage.python);
    // Aliases
    t.deepEqual((0, languages_1.parseLanguage)("c"), languages_1.KnownLanguage.cpp);
    t.deepEqual((0, languages_1.parseLanguage)("c++"), languages_1.KnownLanguage.cpp);
    t.deepEqual((0, languages_1.parseLanguage)("c#"), languages_1.KnownLanguage.csharp);
    t.deepEqual((0, languages_1.parseLanguage)("typescript"), languages_1.KnownLanguage.javascript);
    // Not matches
    t.deepEqual((0, languages_1.parseLanguage)("foo"), undefined);
    t.deepEqual((0, languages_1.parseLanguage)(" "), undefined);
    t.deepEqual((0, languages_1.parseLanguage)(""), undefined);
});
(0, ava_1.default)("isTracedLanguage", async (t) => {
    t.true((0, languages_1.isTracedLanguage)(languages_1.KnownLanguage.cpp));
    t.true((0, languages_1.isTracedLanguage)(languages_1.KnownLanguage.java));
    t.true((0, languages_1.isTracedLanguage)(languages_1.KnownLanguage.csharp));
    t.false((0, languages_1.isTracedLanguage)(languages_1.KnownLanguage.go));
    t.false((0, languages_1.isTracedLanguage)(languages_1.KnownLanguage.javascript));
    t.false((0, languages_1.isTracedLanguage)(languages_1.KnownLanguage.python));
});
(0, ava_1.default)("isScannedLanguage", async (t) => {
    t.false((0, languages_1.isScannedLanguage)(languages_1.KnownLanguage.cpp));
    t.false((0, languages_1.isScannedLanguage)(languages_1.KnownLanguage.java));
    t.false((0, languages_1.isScannedLanguage)(languages_1.KnownLanguage.csharp));
    t.true((0, languages_1.isScannedLanguage)(languages_1.KnownLanguage.go));
    t.true((0, languages_1.isScannedLanguage)(languages_1.KnownLanguage.javascript));
    t.true((0, languages_1.isScannedLanguage)(languages_1.KnownLanguage.python));
});
//# sourceMappingURL=languages.test.js.map