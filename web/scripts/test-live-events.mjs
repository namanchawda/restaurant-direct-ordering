import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/live-events.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const liveEventsModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  liveEventsModule,
  liveEventsModule.exports,
);

const {
  EventIdTracker,
  MAX_RECONNECT_DELAY_MS,
  nextReconnectDelay,
  parseOrderEnvelope,
} = liveEventsModule.exports;

const order = { public_id: "WEB-1042", status: "placed" };

assert.deepEqual(
  parseOrderEnvelope({ data: JSON.stringify({ type: "order.created", order }) }),
  { type: "order.created", order },
  "valid order envelopes should parse",
);
assert.deepEqual(
  parseOrderEnvelope({
    data: JSON.stringify({ type: "order.updated", order }),
    lastEventId: "12",
  }),
  { type: "order.updated", order },
  "lastEventId is not part of the parsed payload",
);
assert.equal(parseOrderEnvelope({ data: "not json" }), null);
assert.equal(parseOrderEnvelope({ data: JSON.stringify(null) }), null);
assert.equal(parseOrderEnvelope({ data: JSON.stringify([]) }), null);
assert.equal(parseOrderEnvelope({ data: JSON.stringify({ order }) }), null);
assert.equal(parseOrderEnvelope({ data: JSON.stringify({ type: "order.created" }) }), null);
assert.equal(
  parseOrderEnvelope({ data: JSON.stringify({ type: 4, order }) }),
  null,
  "type must be a string",
);

assert.equal(nextReconnectDelay(0, () => 0), 800);
assert.equal(nextReconnectDelay(0, () => 1), 1200);
assert.equal(nextReconnectDelay(3, () => 0), 6400);
assert.equal(nextReconnectDelay(3, () => 1), 9600);
assert.equal(nextReconnectDelay(99, () => 0), MAX_RECONNECT_DELAY_MS * 0.8);
assert.equal(
  nextReconnectDelay(99, () => 1),
  MAX_RECONNECT_DELAY_MS,
  "jitter must never exceed the maximum delay",
);
assert.equal(nextReconnectDelay(-4, () => 0), 800, "negative attempts are clamped");

const tracker = new EventIdTracker(2);
assert.equal(tracker.shouldProcess("1"), true);
assert.equal(tracker.shouldProcess("1"), false, "duplicate ids are ignored");
assert.equal(tracker.shouldProcess(undefined), true);
assert.equal(tracker.shouldProcess(null), true);
assert.equal(tracker.shouldProcess("2"), true);
assert.equal(tracker.shouldProcess("3"), true, "oldest id is evicted at the limit");
assert.equal(tracker.shouldProcess("1"), true, "evicted ids can be processed again");
assert.equal(tracker.shouldProcess("2"), true, "second id was evicted by the new id");
tracker.reset();
assert.equal(tracker.shouldProcess("1"), true, "reset clears the seen ids");

console.log("Live event logic passed: envelope parsing, reconnect backoff, and event dedupe.");
