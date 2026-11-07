import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/checkout.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const checkoutModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  checkoutModule,
  checkoutModule.exports,
);

const { freeDeliveryStatus, FREE_DELIVERY_THRESHOLD_INR, DELIVERY_FEE_INR } = checkoutModule.exports;

assert.equal(FREE_DELIVERY_THRESHOLD_INR, 499);
assert.equal(DELIVERY_FEE_INR, 30);

// Below the threshold: the exact amount still missing, with the bar filling.
assert.equal(freeDeliveryStatus(0).remainingInr, 499);
assert.equal(freeDeliveryStatus(449).remainingInr, 50);
assert.equal(freeDeliveryStatus(498).remainingInr, 1);
assert.equal(freeDeliveryStatus(498).unlocked, false);
assert.equal(Math.round(freeDeliveryStatus(250).progress * 100), 50);
assert.equal(freeDeliveryStatus(0).progress, 0);

// At the threshold: unlocked, nothing remaining, bar full.
const atThreshold = freeDeliveryStatus(499);
assert.equal(atThreshold.unlocked, true);
assert.equal(atThreshold.remainingInr, 0);
assert.equal(atThreshold.progress, 1);

// Above the threshold: stays unlocked, stays clamped at 100%.
const above = freeDeliveryStatus(1200);
assert.equal(above.unlocked, true);
assert.equal(above.remainingInr, 0);
assert.equal(above.progress, 1);
