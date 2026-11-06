# Architecture

## Data model

`User` stores minimum customer/staff identity and role. `Outlet` stores city, coordinates, radius, FSSAI number, opening state, and minimum prep time. `Category` owns menu order, service window, and prep weight. `MenuItem` stores canonical name, GST-inclusive price, photo, dietary flags, allergens, and active state; outlet availability is separate. `Addon` and links model extras and portions. `Order` stores outlet, customer, immutable priced lines, payment, address, promise, estimate breakdown, manager override, and escalation timestamps. `OrderStatusEvent` is the audit history.

## Order lifecycle

`placed → accepted → preparing → ready_for_pickup → handed_to_rider → delivered`; `placed`, `accepted`, or `preparing` may transition to `cancelled`. The kitchen advances the active stage; the customer sees the same history. A paid order is eligible for kitchen work; pending payment is held.

## SSE design

The browser requests a short-lived stream token scoped to the order or kitchen outlet, then opens `/orders/{id}/stream` or `/kitchen/stream`. The broker assigns increasing event IDs and sends `order.created`, `order.updated`, `order.escalated`, and heartbeat comments. The client reconnects with backoff and falls back to polling. A missed history window emits `resync`; the client refetches a fresh snapshot. The current broker is in-process and single-instance.

## Prep-time formula

`load estimate = outlet minimum + (active kitchen orders × 2 minutes)`. The model estimate is `base prep + queue load + historical correction`; the promise is `max(model estimate, load estimate, outlet minimum)`. A manager override replaces that result.

Worked examples:

1. Minimum 25, active 3 → load `25 + 3×2 = 31`; model 28 → promise 31 minutes.
2. Minimum 20, active 2 → load 24; model 32 → promise 32 minutes.
3. Minimum 30, active 4, model `30 + 8 + 0 = 38` → promise 38; override 45 → promise 45 minutes.

## Dashboard definitions

Orders count orders placed in the selected range. Average order value is the mean stored total in INR. Average prep time is mean minutes from the first accepted/preparing event to the first `ready_for_pickup` event. On-time rate compares ready time with `promised_at`; late means ready after promise. Escalated count uses `escalated_at`. Cancellations count cancelled orders and group by reason. Repeat-customer percentage is customers with at least two orders divided by customers with at least one order in range.
