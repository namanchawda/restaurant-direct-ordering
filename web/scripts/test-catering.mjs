import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/catering.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cateringModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), cateringModule, cateringModule.exports,
);

const { eventCountdown, sortCateringOrders, CATERING_TABS } = cateringModule.exports;

const now = new Date(2026, 9, 7, 12, 0, 0);

function parts(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const soon = parts(new Date(now.getTime() + 90 * 60 * 1000));
assert.ok(/^in 1 hour$/.test(eventCountdown(soon.date, soon.time, now)), `Expected "in 1 hour", got ${eventCountdown(soon.date, soon.time, now)}`);

const far = parts(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));
assert.equal(eventCountdown(far.date, far.time, now), "in 3 days");

const past = parts(new Date(now.getTime() - 60 * 60 * 1000));
assert.equal(eventCountdown(past.date, past.time, now), "Event has passed");

const base = {
  public_id: "PARTY-000001",
  outlet_name: "Kondapur",
  guests: 20,
  delivery_or_pickup: "delivery",
  address: "123 Street",
  contact_name: "Demo Customer",
  contact_phone: "9000000001",
  notes: null,
  items: [{ item_id: "i1", name: "Chicken dum biryani", variant: null, quantity: 2, unit_price_inr: 380 }],
  estimated_total_inr: 760,
  advance_inr: 190,
  advance_payment_status: "pending",
  manager_note: null,
  confirmed_by: null,
  confirmed_at: null,
  created_at: "2026-10-31T10:00:00Z",
  updated_at: "2026-10-31T10:00:00Z",
  price_note: "incl. 5% GST",
  status_history: [],
};

const orders = [
  { ...base, public_id: "A", status: "requested", created_at: "2026-10-07T10:00:00Z", event_date: "2026-10-20", event_time: "10:00" },
  { ...base, public_id: "B", status: "requested", created_at: "2026-10-07T11:00:00Z", event_date: "2026-10-20", event_time: "10:00" },
  { ...base, public_id: "C", status: "confirmed", created_at: "2026-10-07T09:00:00Z", event_date: "2026-10-20", event_time: "14:00" },
  { ...base, public_id: "D", status: "confirmed", created_at: "2026-10-07T08:00:00Z", event_date: "2026-10-20", event_time: "10:00" },
];

const requested = sortCateringOrders(orders.filter((o) => o.status === "requested"), "requested");
assert.equal(requested[0].public_id, "B");
assert.equal(requested[1].public_id, "A");

const confirmed = sortCateringOrders(orders.filter((o) => o.status === "confirmed"), "confirmed");
assert.equal(confirmed[0].public_id, "D");
assert.equal(confirmed[1].public_id, "C");

assert.equal(CATERING_TABS.length, 4);
assert.deepEqual(CATERING_TABS.map((t) => t.key), ["requested", "confirmed", "completed", "rejected"]);

console.log("Catering logic passed: sorting and countdown.");
