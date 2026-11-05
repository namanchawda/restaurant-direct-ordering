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
