"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, Price } from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { useOrderLive } from "@/components/customer/useOrderLive";
import { api, ApiError, describeApiError } from "@/lib/api";
import type { OutletResult } from "@/lib/customer";
import {
  formatDateTime,
  formatINR,
  formatItemCount,
  formatTime,
  minutesUntil,
} from "@/lib/format";
import {
  activeStepIndex,
  isFinalStatus,
  ORDER_STEPS,
  orderItemCount,
  orderItemTotal,
  statusLabel,
} from "@/lib/orders";
import type { Order } from "@/lib/orders";

function statusTone(order: Order): "neutral" | "success" | "warning" | "danger" {
  if (order.status === "cancelled") return "danger";
  if (order.status === "delivered") return "success";
  if (order.is_late) return "warning";
  return "neutral";
}

export function OrderStatusScreen({ publicId }: { publicId: string }) {
  const { order, loading, error, retry } = useOrderLive(publicId);
  const [outlet, setOutlet] = useState<OutletResult | null>(null);

  useEffect(() => {
    if (!order?.outlet_id) return;
    let active = true;
    api<OutletResult[]>("/outlets")
      .then((outlets) => {
        if (active) {
          setOutlet(outlets.find((candidate) => candidate.id === order.outlet_id) ?? null);
        }
      })
      .catch(() => {
        if (active) setOutlet(null);
      });
    return () => {
      active = false;
    };
  }, [order?.outlet_id]);

  const header = (
    <header className="simple-page-header">
      <Link href="/orders" className="back-link"><span aria-hidden="true">←</span> Orders</Link>
      <div className="header-end">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        <AccountMenu />
      </div>
    </header>
  );

  if (loading && !order) {
    return (
      <main className="customer-page order-page">
        {header}
        <div className="order-loading" role="status">Loading your order…</div>
      </main>
    );
  }

  if (!order) {
    const apiError = error instanceof ApiError ? error : null;
    const signedOut = apiError?.status === 401;
    const missing = apiError?.status === 404;
    return (
      <main className="customer-page order-page">
        {header}
        <EmptyState
          title={signedOut ? "Sign in to see this order" : missing ? "Order not found" : "We couldn’t load this order"}
          description={
            signedOut
              ? "Open checkout with your cart to sign in with the phone number used for this order."
              : missing
                ? "Check the order link or open your order history."
                : describeApiError(error, "Check your connection and try again.")
          }
          action={
            signedOut ? (
              <Link className="button button-primary" href="/orders">Go to orders</Link>
            ) : missing ? (
              <Link className="button button-primary" href="/orders">View orders</Link>
            ) : (
              <Button variant="primary" onClick={retry}>Try again</Button>
            )
          }
        />
      </main>
    );
  }

  const stepIndex = activeStepIndex(order.status);
  const final = isFinalStatus(order.status);
  const remaining = minutesUntil(order.promised_at);
  const pendingPayment = order.payment_status !== "paid" && order.status !== "cancelled";

  return (
    <main className="customer-page order-page">
      {header}

      {error && (
        <div className="order-sync-note" role="alert">
          <span>
            <strong>Live updates paused.</strong> Check your connection and try again.
          </span>
          <button type="button" className="checkout-text-link" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      <div className="order-status-live sr-only" aria-live="polite" aria-atomic="true">
        Order status: {statusLabel(order.status)}.
      </div>
      <div className="order-heading">
        <div>
          <p className="customer-eyebrow">Order {order.public_id}</p>
          <h1>{statusLabel(order.status)}</h1>
          <p className="order-heading-meta">
            {outlet?.name ?? "Your kitchen"} · {formatItemCount(orderItemCount(order))} ·{" "}
            {formatDateTime(order.placed_at)}
          </p>
        </div>
        <Badge tone={statusTone(order)}>{statusLabel(order.status)}</Badge>
      </div>

      {order.status === "cancelled" ? (
        <Card className="order-cancelled">
          <h2>This order was cancelled</h2>
          <p>{order.cancellation_reason ?? "The kitchen cancelled this order."}</p>
          <Link className="button button-primary" href="/">Order something else</Link>
        </Card>
      ) : (
        <>
          {order.escalated_at && !final && false && (
            <div className="order-escalation-note" role="status">
              <strong>We’ve alerted the kitchen.</strong>
              <span>
                They’ve given a new estimate of {formatTime(order?.promised_at ?? "")}. Your order
                is still with them, and this page will update when it moves on.
              </span>
            </div>
          )}

          {(order.escalated_at || order.is_late) && (
            <div className="order-late-note" role="status" aria-live="polite">
              <strong>
                The kitchen is running about {order.minutes_late}{" "}
                {order.minutes_late === 1 ? "minute" : "minutes"} behind.
              </strong>
              <span>
                Your order is still being prepared. We’ll update this page as soon as it moves on.
              </span>
            </div>
          )}

          <Card className="order-progress-card">
            <div className="order-promise">
              <div>
                <p className="customer-eyebrow">
                  {order.status === "delivered"
                    ? "Order complete"
                    : order.is_late
                      ? "A little behind"
                      : "Expected"}
                </p>
                <strong>
                  {order.status === "delivered"
                    ? "Delivered"
                    : order.is_late
                      ? `About ${order.minutes_late} min late`
                      : `Arriving by ${formatTime(order.promised_at)}`}
                </strong>
                <span>
                  {order.status === "delivered"
                    ? "Thank you for ordering direct."
                    : order.is_late
                      ? `Originally expected by ${formatTime(order.promised_at)}.`
                      : remaining > 0
                        ? `About ${remaining} ${remaining === 1 ? "minute" : "minutes"} to go.`
                        : "Any moment now."}
                </span>
                {order.kitchen_busy && (
                  <span className="order-kitchen-busy">The kitchen is busy right now.</span>
                )}
              </div>
              <span className="order-live-note">
                <span className="order-live-dot" aria-hidden="true" />
                {final ? "Final update" : "Updates automatically"}
              </span>
            </div>

            <ol className="order-steps" aria-label="Order progress">
              {ORDER_STEPS.map((step, index) => {
                const completed = stepIndex >= index;
                const current = stepIndex === index;
                return (
                  <li
                    key={step.status}
                    className={`order-step${completed ? " is-complete" : ""}${current ? " is-current" : ""}`}
                    aria-current={current ? "step" : undefined}
                  >
                    <span className="order-step-dot" aria-hidden="true">
                      {completed ? "✓" : index + 1}
                    </span>
                    <span className="order-step-label">{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      )}

      {pendingPayment && (
        <div className="order-payment-note" role="status">
          <strong>Payment is still pending.</strong>
          <span>This order won’t reach the kitchen until payment succeeds.</span>
        </div>
      )}

      <div className="order-detail-grid">
        <div className="order-detail-main">
          <Card className="order-items-card">
            <div className="order-card-heading">
              <h2>Your order</h2>
              <span>{formatItemCount(orderItemCount(order))}</span>
            </div>
            <ul className="order-items">
              {order.items.map((item, index) => (
                <li className="order-item" key={`${item.name}-${index}`}>
                  <div>
                    <strong>{item.quantity} × {item.name}</strong>
                    {item.addons.length > 0 && (
                      <span className="order-item-addons">
                        {item.addons.map((addon) => addon.name).join(", ")}
                      </span>
                    )}
                  </div>
                  <strong>{formatINR(orderItemTotal(item))}</strong>
                </li>
              ))}
            </ul>
            <div className="cart-total-row">
              <span>Subtotal <span className="gst-inline">incl. 5% GST</span></span>
              <Price amount={order.total_inr} showGst={false} />
            </div>
            <div className="cart-total-row cart-gst-row">
              <span>GST included</span>
              <strong>{formatINR(order.gst_included_inr)}</strong>
            </div>
            <div className="cart-total-row cart-grand-total">
              <strong>Total</strong>
              <Price amount={order.total_inr} showGst={false} />
            </div>
          </Card>

          {order.status_history.length > 1 && (
            <Card className="order-history-card">
              <h2>Order updates</h2>
              <ol className="order-history">
                {[...order.status_history].reverse().map((event, index) => (
                  <li key={`${event.status}-${event.at}-${index}`}>
                    <span className="order-history-dot" aria-hidden="true" />
                    <div>
                      <strong>{statusLabel(event.status)}</strong>
                      <span>{formatDateTime(event.at)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        <aside className="order-detail-aside">
          <Card className="order-info-card">
            <h2>Delivery</h2>
            <p>{order.delivery_address ?? "Address shared with the kitchen."}</p>
            {order.notes && (
              <>
                <h3>Kitchen note</h3>
                <p>{order.notes}</p>
              </>
            )}
            <h3>Kitchen</h3>
            <p>
              {outlet?.name ?? "Your kitchen"}
              {outlet?.fssai_number && (
                <span className="order-fssai">FSSAI {outlet.fssai_number}</span>
              )}
              {outlet?.address && <span className="order-fssai">{outlet.address}</span>}
            </p>
            <p className="order-help">
              For help with this order, contact the kitchen using the number on your payment
              confirmation.
            </p>
          </Card>

          <Link className="button button-secondary order-back-menu" href={`/outlet/${order.outlet_id}`}>
            Back to the menu
          </Link>
          <Link className="order-all-orders" href="/orders">View all orders</Link>
        </aside>
      </div>
    </main>
  );
}
