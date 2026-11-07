import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/outlet-selection.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const outletModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), outletModule, outletModule.exports,
);
const { selectDefaultOutlet } = outletModule.exports;

const outlets = [
  { id: "gachibowli", name: "Gachibowli", is_open: true, is_inside_delivery_radius: true },
  { id: "kondapur", name: "Kondapur", is_open: false, is_inside_delivery_radius: true },
  { id: "madhapur", name: "Madhapur", is_open: true, is_inside_delivery_radius: true },
];

assert.equal(selectDefaultOutlet(outlets, "madhapur").id, "madhapur");
assert.equal(selectDefaultOutlet(outlets, null).id, "gachibowli");
assert.equal(selectDefaultOutlet([{ ...outlets[1] }], null).id, "kondapur");
assert.equal(selectDefaultOutlet([], null), null);
console.log("outlet selection tests passed");
