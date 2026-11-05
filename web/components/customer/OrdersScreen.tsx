"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import type { OutletResult } from "@/lib/customer";
import { formatDateTime, formatINR, formatItemCount } from "@/lib/format";
import { isFinalStatus, orderItemCount, statusLabel } from "@/lib/orders";
import type { Order } from "@/lib/orders";

function toneFor(order: Order): "neutral" | "success" | "warning" | "danger" {
  if (order.status === "cancelled") return "danger";
  if (order.status === "delivered") return "success";
  if (order.is_late) return "warning";
  return "neutral";
}

export function OrdersScreen() {
  const { user, ready } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [outletNames, setOutletNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const [attempt, setAttempt] = useState(0);
  const isCustomer = user?.role === "customer";
  const requestKey = ready && isCustomer && user ? `${user.id}:${attempt}` : "";
  const loading = !ready || (isCustomer && loadedKey !== requestKey);
  const signedOut = ready && (!isCustomer || authExpired);

  useEffect(() => {
    if (!ready || !user || user.role !== "customer") return;
    let active = true;
    Promise.all([
      api<Order[]>("/orders/mine"),
      api<OutletResult[]>("/outlets").catch(() => [] as OutletResult[]),
    ])
      .then(([orderList, outlets]) => {
        if (!active) return;
        setOrders(orderList);
        setOutletNames(
          Object.fromEntries(outlets.map((outlet) => [outlet.id, outlet.name])),
        );
        setError(null);
        setAuthExpired(false);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        if (requestError instanceof ApiError && requestError.status === 401) {
          setOrders([]);
          setAuthExpired(true);
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "We couldn’t load your orders.",
        );
      })
      .finally(() => {
        if (active) setLoadedKey(requestKey);
      });
    return () => {
      active = false;
    };
  }, [ready, requestKey, user]);

  const header = (
    <header className="simple-page-header">
      <Link href="/" className="back-link"><span aria-hidden="true">←</span> Home</Link>
      <div className="header-end">
        <Link className="brand-lockup" href="/" aria-label="Hyderabad Biryani home">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        <AccountMenu />
      </div>
    </header>
  );

  return (
    <main className="customer-page orders-page">
      {header}

      <div className="orders-heading">
        <div>
          <p className="customer-eyebrow">Your account</p>
          <h1>Your orders</h1>
          <p>Direct orders, kept in one place.</p>
        </div>
      </div>

      {loading ? (
        <div className="orders-list" aria-label="Loading your orders">
          {[0, 1, 2].map((key) => (
            <Card className="order-list-skeleton" key={key}>
              <Skeleton className="skeleton-line skeleton-title" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-line skeleton-short" />
            </Card>
          ))}
        </div>
      ) : signedOut ? (
        <EmptyState
          title="Sign in to see your orders"
          description="Start checkout and sign in with your phone number. Your past direct orders will appear here."
          action={<Link className="button button-primary" href="/">Find a kitchen</Link>}
        />
      ) : error ? (
        <div className="customer-error orders-error" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="When you order direct, you’ll be able to follow it here."
          action={<Link className="button button-primary" href="/">Browse the menu</Link>}
        />
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <Card className="order-list-card" key={order.public_id}>
              <div className="order-list-top">
                <div>
                  <p className="customer-eyebrow">Order {order.public_id}</p>
                  <h2>{outletNames[order.outlet_id] ?? "Your kitchen"}</h2>
                  <p>
                    {formatDateTime(order.placed_at)} · {formatItemCount(orderItemCount(order))}
                  </p>
                </div>
                <Badge tone={toneFor(order)}>{statusLabel(order.status)}</Badge>
              </div>
              {order.is_late && (
                <p className="order-list-late">
                  Running about {order.minutes_late} min late
                </p>
              )}
              <div className="order-list-foot">
                <strong>{formatINR(order.total_inr)}</strong>
                <Link className="button button-secondary" href={`/order/${order.public_id}`}>
                  {isFinalStatus(order.status) ? "View order" : "Track order"}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="orders-privacy-link">
        <Link href="/privacy">How we handle your data</Link>
      </p>
    </main>
  );
}
