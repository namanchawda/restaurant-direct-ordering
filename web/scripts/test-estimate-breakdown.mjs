import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/estimate-breakdown.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const estimateModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), estimateModule, estimateModule.exports,
);

const { estimateBreakdownText } = estimateModule.exports;

const breakdown = (base, queue, correction) => ({
  base, queue, correction, history_used: true,
  inputs: { item_count: 2, active_item_count: 2, kitchen_capacity: 20 },
});

// 1.11 queue shows as 1 (whole minutes); parts sum to the total via the largest part.
assert.equal(
  estimateBreakdownText(20, breakdown(10.4, 1.11, 2.2)),
  "Estimate 20 min: 17 prep + 1 queue + 2 history",
);

// Parts always sum to the total estimate shown (largest part absorbs rounding drift).
for (const [total, base, queue, correction] of [
  [30, 15.6, 8.4, 3.1],
  [45, 40.2, 3.8, 0.4],
  [25, 20.9, 2.9, 1.2],
]) {
  const text = estimateBreakdownText(total, breakdown(base, queue, correction));
  assert.ok(text.startsWith(`Estimate ${total} min:`), `unexpected prefix: ${text}`);
  const numbers = (text.match(/\d+(?= (?:prep|queue|history))/g) || []).map(Number);
  assert.equal(
    numbers.reduce((sum, n) => sum + n, 0),
    total,
    `parts ${numbers.join(" + ")} do not sum to ${total} in "${text}"`,
  );
}

// Zero parts show as 0 (no adjustment needed when they already sum to the total).
assert.equal(
  estimateBreakdownText(5, breakdown(5, 0, 0)),
  "Estimate 5 min: 5 prep + 0 queue + 0 history",
);

// Text format stays "Estimate N min: A prep + B queue + C history".
assert.equal(
  estimateBreakdownText(30, breakdown(15.6, 8.4, 3.1)),
  "Estimate 30 min: 19 prep + 8 queue + 3 history",
);

// No breakdown returns null.
assert.equal(estimateBreakdownText(20, null), null);

console.log("Estimate breakdown passed: whole minutes, parts sum to total, format stable.");
