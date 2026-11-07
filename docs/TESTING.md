# Testing

## Web

From `web`:

```powershell
npm run lint
npm run typecheck
npm test
```

Focused Node suites cover cart pricing/outlet changes, mocked payments, checkout state, kitchen transitions, live-event reconnect/resync behavior, order-again suggestions, party date/notice logic and guest limits (`test:party`), and catering order sorting and countdown logic (`test:catering`). The browser axe pass uses installed `axe-core` through Playwright against an already-running app.

## API

From `api`:

```powershell
.\.venv\Scripts\python -m pytest
```

The API suite covers auth/OTP, menus and availability, server-side pricing/GST, checkout/payment, loyalty points, coupon validation and limits, transitions, unpaid auto-cancellation, escalation, SSE token scope/resync, dashboard metrics, and privacy boundaries.

The loyalty and coupon rules covered by the API are:

- Customers earn 1 point per Rs 10 on delivery.
- Points can be redeemed only in steps of 100 and cover at most 20% of the order payable.
- Delivery costs Rs 30 and is free over Rs 499.
- Unpaid orders still in `placed` status are auto-cancelled after 15 minutes by default; the timeout is configured with `UNPAID_ORDER_TIMEOUT_MINUTES`.

Relevant customer endpoints:

- `GET /loyalty/me`
- `POST /orders/quote`
- `POST /coupons/validate`
- `POST /coupons/eligible`
- `POST /orders` with `coupon_code` and `redeem_points`
- `POST /orders/{public_id}/pay`
- `POST /orders/{public_id}/cancel`

Relevant admin endpoints:

- `GET /admin/coupons`
- `POST /admin/coupons`
- `PATCH /admin/coupons/{coupon_id}`

## Party order endpoints

Customer endpoints:

- `POST /party-orders/quote` — items, `estimated_total_inr`, `advance_inr`, `minimum_total_inr`, `price_note` ("incl. 5% GST"); no side effects.
- `POST /party-orders` — create a party order (customer role).
- `GET /party-orders/mine` — list the customer's party orders.
- `GET /party-orders/{public_id}` — one of the customer's party orders.
- `POST /party-orders/{public_id}/pay-advance` — mocked UPI/card advance payment (confirmed orders only).
- `POST /party-orders/{public_id}/cancel` — cancel when allowed.

Catering manager endpoints (catering or admin role):

- `GET /catering/party-orders?status=` — all party orders; newest requests first, soonest events first within Confirmed.
- `PATCH /catering/party-orders/{public_id}/confirm` — confirm with `manager_note` and optional `adjusted_total_inr` (note required when the total changes).
- `PATCH /catering/party-orders/{public_id}/reject` — reject with a required reason.
- `PATCH /catering/party-orders/{public_id}/complete` — mark a confirmed order completed after the event.

Party order rules covered by tests:

- At least 24 hours notice; the date picker disables earlier slots.
- 10 to 500 guests, up to 90 days ahead.
- Rs 3,000 minimum estimated total.
- Advance is 25% of the estimated total (mocked payment).
- Statuses: `requested → confirmed → advance paid → completed`; cancel when allowed.

Seeded demo coupons, marked `is_demo`: `WELCOME100`, `BIRYANI10`, `PARTY15`, and `FREESHIP`. Their seeded rules are Rs 100 off for a first order over Rs 399, 10% off up to Rs 120 over Rs 299, 15% off up to Rs 500 over Rs 1,500, and Rs 30 off over Rs 249, respectively.

Demo login pointer (development only, from [api/README.md](../api/README.md)):

| Role | Phone | Password |
| --- | --- | --- |
| Catering manager | `9000000014` | `DemoCatering!2026` |
| Admin | `9000000099` | `DemoAdmin!2026` |

Catering managers sign in at `/login` and are redirected to `/catering`; kitchen users visiting `/catering` are redirected back to login with a clear message.

## Load test

```powershell
.\.venv\Scripts\python -m scripts.load_test --base-url http://localhost:8010
```

The load test opens 20 kitchen SSE clients, authenticates seeded kitchens, creates and pays orders at the configured rate, matches `order.created` events to creation timestamps, records p50/p95/max paid-to-SSE latency, counts reconnects/resyncs/heartbeats, and reports server stream statistics. It creates real rows, so use a disposable database; tune `--duration`, `--create-seconds`, `--rate`, and `--clients`.
