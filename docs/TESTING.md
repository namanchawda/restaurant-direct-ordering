# Testing

## Web

From `web`:

```powershell
npm run lint
npm run typecheck
npm test
```

Focused Node suites cover cart pricing/outlet changes, mocked payments, checkout state, kitchen transitions, live-event reconnect/resync behavior, and order-again suggestions. The browser axe pass uses installed `axe-core` through Playwright against an already-running app.

## API

From `api`:

```powershell
.\.venv\Scripts\python -m pytest
```

The API suite covers auth/OTP, menus and availability, server-side pricing/GST, checkout/payment, transitions, escalation, SSE token scope/resync, dashboard metrics, and privacy boundaries.

## Load test

```powershell
.\.venv\Scripts\python -m scripts.load_test --base-url http://localhost:8010
```

The load test opens 20 kitchen SSE clients, authenticates seeded kitchens, creates and pays orders at the configured rate, matches `order.created` events to creation timestamps, records p50/p95/max paid-to-SSE latency, counts reconnects/resyncs/heartbeats, and reports server stream statistics. It creates real rows, so use a disposable database; tune `--duration`, `--create-seconds`, `--rate`, and `--clients`.
