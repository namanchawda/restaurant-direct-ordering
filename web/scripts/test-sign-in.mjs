import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/sign-in.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const signInModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), signInModule, signInModule.exports,
);

const { roleHome, isValidPhone, isValidOtp, safeNext } = signInModule.exports;
assert.equal(roleHome("admin"), "/admin/menu");
assert.equal(roleHome("kitchen"), "/kitchen");
assert.equal(roleHome("catering"), "/catering");
assert.equal(roleHome("customer"), "/");
assert.equal(isValidPhone("1234567890"), true);
assert.equal(isValidPhone("123456789"), false);
assert.equal(isValidPhone("12345abcde"), false);
assert.equal(isValidOtp("123456"), true);
assert.equal(safeNext("/kitchen"), "/kitchen");
assert.equal(safeNext("//evil.com"), null);
assert.equal(safeNext("http://x"), null);
assert.equal(safeNext(null), null);
console.log("Sign-in logic passed: roles, validation and safe redirects.");
