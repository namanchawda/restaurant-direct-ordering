import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/party.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const partyModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), partyModule, partyModule.exports,
);

const { isPartySlotValid, isValidPartyGuestCount, minimumPartyDateTime, partyDateInputValue, partyTimeInputValue } = partyModule.exports;
const now = new Date(2026, 10, 7, 12, 0, 0);
const earliest = minimumPartyDateTime(now);
assert.equal(isPartySlotValid(partyDateInputValue(earliest), partyTimeInputValue(earliest), now), true);
const tooSoon = new Date(earliest.getTime() - 60 * 1000);
assert.equal(isPartySlotValid(partyDateInputValue(tooSoon), partyTimeInputValue(tooSoon), now), false);
assert.equal(isValidPartyGuestCount(10), true);
assert.equal(isValidPartyGuestCount(500), true);
assert.equal(isValidPartyGuestCount(9), false);
assert.equal(isValidPartyGuestCount(501), false);
console.log("Party logic passed: notice boundary and guest limits.");
