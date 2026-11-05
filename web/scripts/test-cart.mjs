import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/cart.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cartModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  cartModule,
  cartModule.exports,
);

const {
  addCartLine,
  cartLineIdentity,
  cartLineTotal,
  cartSubtotal,
  clampQuantity,
  includedGstAmount,
  makeCartLine,
  setCartLineQuantity,
} = cartModule.exports;

const item = {
  id: "chicken-biryani",
  name: "Chicken dum biryani",
  photo_url: "https://images.unsplash.com/photo-example",
  is_veg: false,
  price: 380,
  variants: [{ id: "family", name: "Family pack", price: 980 }],
  addons: [
    { id: "raita", name: "Raita", price: 50 },
    { id: "egg", name: "Boiled egg", price: 30 },
  ],
};

assert.equal(
  cartLineIdentity(item.id, "family", ["egg", "raita"]),
  cartLineIdentity(item.id, "family", ["raita", "egg"]),
  "add-on order must not change line identity",
);
assert.notEqual(
  cartLineIdentity(item.id, "family", ["raita"]),
  cartLineIdentity(item.id, "family", ["egg", "raita"]),
);
assert.notEqual(
  cartLineIdentity(item.id, null, ["raita"]),
  cartLineIdentity(item.id, "family", ["raita"]),
);

const familyLine = makeCartLine(item, "family", ["raita"], 2);
assert.equal(familyLine.id, cartLineIdentity(item.id, "family", ["raita"]));
assert.equal(cartLineTotal(familyLine), 2060);
assert.equal(cartSubtotal([familyLine]), 2060);
assert.equal(includedGstAmount(2060), 98.1);

const merged = addCartLine([familyLine], makeCartLine(item, "family", ["raita"], 3));
assert.equal(merged.length, 1);
assert.equal(merged[0].quantity, 5);
assert.equal(setCartLineQuantity(merged, familyLine.id, 21)[0].quantity, 20);
assert.equal(setCartLineQuantity(merged, familyLine.id, 0)[0].quantity, 1);
assert.equal(clampQuantity(1.9), 1);
assert.equal(clampQuantity(Number.NaN), 1);
assert.equal(clampQuantity(25), 20);

console.log("Cart logic passed: identity, totals, included GST, and quantity limits.");
