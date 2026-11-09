"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { api, describeApiError } from "@/lib/api";
import { formatINR } from "@/lib/customer";
import type { PartyOrder } from "./PartyOrderDetail";

function TopBar() {
  return (
    <header className="simple-page-header">
      <Link href="/menu" className="back-link"><span aria-hidden="true">←</span> Browse menu</Link>
      <div className="header-end">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}

export function PartyOrdersList() {
  const [orders, setOrders] = useState<PartyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<PartyOrder[]>("/party-orders/mine").then(setOrders).catch((reason) => setError(describeApiError(reason, "We couldn't load your party orders."))).finally(() => setLoading(false)); }, []);
  return <main className="party-page"><TopBar /><div className="party-shell"><header className="party-header"><p className="eyebrow">Your celebrations</p><h1>Party orders</h1><p>Keep an eye on requests, confirmations, and advances in one place.</p></header>{loading && <><Skeleton className="party-skeleton" /><Skeleton className="party-skeleton" /></>}{error && <div className="customer-error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button></div>}{!loading && !error && orders.length === 0 && <div className="empty-state"><h2>No party orders yet</h2><p>When you’re planning for 10 or more, we’ll keep the details here.</p><Link className="button button-primary" href="/party">Plan a party</Link></div>}<div className="party-order-list">{orders.map((order) => <Link className="party-list-card" href={`/party/${order.public_id}`} key={order.public_id}><div><p className="eyebrow">{order.public_id}</p><h2>{order.event_date} · {order.guests} guests</h2><p>{order.delivery_or_pickup} · {order.items.length} menu item{order.items.length === 1 ? "" : "s"}</p></div><div><strong>{order.status === "confirmed" && order.advance_payment_status === "paid" ? "Advance paid" : order.status[0].toUpperCase() + order.status.slice(1)}</strong><span>{formatINR(order.estimated_total_inr)}</span></div></Link>)}</div></div></main>;
}
