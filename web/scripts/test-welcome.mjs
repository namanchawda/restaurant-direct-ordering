import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/welcome.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const welcomeModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), welcomeModule, welcomeModule.exports,
);

const { shouldShowWelcome } = welcomeModule.exports;
assert.equal(shouldShowWelcome(false, false), true);
assert.equal(shouldShowWelcome(true, false), false);
assert.equal(shouldShowWelcome(false, true), false);
assert.equal(shouldShowWelcome(true, true), false);
console.log("Welcome logic passed: only first-time visitors see the sheet.");
