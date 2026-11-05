# Hyderabad Biryani direct ordering

Monorepo for the Core build slice: a Next.js ordering app and a FastAPI service. Customer ordering, mocked payment, the staff authentication foundation, the central menu CMS, the live kitchen display, and customer order tracking are implemented.

## Requirements

- Node.js 20.9 or newer and npm
- Python 3.11 or newer
- PowerShell on Windows
- A Neon Postgres URL for database-backed work (the health endpoint does not require a live database)

## Run the API

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env and set DATABASE_URL to your Neon pooled connection URL.
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

The health endpoint is at <http://localhost:8000/health>. Set `DATABASE_URL` in `api\.env` to enable the async Neon engine; the example value is only a placeholder.

After setting up the API environment, initialize and seed the database, then run its integration tests:

```powershell
.\.venv\Scripts\python -m alembic upgrade head
.\.venv\Scripts\python -m app.seed
.\.venv\Scripts\python -m pytest
```

See [api/README.md](api/README.md) for pooled/direct Neon URL details and development-only seed accounts.

## Run the web app

In another PowerShell window:

```powershell
cd web
npm install
npm run dev
```

Open <http://localhost:3000>.

### Staff menu CMS

- Sign in at `/login` with the development-only admin or kitchen credentials in [api/README.md](api/README.md).
- Admin menu management is at `/admin/menu`, with item create/edit at `/admin/menu/new` and `/admin/menu/{id}`.
- Kitchen staff use `/kitchen` for the live board and `/kitchen/items` to pause items. The board uses SSE with polling fallback, a new-order chime, large-text and high-contrast settings, explicit preparation steps, promise-time overrides, and escalation acknowledgement.
- Customers track orders at `/order/{public_id}`; the page updates over SSE, falls back to polling, and shows a revised estimate when the kitchen escalates a late order.
- Configure the API origin in `web\.env.local`; the checked-in `web\.env.example` uses `http://localhost:8000`.
- For this development foundation, the JWT and current user are stored in browser `localStorage`. This is a deliberate simplification, not a production session design; production should use secure, HttpOnly cookies and appropriate CSRF protections.
- The menu's Delete action deactivates an item with the API's `active` flag rather than permanently deleting it, so it can be restored later.
- Prices are entered in whole rupees, include 5% GST, and show an estimated pre-GST amount as a helper.

## Notes

- API dependencies and Python environment are isolated under `api`.
- The web app uses the App Router, TypeScript, Tailwind CSS, and ESLint.
- Realtime updates use a single-instance, in-process SSE broker. Run one API worker for this build; see [api/README.md](api/README.md) for the shared pub/sub note before scaling horizontally.
- The API load test in `api/scripts/load_test.py` creates real paid orders through the public API. Use a disposable database for long soak runs.
- Never put real payment credentials or other secrets in source control. `.env` files are ignored.
