r"""SSE and order-ingress load test for the kitchen display.

Run from ``api`` with the API already serving, for example:

    .\.venv\Scripts\python scripts\load_test.py --base-url http://localhost:8000

The default profile opens 20 kitchen streams across the seeded demo outlets,
then drives 3.33 paid orders per second (20 kitchens x 10 orders/minute) for
30 seconds and idles for the rest of the 60-second run. Use a disposable
database for soak runs because the script creates real order rows.

Full 25-minute soak:

    .\.venv\Scripts\python scripts\load_test.py --duration 1500 --create-seconds 300

The seeded database has three outlets. ``--clients 20`` therefore simulates
20 kitchen tablets spread across those outlet channels. To exercise 20 truly
independent kitchens, seed 20 kitchen accounts/outlets and pass their logins
with repeated ``--kitchen PHONE PASSWORD`` arguments.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import httpx

DEMO_KITCHENS = [
    ("9000000011", "KondapurKitchen!2026"),
    ("9000000012", "GachibowliKitchen!2026"),
    ("9000000013", "KukatpallyKitchen!2026"),
]
SSE_EVENT_TYPES = {"order.created", "order.updated", "order.escalated"}


@dataclass
class OutletCatalog:
    outlet_id: str
    name: str
    city: str
    lat: float
    lng: float
    item_id: str


@dataclass
class RunStats:
    orders_requested: int = 0
    orders_paid: int = 0
    failures: Counter[str] = field(default_factory=Counter)
    event_counts: Counter[str] = field(default_factory=Counter)
    latency_ms: list[float] = field(default_factory=list)
    resyncs: int = 0
    reconnects: int = 0
    heartbeats: int = 0
    connected_clients: int = 0
    peak_clients: int = 0
    started_at: float = field(default_factory=time.perf_counter)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--duration", type=float, default=60.0, help="Total run seconds.")
    parser.add_argument("--warmup", type=float, default=5.0, help="Seconds before order creation.")
    parser.add_argument(
        "--create-seconds",
        type=float,
        default=30.0,
        help="Order creation window after warmup. Use 0 for an idle-only soak.",
    )
    parser.add_argument(
        "--rate",
        type=float,
        default=20 * 10 / 60,
        help="Paid orders created per second. Use 0 for an idle-only soak.",
    )
    parser.add_argument(
        "--clients",
        type=int,
        default=20,
        help="Kitchen SSE connections to keep open.",
    )
    parser.add_argument(
        "--kitchen",
        action="append",
        nargs=2,
        metavar=("PHONE", "PASSWORD"),
        help="Kitchen login; repeat for multiple outlets. Defaults to seeded demo kitchens.",
    )
    parser.add_argument("--customer-phone", default="9000000001")
    parser.add_argument("--otp", default="123456")
    parser.add_argument(
        "--customer-token",
        default=None,
        help="Reuse a customer access token instead of requesting a mock OTP.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="HTTP request timeout in seconds.",
    )
    return parser.parse_args()


async def post_json(
    client: httpx.AsyncClient,
    url: str,
    *,
    token: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = await client.post(url, json=payload or {}, headers=headers)
    response.raise_for_status()
    return response.json()


async def get_json(
    client: httpx.AsyncClient,
    url: str,
    *,
    token: str | None = None,
) -> Any:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = await client.get(url, headers=headers)
    response.raise_for_status()
    return response.json()


async def customer_login(
    client: httpx.AsyncClient, base_url: str, phone: str, otp: str, reuse_token: str | None
) -> str:
    if reuse_token:
        return reuse_token
    await post_json(client, f"{base_url}/auth/otp/request", payload={"phone": phone})
    response = await post_json(
        client,
        f"{base_url}/auth/otp/verify",
        payload={"phone": phone, "otp": otp},
    )
    return str(response["access_token"])


async def kitchen_login(
    client: httpx.AsyncClient, base_url: str, phone: str, password: str
) -> str:
    response = await post_json(
        client,
        f"{base_url}/auth/login",
        payload={"phone": phone, "password": password},
    )
    return str(response["access_token"])


async def stream_token(
    client: httpx.AsyncClient, base_url: str, kitchen_token: str
) -> str:
    response = await post_json(
        client, f"{base_url}/kitchen/stream-token", token=kitchen_token
    )
    return str(response["token"])


async def fetch_catalog(
    client: httpx.AsyncClient, base_url: str
) -> list[OutletCatalog]:
    outlets = await get_json(client, f"{base_url}/outlets")
    catalogs: list[OutletCatalog] = []
    for outlet in outlets:
        if not outlet.get("is_open"):
            continue
        menu = await get_json(
            client, f"{base_url}/outlets/{outlet['id']}/menu"
        )
        available_items = [
            item
            for category in menu.get("categories", [])
            for item in category.get("items", [])
            if item.get("available")
        ]
        if not available_items:
            continue
        item = available_items[0]
        catalogs.append(
            OutletCatalog(
                outlet_id=str(outlet["id"]),
                name=str(outlet["name"]),
                city=str(outlet.get("city") or ""),
                lat=float(outlet["lat"]),
                lng=float(outlet["lng"]),
                item_id=str(item["id"]),
            )
        )
    return catalogs


async def create_and_pay(
    client: httpx.AsyncClient,
    base_url: str,
    customer_token: str,
    phone: str,
    catalog: OutletCatalog,
    stats: RunStats,
    created_at: dict[str, float],
) -> None:
    stats.orders_requested += 1
    try:
        order = await post_json(
            client,
            f"{base_url}/orders",
            token=customer_token,
            payload={
                "outlet_id": catalog.outlet_id,
                "items": [{"item_id": catalog.item_id, "quantity": 1}],
                "payment_method": "upi",
                "delivery_address": {
                    "address": f"Load test, {catalog.name}",
                    "lat": catalog.lat,
                    "lng": catalog.lng,
                },
                "phone": phone,
                "notes": "load-test",
            },
        )
        public_id = str(order["public_id"])
        created_at[public_id] = time.perf_counter()
        await post_json(
            client,
            f"{base_url}/orders/{public_id}/pay",
            token=customer_token,
            payload={"upi_id": "loadtest@okhdfcbank"},
        )
        stats.orders_paid += 1
    except httpx.HTTPStatusError as error:
        detail = error.response.text[:160]
        stats.failures[f"HTTP {error.response.status_code}: {detail}"] += 1
    except Exception as error:  # noqa: BLE001 - report and keep the run alive
        stats.failures[f"{type(error).__name__}: {error}"] += 1


async def sse_client(
    client: httpx.AsyncClient,
    base_url: str,
    kitchen_token: str,
    client_id: int,
    stop: asyncio.Event,
    stats: RunStats,
    created_at: dict[str, float],
    first_latency: dict[str, float],
) -> None:
    seen_ids: set[str] = set()
    backoff = 1.0
    while not stop.is_set():
        try:
            token = await stream_token(client, base_url, kitchen_token)
            event_name = ""
            data_lines: list[str] = []
            event_id: str | None = None
            async with client.stream(
                "GET",
                f"{base_url}/kitchen/stream",
                params={"token": token},
                timeout=httpx.Timeout(30.0, read=None),
            ) as response:
                response.raise_for_status()
                stats.connected_clients += 1
                stats.peak_clients = max(stats.peak_clients, stats.connected_clients)
                backoff = 1.0
                async for line in response.aiter_lines():
                    if stop.is_set():
                        return
                    if line == "":
                        if event_name and data_lines:
                            handle_sse_event(
                                event_name,
                                event_id,
                                "\n".join(data_lines),
                                seen_ids,
                                stats,
                                created_at,
                                first_latency,
                            )
                        event_name = ""
                        data_lines = []
                        event_id = None
                        continue
                    if line.startswith(":"):
                        stats.heartbeats += 1
                    elif line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].strip())
                    elif line.startswith("id:"):
                        event_id = line[3:].strip()
            if not stop.is_set():
                stats.reconnects += 1
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - reconnect after network/API failures
            if stop.is_set():
                return
            stats.reconnects += 1
            await asyncio.sleep(backoff)
            backoff = min(15.0, backoff * 2)
        finally:
            stats.connected_clients = max(0, stats.connected_clients - 1)


def handle_sse_event(
    event_name: str,
    event_id: str | None,
    data: str,
    seen_ids: set[str],
    stats: RunStats,
    created_at: dict[str, float],
    first_latency: dict[str, float],
) -> None:
    if event_name == "resync":
        stats.resyncs += 1
        return
    if event_name not in SSE_EVENT_TYPES:
        return
    if event_id:
        if event_id in seen_ids:
            return
        seen_ids.add(event_id)
    try:
        envelope = json.loads(data)
        order = envelope["order"]
        public_id = str(order["public_id"])
    except (KeyError, TypeError, ValueError):
        return
    if public_id not in created_at:
        return
    stats.event_counts[event_name] += 1
    if event_name == "order.created" and public_id not in first_latency:
        first_latency[public_id] = (time.perf_counter() - created_at[public_id]) * 1000


async def creation_loop(
    client: httpx.AsyncClient,
    base_url: str,
    customer_token: str,
    phone: str,
    catalogs: list[OutletCatalog],
    rate: float,
    create_seconds: float,
    stop: asyncio.Event,
    stats: RunStats,
    created_at: dict[str, float],
) -> None:
    if rate <= 0 or create_seconds <= 0 or not catalogs:
        return
    interval = 1.0 / rate
    deadline = time.perf_counter() + create_seconds
    next_at = time.perf_counter()
    pending: set[asyncio.Task[None]] = set()
    index = 0
    while not stop.is_set() and time.perf_counter() < deadline:
        now = time.perf_counter()
        if now < next_at:
            await asyncio.sleep(min(0.25, next_at - now))
            continue
        catalog = catalogs[index % len(catalogs)]
        index += 1
        task = asyncio.create_task(
            create_and_pay(
                client, base_url, customer_token, phone, catalog, stats, created_at
            )
        )
        pending.add(task)
        task.add_done_callback(pending.discard)
        next_at += interval
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return ordered[index]


async def main() -> int:
    args = parse_args()
    if args.clients < 1:
        print("--clients must be at least 1.", file=sys.stderr)
        return 2
    if args.duration <= 0:
        print("--duration must be positive.", file=sys.stderr)
        return 2

    stats = RunStats()
    created_at: dict[str, float] = {}
    first_latency: dict[str, float] = {}
    stop = asyncio.Event()
    base_url = args.base_url.rstrip("/")
    kitchen_accounts = args.kitchen or DEMO_KITCHENS

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(args.timeout),
        limits=httpx.Limits(max_connections=args.clients + 10),
    ) as client:
        try:
            customer_token = await customer_login(
                client,
                base_url,
                args.customer_phone,
                args.otp,
                args.customer_token,
            )
            catalogs = await fetch_catalog(client, base_url)
            if not catalogs:
                print("No open outlets with available items.", file=sys.stderr)
                return 1
            kitchen_tokens = [
                await kitchen_login(client, base_url, phone, password)
                for phone, password in kitchen_accounts
            ]
        except httpx.HTTPError as error:
            print(f"Setup failed: {error}", file=sys.stderr)
            return 1

        stats.started_at = time.perf_counter()
        sse_tasks = [
            asyncio.create_task(
                sse_client(
                    client,
                    base_url,
                    kitchen_tokens[index % len(kitchen_tokens)],
                    index,
                    stop,
                    stats,
                    created_at,
                    first_latency,
                )
            )
            for index in range(args.clients)
        ]

        await asyncio.sleep(args.warmup)
        creation_task = asyncio.create_task(
            creation_loop(
                client,
                base_url,
                customer_token,
                args.customer_phone,
                catalogs,
                args.rate,
                args.create_seconds,
                stop,
                stats,
                created_at,
            )
        )

        try:
            elapsed = time.perf_counter() - stats.started_at
            await asyncio.sleep(max(0.0, args.duration - elapsed))
            measured_seconds = time.perf_counter() - stats.started_at
            server_stats = await get_json(
                client, f"{base_url}/kitchen/stream/stats", token=kitchen_tokens[0]
            )
        finally:
            stop.set()
            await asyncio.gather(creation_task, return_exceptions=True)
            for task in sse_tasks:
                task.cancel()
            await asyncio.gather(*sse_tasks, return_exceptions=True)

    latencies = sorted(first_latency.values())
    summary = {
        "run_seconds": round(measured_seconds, 2),
        "shutdown_seconds": round(
            max(0.0, time.perf_counter() - stats.started_at - measured_seconds), 2
        ),
        "outlets": [catalog.name for catalog in catalogs],
        "kitchen_clients": args.clients,
        "target_orders_per_minute": round(args.rate * 60, 1),
        "orders_requested": stats.orders_requested,
        "orders_paid": stats.orders_paid,
        "failures": dict(stats.failures),
        "sse_peak_connections": stats.peak_clients,
        "sse_reconnects": stats.reconnects,
        "sse_resyncs": stats.resyncs,
        "sse_heartbeats": stats.heartbeats,
        "event_counts": dict(stats.event_counts),
        "created_events_matched": len(first_latency),
        "paid_to_sse_ms": {
            "p50": round(percentile(latencies, 0.50), 1) if latencies else None,
            "p95": round(percentile(latencies, 0.95), 1) if latencies else None,
            "max": round(max(latencies), 1) if latencies else None,
        },
        "server_stream_stats": server_stats,
    }
    print(json.dumps(summary, indent=2))
    return 0 if not stats.failures else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
