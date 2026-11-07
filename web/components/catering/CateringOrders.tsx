"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Skeleton } from "@/components/ui";
import { api, describeApiError } from "@/lib/api";
import { formatINR } from "@/lib/customer";
import {
  CATERING_TABS,
  CateringPartyOrder,
  CateringTab,
  eventCountdown,
  sortCateringOrders,
} from "@/lib/catering";
import { CateringOrderDetail } from "./CateringOrderDetail";

type Tab = CateringTab;
const TABS = CATERING_TABS;

export function CateringOrders() {
  const [orders, setOrders] = useState<CateringPartyOrder[]>([]);
  const [tab, setTab] = useState<Tab>("requested");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const active = useRef(true);

  async function load() {
    try {
      const result = await api<CateringPartyOrder[]>("/catering/party-orders");
      if (!active.current) return;
      setOrders(result);
      setError(null);
    } catch (reason) {
      if (!active.current) return;
      setError(describeApiError(reason, "We couldn't load party orders. Please try again."));
    } finally {
      if (active.current) setLoading(false);
    }
  }

  useEffect(() => {
    active.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    function onVisibility() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const filtered = useMemo(() => sortCateringOrders(orders.filter((o) => o.status === tab), tab), [orders, tab]);
  const needsAction = tab === "requested";

  async function refresh() {
    void load();
  }

  function openOrder(id: string) {
    setOpenId(id);
  }

  return (
    <main className="catering-page">
      <div className="catering-shell">
        <header className="catering-header">
          <Link className="back-link" href="/admin/dashboard">← Dashboard</Link>
          <div className="catering-header-copy">
            <p className="eyebrow">Catering requests</p>
            <h1>Party orders</h1>
          </div>
        </header>
        {error && <div className="catering-error" role="alert"><p>{error}</p><Button variant="secondary" onClick={refresh}>Try again</Button></div>}
        <div className="catering-tabs" role="tablist" aria-label="Party order status">
          {TABS.map((item) => {
            const activeTab = tab === item.key;
            const count = filtered.filter((o) => o.status === item.key).length;
            return (
              <button
                key={item.key}
                role="tab"
                aria-selected={activeTab}
                aria-controls={`catering-tab-${item.key}`}
                className={`catering-tab${activeTab ? " catering-tab-active" : ""}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
                <span className="catering-tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        {loading && filtered.length === 0 && (
          <div className="catering-loading" role="status" aria-label="Loading party orders">
            <Skeleton className="catering-skeleton" /><Skeleton className="catering-skeleton short" />
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="empty-state catering-empty">
            <div className="empty-mark" aria-hidden="true">—</div>
            <h2>No {tab} party orders</h2>
            <p>{tab === "requested" ? "No requests awaiting action." : "No orders in this status yet."}</p>
          </div>
        )}
        <div className="catering-card-list">
          {filtered.map((order) => (
            <article
              key={order.public_id}
              className={`catering-card${needsAction ? " catering-card-needs-action" : ""}`}
            >
              <div className="catering-card-main">
                <div className="catering-card-id">{order.public_id}</div>
                <p className="catering-card-event">{order.event_date} at {order.event_time} · <span className="catering-card-countdown">{eventCountdown(order.event_date, order.event_time)}</span></p>
                <p className="catering-card-meta">{order.guests} guests · {order.outlet_name || "Outlet"} · {order.delivery_or_pickup}</p>
                <p className="catering-card-items">{order.items.length} menu item{order.items.length === 1 ? "" : "s"} · {formatINR(order.estimated_total_inr)}</p>
              </div>
              <div className="catering-card-actions">
                <Button type="button" variant="primary" className="catering-card-view" onClick={() => openOrder(order.public_id)}>
                  View order
                </Button>
              </div>
            </article>
          ))}
        </div>

        {openId && orders.find((o) => o.public_id === openId) && (
          <CateringOrderDetail
            open={true}
            order={orders.find((o) => o.public_id === openId)!}
            onClose={() => setOpenId(null)}
            onOrderUpdated={refresh}
          />
        )}
      </div>
    </main>
  );
}
