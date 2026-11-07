import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/customer-address.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const customerAddressModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), customerAddressModule, customerAddressModule.exports,
);

const { switchDefault, promoteAfterDelete, MAX_ADDRESSES } = customerAddressModule.exports;

const now = new Date();
const iso = (offsetMinutes) =>
  new Date(now.getTime() + offsetMinutes * 60 * 1000).toISOString();

const a = (id, isDefault, offsetMinutes) => ({
  id,
  label: "home",
  address: `Address ${id.slice(-4)}`,
  lat: 17.4,
  lng: 78.4,
  is_default: isDefault,
  created_at: iso(offsetMinutes),
});

const addresses = [
  a("addr-1", true, -120),   // default, oldest
  a("addr-2", false, -60),
  a("addr-3", false, 0),     // most recent
];

const switched = switchDefault(addresses, "addr-2");
assert.equal(switched.find((x) => x.id === "addr-1").is_default, false);
assert.equal(switched.find((x) => x.id === "addr-2").is_default, true);
assert.equal(switched.find((x) => x.id === "addr-3").is_default, false);

const unchanged = switchDefault(addresses, "addr-1");
assert.equal(unchanged.filter((x) => x.is_default).length, 1);
assert.equal(unchanged.find((x) => x.id === "addr-1").is_default, true);

const promoted = promoteAfterDelete(addresses, "addr-1");
assert.equal(promoted.id, "addr-3");
assert.equal(promoted.is_default, true);

assert.throws(() => promoteAfterDelete([a("addr-1", true, 0)], "addr-1"));

assert.equal(MAX_ADDRESSES, 5);

console.log("Customer address logic passed: default switching and promotion.");
