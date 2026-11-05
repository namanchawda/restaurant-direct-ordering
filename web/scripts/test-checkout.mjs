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

const { cartToOrderItems, distanceKm, SingleFlightOrderCreator, totalsMatch } = checkoutModule.exports;

const lines = [
  {
    id: "line-1",
    itemId: "item-1",
    variantId: "variant-1",
    addonIds: ["addon-1", "addon-2"],
    quantity: 2,
    unitPrice: 380,
    addonPrices: [50, 30],
  },
];
assert.deepEqual(cartToOrderItems(lines), [
  {
    item_id: "item-1",
    variant_id: "variant-1",
    addon_ids: ["addon-1", "addon-2"],
    quantity: 2,
  },
]);

const near = distanceKm(17.4649, 78.3639, 17.4649, 78.3639);
assert.equal(Math.round(near), 0);
const kukatpallyToKondapur = distanceKm(17.4849, 78.4138, 17.4649, 78.3639);
assert.ok(kukatpallyToKondapur > 4 && kukatpallyToKondapur < 7);
assert.equal(totalsMatch(380, 380), true);
assert.equal(totalsMatch(380, 380.4), false);

let calls = 0;
let resolveRequest;
const creator = new SingleFlightOrderCreator();
const request = () =>
  new Promise((resolve) => {
    calls += 1;
    resolveRequest = resolve;
  });
const first = creator.run(request);
const second = creator.run(request);
assert.equal(first, second, "concurrent calls must share one in-flight request");
assert.equal(calls, 1);
assert.equal(creator.busy, true);
resolveRequest("order-1");
assert.equal(await first, "order-1");
await Promise.resolve();
assert.equal(creator.busy, false);
const third = creator.run(async () => {
  calls += 1;
  return "order-2";
});
assert.equal(await third, "order-2");
assert.equal(calls, 2);

console.log("Checkout logic passed: payload mapping, distance, total comparison, and single-flight guard.");
