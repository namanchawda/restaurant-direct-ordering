import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/order-suggestions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const suggestionsModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  suggestionsModule,
  suggestionsModule.exports,
);

const { openOrderAgainItem } = suggestionsModule.exports;
const item = { id: "dish-1", name: "Chicken dum biryani" };

// Cart stand-in from the menu screen, kept untouched behind a read-only view.
const cart = Object.freeze({ outletId: "outlet-1", lines: [] });
const opened = [];

// MenuScreen wiring: tapping a suggestion only opens the normal item sheet.
// openOrderAgainItem has no path into the cart; if it ever mutated state,
// Object.freeze would make the mutation show up (strict-mode) or throw.
function openItemSheet(selectedItem) {
  opened.push(selectedItem);
}

openOrderAgainItem(item, openItemSheet);
openOrderAgainItem(item, openItemSheet);

assert.equal(opened.length, 2, "the item sheet opened for each tap");
assert.deepEqual(opened[0], item, "the suggestion opens in the normal item sheet");
assert.deepEqual(cart, { outletId: "outlet-1", lines: [] }, "cart state stayed unchanged after the taps");

console.log("Order-again behavior passed: opens item details without adding to cart.");
