import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/unpaid-order.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const unpaidModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  unpaidModule,
  unpaidModule.exports,
);

const {
  SAVED_UNPAID_ORDER_KEY,
  clearSavedUnpaidOrder,
  isUnpaidOrder,
  readSavedUnpaidOrder,
  saveUnpaidOrder,
} = unpaidModule.exports;

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
};

const order = { public_id: "WEB-ABC123", payment_status: "failed", status: "placed" };
assert.equal(isUnpaidOrder(order), true);
saveUnpaidOrder(order);
assert.deepEqual(readSavedUnpaidOrder(), order);
assert.equal(storage.has(SAVED_UNPAID_ORDER_KEY), true);
assert.equal(isUnpaidOrder({ payment_status: "paid", status: "placed" }), false);
assert.equal(isUnpaidOrder({ payment_status: "failed", status: "cancelled" }), false);
clearSavedUnpaidOrder();
assert.equal(readSavedUnpaidOrder(), null);

console.log("Unpaid-order state logic passed: save, restore, unpaid guard, and clear.");
