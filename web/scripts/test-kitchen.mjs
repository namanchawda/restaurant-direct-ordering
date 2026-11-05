import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/kitchen.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const kitchenModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  kitchenModule,
  kitchenModule.exports,
);

const {
  canCancelOrder,
  clampOverrideMinutes,
  columnIdFor,
  customerLabel,
  handedRecently,
  groupKitchenOrders,
  isEscalated,
  isKitchenVisible,
  isLateOrder,
  lateMinutes,
  minutesRemaining,
  nextActionFor,
  orderAgeMinutes,
  overrideMinutesFromCurrent,
  remainingLabel,
  shortOrderId,
  sortKitchenOrders,
  urgencyFor,
} = kitchenModule.exports;

const T = (time) => `2026-11-05T${time}:00.000Z`;
const NOW = new Date(T("10:30")).getTime();

function order(overrides = {}) {
  return {
    public_id: "WEB-1042",
    outlet_id: "outlet-1",
    status: "placed",
    payment_method: "upi",
    payment_status: "paid",
    total_inr: 420,
    gst_included_inr: 20,
    placed_at: T("10:00"),
    promised_at: T("10:30"),
    is_late: false,
    minutes_late: 0,
    delivery_address: "12 Lake Road",
    notes: null,
    cancellation_reason: null,
    customer_first_name: "Asha",
    manager_override_minutes: null,
    escalated_at: null,
    escalation_acknowledged_at: null,
    is_escalated: false,
    price_note: "incl. 5% GST",
    items: [],
    status_history: [],
    ...overrides,
  };
}

for (const status of ["placed", "accepted", "preparing", "ready_for_pickup"]) {
  assert.equal(isKitchenVisible(status), true, `${status} belongs on the board`);
}
for (const status of ["handed_to_rider", "delivered", "cancelled"]) {
  assert.equal(isKitchenVisible(status), false, `${status} must leave the board`);
}

assert.equal(columnIdFor("placed"), "new");
assert.equal(columnIdFor("accepted"), "preparing");
assert.equal(columnIdFor("preparing"), "preparing");
assert.equal(columnIdFor("ready_for_pickup"), "ready");
assert.equal(columnIdFor("handed_to_rider"), null);

const laterPlaced = order({
  public_id: "WEB-1001",
  placed_at: T("10:10"),
  promised_at: T("10:20"),
});
const earlierPlaced = order({
  public_id: "WEB-1002",
  placed_at: T("10:00"),
  promised_at: T("10:20"),
});
const earlierPromise = order({
  public_id: "WEB-1003",
  placed_at: T("10:20"),
  promised_at: T("10:10"),
});
assert.deepEqual(
  sortKitchenOrders([laterPlaced, earlierPlaced, earlierPromise]).map((row) => row.public_id),
  ["WEB-1003", "WEB-1002", "WEB-1001"],
  "sort by promise time, then by placed time",
);

const grouped = groupKitchenOrders([
  order({ public_id: "WEB-1", status: "placed", promised_at: T("10:40") }),
  order({ public_id: "WEB-2", status: "accepted", promised_at: T("10:20") }),
  order({ public_id: "WEB-3", status: "ready_for_pickup", promised_at: T("10:10") }),
  order({ public_id: "WEB-4", status: "handed_to_rider" }),
]);
assert.deepEqual(grouped.new.map((row) => row.public_id), ["WEB-1"]);
assert.deepEqual(grouped.preparing.map((row) => row.public_id), ["WEB-2"]);
assert.deepEqual(grouped.ready.map((row) => row.public_id), ["WEB-3"]);

assert.equal(minutesRemaining(T("10:31"), NOW), 1, "partial minutes round up");
assert.equal(minutesRemaining(T("10:30"), NOW), 0);
assert.equal(minutesRemaining(T("10:20"), NOW), -10);
assert.equal(minutesRemaining("not a date", NOW), 0);

assert.equal(isLateOrder(order({ promised_at: T("10:29") }), NOW), true);
assert.equal(isLateOrder(order({ status: "accepted", promised_at: T("10:29") }), NOW), true);
assert.equal(
  isLateOrder(order({ status: "ready_for_pickup", promised_at: T("10:29") }), NOW),
  false,
  "ready orders are no longer counted late",
);
assert.equal(isLateOrder(order({ promised_at: T("10:31") }), NOW), false);
assert.equal(lateMinutes(order({ promised_at: T("10:25") }), NOW), 5);
assert.equal(lateMinutes(order({ promised_at: T("10:31") }), NOW), 0);

assert.equal(isEscalated(order({ is_escalated: true })), true);
assert.equal(
  isEscalated(order({ escalated_at: T("10:20"), escalation_acknowledged_at: null })),
  true,
  "unacknowledged escalation timestamps count",
);
assert.equal(
  isEscalated(order({ escalated_at: T("10:20"), escalation_acknowledged_at: T("10:22") })),
  false,
  "acknowledged escalations are cleared",
);
assert.equal(isEscalated(order()), false);

assert.equal(urgencyFor(order({ is_escalated: true }), NOW), "escalated");
assert.equal(urgencyFor(order({ promised_at: T("10:20") }), NOW), "late");
assert.equal(urgencyFor(order({ promised_at: T("10:34") }), NOW), "soon");
assert.equal(urgencyFor(order({ promised_at: T("10:36") }), NOW), "normal");

assert.equal(remainingLabel(order({ promised_at: T("10:25") }), NOW), "Late 5 min");
assert.equal(remainingLabel(order({ promised_at: T("10:30") }), NOW), "Due now");
assert.equal(remainingLabel(order({ promised_at: T("10:31") }), NOW), "1 min left");
assert.equal(remainingLabel(order({ promised_at: T("10:42") }), NOW), "12 min left");

assert.equal(orderAgeMinutes(order({ placed_at: T("09:55") }), NOW), 35);
assert.equal(orderAgeMinutes(order({ placed_at: "invalid" }), NOW), 0);
assert.equal(shortOrderId("WEB-1042"), "1042");
assert.equal(shortOrderId("1042"), "1042");
assert.equal(customerLabel(order()), "Asha");
assert.equal(customerLabel(order({ customer_first_name: "   " })), "Guest");
assert.equal(customerLabel(order({ customer_first_name: null })), "Guest");

assert.deepEqual(nextActionFor(order({ status: "placed" })), {
  status: "accepted",
  label: "Accept order",
});
assert.deepEqual(nextActionFor(order({ status: "accepted" })), {
  status: "preparing",
  label: "Start cooking",
});
assert.deepEqual(nextActionFor(order({ status: "preparing" })), {
  status: "ready_for_pickup",
  label: "Mark ready",
});
assert.deepEqual(nextActionFor(order({ status: "ready_for_pickup" })), {
  status: "handed_to_rider",
  label: "Hand to rider",
});
assert.equal(nextActionFor(order({ status: "delivered" })), null);

for (const status of ["placed", "accepted", "preparing"]) {
  assert.equal(canCancelOrder(order({ status })), true, `${status} can be cancelled`);
}
for (const status of ["ready_for_pickup", "handed_to_rider", "delivered", "cancelled"]) {
  assert.equal(canCancelOrder(order({ status })), false, `${status} cannot be cancelled`);
}

assert.equal(clampOverrideMinutes(0), 1);
assert.equal(clampOverrideMinutes(500), 240);
assert.equal(clampOverrideMinutes(12.6), 13);
assert.equal(clampOverrideMinutes(Number.NaN), 1);
assert.equal(clampOverrideMinutes(Infinity), 1);

assert.equal(overrideMinutesFromCurrent(order(), 10), 40);
assert.equal(overrideMinutesFromCurrent(order(), -20), 10);
assert.equal(overrideMinutesFromCurrent(order(), -100), 1);
assert.equal(handedRecently(NOW, NOW), true);
assert.equal(handedRecently(NOW, NOW + 10000), true);
assert.equal(handedRecently(NOW, NOW + 10001), false);

console.log("Kitchen logic passed: columns, timing, escalation, actions, and overrides.");
