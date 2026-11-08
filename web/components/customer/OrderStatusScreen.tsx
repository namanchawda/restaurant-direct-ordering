"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, Price, useToast } from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { useOrderLive } from "@/components/customer/useOrderLive";
import { useDeliveryTracking } from "@/components/customer/useDeliveryTracking";
import { TRACKING_STEPS } from "@/lib/delivery";
import { api, ApiError, describeApiError } from "@/lib/api";
import type { OutletResult } from "@/lib/customer";
import {
  formatDateTime,
  formatINR,
  formatItemCount,
  formatTime,
} from "@/lib/format";
import { orderItemCount, orderItemTotal, statusLabel } from "@/lib/orders";
import type { Order } from "@/lib/orders";

const DeliveryMap = dynamic(
  () => import("@/components/customer/DeliveryMap").then((module) => module.DeliveryMap),
  { ssr: false },
);

function statusTone(order: Order): "neutral" | "success" | "warning" | "danger" {
  if (order.status === "cancelled") return "danger";
  if (order.status === "delivered") return "success";
  if (order.is_late) return "warning";
  return "neutral";
}

export function OrderStatusScreen({ publicId }: { publicId: string }) {
  const { order, loading, error, retry } = useOrderLive(publicId);
  const { tracking } = useDeliveryTracking(publicId, order?.status);
  const toast = useToast();
  const [outlet, setOutlet] = useState<OutletResult | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);

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
      {tracking && order.status !== "cancelled" && (
        <section className="delivery-experience" aria-label="Live delivery tracking">
          <div className="tracking-layout">
            <div className="tracking-map"><DeliveryMap tracking={tracking} /></div>
            <div className="tracking-sheet">
              <button
                type="button"
                className="sheet-grab-handle"
                aria-expanded={sheetExpanded}
                onClick={() => setSheetExpanded((prev) => !prev)}
              >
                <span aria-hidden="true">≡</span>
                <span className="sheet-expand-label">{sheetExpanded ? "Show less" : "Show tracking details"}</span>
              </button>
              <div className="sheet-scroll">
                {tracking.stage === "delivered" ? (
                  <>
                    <div className="sheet-status">
                      <p className="customer-eyebrow">Delivered</p>
                      <h2>Your order has arrived</h2>
                      <span className="delivery-sim-badge">Demo delivery · fictional rider</span>
                    </div>
                    <ol className="delivery-stepper" aria-label="Delivery progress">
                      {TRACKING_STEPS.map(([key, label]) => (
                        <li key={key} className={tracking.stage === key || TRACKING_STEPS.findIndex(([s]) => s === key) <= TRACKING_STEPS.findIndex(([s]) => s === tracking.stage) ? "is-done" : ""}>
                          <span aria-hidden="true">✓</span>{label}
                        </li>
                      ))}
                    </ol>
                    <div className="sheet-order-again">
                      <Link className="button button-primary sheet-order-again-button" href="/">
                        Order again
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sheet-header">
                      <div>
                        <p className="customer-eyebrow">Live delivery</p>
                        <h1>
                          {tracking.stage === "rider_assigned"
                            ? `Rider ${tracking.rider?.name ?? "assigned"} is heading to the restaurant`
                            : tracking.stage === "at_restaurant"
                              ? "Your rider is at the restaurant"
                              : tracking.stage === "arriving"
                                ? "Your rider is arriving"
                                : tracking.stage === "on_the_way"
                                  ? "On the way"
                                  : "Preparing your order"}
                        </h1>
                      </div>
                      <span className="delivery-sim-badge">Demo delivery · fictional rider</span>
                    </div>
                    <div className="sheet-eta">
                      <strong>
                        Arriving by {tracking.eta_at ? formatTime(tracking.eta_at) : formatTime(order.promised_at)}
                      </strong>
                      <span>
                        {tracking.minutes_remaining === null
                          ? "We’re finding the best rider."
                          : tracking.minutes_remaining === 0
                            ? "Any moment now"
                            : `${tracking.minutes_remaining} min left · ${tracking.distance_km} km route`}
                      </span>
                    </div>
                    <ol className="delivery-stepper" aria-label="Delivery progress">
                      {TRACKING_STEPS.map(([key, label]) => (
                        <li key={key} className={tracking.stage === key ? "is-current" : TRACKING_STEPS.findIndex(([s]) => s === tracking.stage) > TRACKING_STEPS.findIndex(([s]) => s === key) ? "is-done" : ""}>
                          <span aria-hidden="true">{tracking.stage === key ? "•" : "✓"}</span>{label}
                        </li>
                      ))}
                    </ol>
                    {tracking.rider && (
                      <div className="rider-card">
                        <div className="rider-avatar" aria-hidden="true">{tracking.rider.name.slice(0, 1)}</div>
                        <div>
                          <strong>{tracking.rider.name}</strong>
                          <span>{tracking.rider.vehicle} · ★ {tracking.rider.rating.toFixed(1)}</span>
                          <small>Fictional rider · {tracking.rider.masked_phone}</small>
                        </div>
                        <Button variant="secondary" onClick={() => toast("Calls are simulated in this demo", "info")}>
                          Call rider
                        </Button>
                      </div>
                    )}
                    <div className="sheet-order-items">
                      <h3>Your order</h3>
                      <ul className="sheet-items">
                        {order.items.map((item, index) => (
                          <li key={`${item.name}-${index}`} className="sheet-item">
                            <div>
                              <strong>{item.quantity} × {item.name}</strong>
                              {item.addons.length > 0 && (
                                <span className="sheet-item-addons">{item.addons.map((addon) => addon.name).join(", ")}</span>
                              )}
                            </div>
                            <strong>{formatINR(orderItemTotal(item))}</strong>
                          </li>
                        ))}
                      </ul>
                      <div className="sheet-totals">
                        <div className="sheet-total-row">
                          <span>Subtotal <span className="gst-inline">incl. 5% GST</span></span>
                          <Price amount={order.total_inr - order.delivery_fee_inr - order.gst_included_inr} showGst={false} />
                        </div>
                        {order.coupon_discount_inr > 0 && (
                          <div className="sheet-total-row">
                            <span>Coupon</span>
                            <strong>- {formatINR(order.coupon_discount_inr)}</strong>
                          </div>
                        )}
                        {order.redeemed_points > 0 && (
                          <div className="sheet-total-row">
                            <span>Loyalty points</span>
                            <strong>- {formatINR(order.points_discount_inr)}</strong>
                          </div>
                        )}
                        <div className="sheet-total-row">
                          <span>Delivery fee</span>
                          <strong>{order.delivery_fee_inr === 0 ? "Free" : formatINR(order.delivery_fee_inr)}</strong>
                        </div>
                        <div className="sheet-total-row sheet-gst-row">
                          <span>GST included</span>
                          <strong>{formatINR(order.gst_included_inr)}</strong>
                        </div>
                        <div className="sheet-total-row sheet-grand">
                          <strong>Total</strong>
                          <Price amount={order.total_inr} showGst={false} />
                        </div>
                      </div>
                      <div className="sheet-address">
                        <h3>Deliver to</h3>
                        <p>{order.delivery_address ?? "Address shared with the kitchen."}</p>
                        {order.notes && (
                          <>
                            <h4>Kitchen note</h4>
                            <p>{order.notes}</p>
                          </>
                        )}
                        <p className="sheet-help">For help with this order, contact the kitchen using the number on your payment confirmation.</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
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
        </>
      )}

      {pendingPayment && (
        <div className="order-payment-note" role="status">
          <strong>Payment is still pending.</strong>
          <span>This order won’t reach the kitchen until payment succeeds.</span>
        </div>
      )}

      <div className="order-actions">
        <Link className="button button-secondary order-back-menu" href={`/outlet/${order.outlet_id}`}>
          Back to the menu
        </Link>
        <Link className="order-all-orders" href="/orders">View all orders</Link>
      </div>
    </main>
  );
}
