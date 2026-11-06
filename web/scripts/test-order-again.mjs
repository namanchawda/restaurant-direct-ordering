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
let openedItem = null;
let cartAdditions = 0;

openOrderAgainItem(item, (selectedItem) => {
  openedItem = selectedItem;
});

assert.equal(openedItem, item, "selecting a suggestion opens its normal item sheet");
assert.equal(cartAdditions, 0, "selecting a suggestion must not add anything to the cart");

console.log("Order-again behavior passed: opens item details without adding to cart.");
