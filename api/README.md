# API database setup

The database uses SQLAlchemy 2 async models and Alembic with PostgreSQL/Neon.

## Setup

From `api` in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Set DATABASE_URL to your Neon pooled connection URL in .env.
```

`DATABASE_URL` can be a Neon URL using `postgresql://` or
`postgresql+asyncpg://`; the app normalizes it to asyncpg, requires SSL, and
disables asyncpg's prepared-statement cache for PgBouncer.

If Alembic cannot apply DDL through the pooler, set `DATABASE_URL_DIRECT` to
the Neon direct (non-pooled) connection URL in `.env`. Alembic prefers this
optional URL; the application and seed script continue to use `DATABASE_URL`.
Both connections use SSL.

## Migrations, seed, and tests

```powershell
.\.venv\Scripts\python -m alembic upgrade head
.\.venv\Scripts\python -m app.seed
.\.venv\Scripts\python -m pytest
```

Pytest and the seed script use the configured Neon database. Tests do not drop
tables or remove unrelated records; the seed test re-runs the idempotent seed
and checks that its row counts stay stable.

## Development-only demo users

All demo accounts are for local/test environments only. Change or remove these
credentials before deploying, and do not use them in production.

| Role | Phone | Password |
| --- | --- | --- |
| Customer | `9000000001` | No password; customer demo only |
| Kitchen — Kondapur | `9000000011` | `KondapurKitchen!2026` |
| Kitchen — Gachibowli | `9000000012` | `GachibowliKitchen!2026` |
| Kitchen — Kukatpally | `9000000013` | `KukatpallyKitchen!2026` |
| Admin | `9000000099` | `DemoAdmin!2026` |

Kitchen/admin passwords are stored as bcrypt hashes. All demo accounts have
marketing opt-in disabled.
# Core API

The API uses async SQLAlchemy sessions and JWT bearer tokens. Configure
`JWT_SECRET`, `JWT_EXPIRY_MINUTES`, and `MOCK_OTP` in `.env`; OTP verification
uses the configured code locally and never sends a message. Apply migrations
with `.\.venv\Scripts\python -m alembic upgrade head` before serving.

Public menus include GST-inclusive prices and outlet availability; orders
require an authenticated customer and delivery coordinates within the selected
outlet's radius. Payment details are mocked and card data is never persisted.
Kitchen users are restricted to their assigned outlet.

See `/docs` for request and response schemas. The role-protected route groups
are `/admin/*` (admin) and `/kitchen/*` (kitchen).

The admin CMS also exposes `GET /admin/items/{item_id}/availability`, which
returns the stored per-outlet availability setting for an item (not its
time-window-adjusted public ordering status).

## Realtime kitchen display and order tracking

The kitchen board and customer order page use Server-Sent Events (SSE). EventSource
cannot send an `Authorization` header, so the API issues short-lived (60 second)
scoped stream tokens:

1. A kitchen user signs in normally and calls `POST /kitchen/stream-token`.
2. A customer calls `POST /orders/{public_id}/stream-token` for their own order.
3. The returned token is passed as `?token=` to the stream URL.
4. Reconnects can send `Last-Event-ID` as a header or `last_event_id` query parameter.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/kitchen/stream-token` | Issue a 60-second kitchen stream token. |
| `POST` | `/orders/{public_id}/stream-token` | Issue a 60-second token for the customer's order. |
| `GET` | `/kitchen/stream` | Kitchen outlet event stream. |
| `GET` | `/orders/{public_id}/stream` | Customer order event stream. |
| `GET` | `/kitchen/stream/stats` | Subscriber, buffer, and dropped-event diagnostics. |
| `GET` | `/kitchen/items` | Active menu items with this outlet's availability. |
| `POST` | `/kitchen/orders/{public_id}/acknowledge-escalation` | Clear an active escalation alert. |

`GET /kitchen/orders` returns only paid orders in `placed`, `accepted`,
`preparing`, or `ready_for_pickup`; handed-off orders leave the board. Order
payloads include `customer_first_name`, `manager_override_minutes`,
`escalated_at`, `escalation_acknowledged_at`, and `is_escalated`.

Events use `id`, `event`, and `data` SSE fields. `data` is
`{"type": "...", "order": {...}}`; types are `order.created`, `order.updated`,
and `order.escalated`. A fresh stream replays the last 200 events per channel.
If a reconnect cursor is older than the ring, or a subscriber falls behind its
200-event queue, the server emits `event: resync` so the client reloads a
snapshot.

The escalation task runs on application startup. A paid, active order more than
`ESCALATION_MINUTES` past `promised_at` is escalated once: `escalated_at` is
recorded, the promise is extended by `ESCALATION_EXTEND_MINUTES`, an
`order.escalated` event is published, and a manager WhatsApp/SMS alert is
logged (mocked). Kitchen acknowledgement records
`escalation_acknowledged_at` and publishes `order.updated`. These settings can
be tuned in `.env`:

```env
SSE_HEARTBEAT_SECONDS=15
SSE_RETRY_MS=3000
ESCALATION_MINUTES=10
ESCALATION_EXTEND_MINUTES=10
ESCALATION_CHECK_INTERVAL_SECONDS=30
```

The event broker is in-process and single-instance. Run one API worker for the
current build. Multiple workers or instances would each have their own ring and
subscriber set, so a shared pub/sub layer (for example Redis or Postgres
LISTEN/NOTIFY) is required before horizontal scaling.

## Load test

`scripts/load_test.py` opens kitchen SSE connections and creates paid orders
through the public API. Use a disposable database for long runs because the
script leaves real order rows behind.

```powershell
# Quick smoke run (3 clients, 10 seconds, 3 orders in the create window).
.\.venv\Scripts\python scripts\load_test.py --duration 10 --warmup 2 --create-seconds 3 --rate 1 --clients 3

# Default profile: 20 kitchen streams, 3.33 paid orders/second, 60 seconds total.
.\.venv\Scripts\python scripts\load_test.py

# Full 25-minute soak: 5-minute create window, then 20 minutes idle.
.\.venv\Scripts\python scripts\load_test.py --duration 1500 --create-seconds 300
```

The seeded database has three outlets, so `--clients 20` models 20 tablets
spread across those outlet channels. For 20 independent kitchen outlets, seed
20 kitchen accounts and repeat `--kitchen PHONE PASSWORD` for each one. The
summary reports paid-to-SSE latency, event counts, resyncs/reconnects,
heartbeats, and server-side subscriber/drop counts. Repeated runs use the same
demo customer phone and can hit the OTP request limit; pass a reusable
`--customer-token` when rerunning quickly.

## API changes for realtime kitchen support

- Added `orders.escalated_at` and `orders.escalation_acknowledged_at` plus
  migration `20261105_03`: persist the escalation lifecycle and acknowledgement.
- Added SSE/escalation settings: tune heartbeat, reconnect timing, and alert
  thresholds without code changes.
- Added `app/services/order_payload.py`: one serializer and status visibility
  rules for all order responses and events.
- Added the in-process event broker: non-blocking SSE fan-out, replay, and
  bounded-buffer resync for slow or reconnecting clients.
- Added scoped 60-second stream tokens: EventSource cannot set auth headers, and
  short query-string tokens limit exposure.
- Added the live router endpoints above: authorize and serve kitchen/customer
  streams, expose diagnostics, and let the kitchen pause items or acknowledge alerts.
- Added the escalation service and startup loop: automatically notify managers
  and revise the customer estimate when a paid order is too late.
- Order creation no longer publishes an event; payment, status changes,
  overrides, and acknowledgements publish instead. This prevents unpaid orders
  from ringing the kitchen and keeps both live views in sync after payment.
- Changed `GET /kitchen/orders` to return only paid, visible-preparation statuses:
  delivered, cancelled, and handed-off orders should not remain on the board.
- Extended serialized orders with first name, manager override, and escalation
  fields: the kitchen needs a human label and alert state, while the customer
  needs the revised estimate without exposing phone numbers.
- Added `scripts/load_test.py`: repeatable SSE fan-out and order-ingress checks.
