"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Input, Select } from "@/components/ui";
import { useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import {
  KITCHEN_COLUMNS,
  canCancelOrder,
  clampOverrideMinutes,
  customerLabel,
  groupKitchenOrders,
  handedRecently,
  isEscalated,
  lateMinutes,
  nextActionFor,
  orderAgeMinutes,
  overrideMinutesFromCurrent,
  remainingLabel,
  shortOrderId,
  urgencyFor,
} from "@/lib/kitchen";
import type { Order, OrderStatus } from "@/lib/orders";
import { useKitchenConnection, useKitchenSettings } from "@/components/kitchen/KitchenChrome";
import { useKitchenLive } from "@/lib/useKitchenLive";
import type { JustHandedOrder } from "@/lib/useKitchenLive";

const CANCEL_REASONS = [
  "Item is out of stock",
  "Kitchen is too busy",
  "Customer requested cancellation",
  "Delivery partner issue",
  "Other",
];

const EMPTY_COPY: Record<string, string> = {
  new: "No new orders right now.",
  preparing: "Nothing on the pass.",
  ready: "Nothing waiting for a rider.",
};

type CardProps = {
  order: Order;
  now: number;
  busy: boolean;
  onAdvance: (order: Order, status: OrderStatus) => void;
  onCancel: (order: Order) => void;
  onOverride: (order: Order) => void;
  onAcknowledge: (order: Order) => void;
};

const KitchenOrderCard = memo(function KitchenOrderCard({
  order,
  now,
  busy,
  onAdvance,
  onCancel,
  onOverride,
  onAcknowledge,
}: CardProps) {
  const urgency = urgencyFor(order, now);
  const action = nextActionFor(order);
  const lateBy = lateMinutes(order, now);

  return (
    <article
      className={`kd-card kd-urgency-${urgency}`}
      aria-label={`Order ${shortOrderId(order.public_id)} for ${customerLabel(order)}`}
    >
      <div className="kd-card-top">
        <span className="kd-order-id">#{shortOrderId(order.public_id)}</span>
        <span className={`kd-pill kd-pill-${urgency}`}>{remainingLabel(order, now)}</span>
      </div>

      <div className="kd-customer">
        <strong>{customerLabel(order)}</strong>
        <span>
          Placed {formatTime(order.placed_at)} · {orderAgeMinutes(order, now)} min ago
        </span>
      </div>

      <ul className="kd-items">
        {order.items.map((item, index) => (
          <li key={`${item.name}-${index}`}>
            <strong>
              {item.quantity} × {item.name}
            </strong>
            {item.addons.length > 0 && (
              <span>{item.addons.map((addon) => addon.name).join(", ")}</span>
            )}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="kd-note">
          <strong>Kitchen note</strong>
          {order.notes}
        </p>
      )}

      <div className="kd-promise">
        <div>
          <span>Promise</span>
          <strong>{formatTime(order.promised_at)}</strong>
        </div>
        {order.manager_override_minutes !== null && (
          <span className="kd-pill kd-pill-neutral">Manager set</span>
        )}
      </div>

      {isEscalated(order) && (
        <div className="kd-escalation">
          <strong>Manager alert{lateBy > 0 ? ` · ${lateBy} min late` : ""}</strong>
          <span>The promised time has been extended and the customer notified.</span>
        </div>
      )}

      <div className="kd-card-actions">
        {action && (
          <Button
            variant="primary"
            className="kd-primary-action"
            disabled={busy}
            onClick={() => onAdvance(order, action.status)}
          >
            {busy ? "Updating…" : action.label}
          </Button>
        )}
        <div className="kd-secondary-actions">
          <Button variant="secondary" disabled={busy} onClick={() => onOverride(order)}>
            Change time
          </Button>
          {canCancelOrder(order) && (
            <Button variant="danger" disabled={busy} onClick={() => onCancel(order)}>
              Cancel
            </Button>
          )}
        </div>
        {isEscalated(order) && (
          <Button
            variant="secondary"
            className="kd-ack"
            disabled={busy}
            onClick={() => onAcknowledge(order)}
          >
            Acknowledge alert
          </Button>
        )}
      </div>
    </article>
  );
});

export function KitchenBoard() {
  const {
    orders,
    loading,
    error,
    status,
    justHanded,
    newOrderSignal,
    reconnect,
    upsertOrder,
  } = useKitchenLive();
  const { setStatus } = useKitchenConnection();
  const { soundEnabled, enableSound, playChime } = useKitchenSettings();
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [overrideOrder, setOverrideOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [cancelOther, setCancelOther] = useState("");
  const [overrideValue, setOverrideValue] = useState("30");
  const lastBeepSignal = useRef(0);

  useEffect(() => {
    setStatus(status);
  }, [status, setStatus]);

  useEffect(() => {
    return () => setStatus("idle");
  }, [setStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (newOrderSignal === 0 || newOrderSignal === lastBeepSignal.current) return;
    lastBeepSignal.current = newOrderSignal;
    playChime();
  }, [newOrderSignal, playChime]);

  const openCancel = useCallback((order: Order) => {
    setCancelReason(CANCEL_REASONS[0]);
    setCancelOther("");
    setCancelOrder(order);
  }, []);

  const openOverride = useCallback((order: Order) => {
    setOverrideValue(String(overrideMinutesFromCurrent(order, 0)));
    setOverrideOrder(order);
  }, []);

  const groups = useMemo(() => groupKitchenOrders(orders), [orders]);
  const recentHandoffs = useMemo(
    () =>
      justHanded.filter((entry: JustHandedOrder) =>
        handedRecently(entry.at, now),
      ),
    [justHanded, now],
  );

  const transition = useCallback(
    async (order: Order, nextStatus: OrderStatus) => {
      setBusyId(order.public_id);
      try {
        const updated = await api<Order>(
          `/kitchen/orders/${order.public_id}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({ status: nextStatus }),
          },
        );
        upsertOrder(updated);
        if (nextStatus === "handed_to_rider") {
          toast(
            `Order #${shortOrderId(order.public_id)} handed to rider.`,
            "success",
          );
        }
      } catch (reason) {
        toast(
          reason instanceof Error
            ? reason.message
            : "Could not update the order.",
          "error",
        );
      } finally {
        setBusyId(null);
      }
    },
    [toast, upsertOrder],
  );

  const acknowledge = useCallback(
    async (order: Order) => {
      setBusyId(order.public_id);
      try {
        const updated = await api<Order>(
          `/kitchen/orders/${order.public_id}/acknowledge-escalation`,
          { method: "POST" },
        );
        upsertOrder(updated);
        toast("Escalation acknowledged.", "success");
      } catch (reason) {
        toast(
          reason instanceof Error
            ? reason.message
            : "Could not acknowledge the alert.",
          "error",
        );
      } finally {
        setBusyId(null);
      }
    },
    [toast, upsertOrder],
  );

  const applyOverride = useCallback(
    async (order: Order, minutes: number) => {
      setBusyId(order.public_id);
      try {
        const updated = await api<Order>(
          `/kitchen/orders/${order.public_id}/override`,
          {
            method: "PATCH",
            body: JSON.stringify({ minutes: clampOverrideMinutes(minutes) }),
          },
        );
        upsertOrder(updated);
        setOverrideOrder(null);
        toast("Promise time updated.", "success");
      } catch (reason) {
        toast(
          reason instanceof Error
            ? reason.message
            : "Could not update the promise time.",
          "error",
        );
      } finally {
        setBusyId(null);
      }
    },
    [toast, upsertOrder],
  );

  async function submitCancel() {
    if (!cancelOrder) return;
    const reason =
      cancelReason === "Other" ? cancelOther.trim() : cancelReason;
    if (!reason) return;
    setBusyId(cancelOrder.public_id);
    try {
      const updated = await api<Order>(
        `/kitchen/orders/${cancelOrder.public_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "cancelled", reason }),
        },
      );
      upsertOrder(updated);
      setCancelOrder(null);
      toast("Order cancelled.", "success");
    } catch (requestError) {
      toast(
        requestError instanceof Error
          ? requestError.message
          : "Could not cancel the order.",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  }

  const reconnectNote =
    status === "polling"
      ? "Live connection unavailable. Orders refresh every 15 seconds."
      : status === "offline" || status === "reconnecting"
        ? "Reconnecting to the live kitchen feed. Showing the last known orders."
        : null;

  return (
    <div className="kd-page">
      <div className="kd-page-heading">
        <div>
          <p className="eyebrow">Service board</p>
          <h1>Kitchen board</h1>
          <p className="kd-page-subtitle">
            {orders.length} active {orders.length === 1 ? "order" : "orders"} ·{" "}
            {status === "live" ? "updating live" : "last known orders"}
          </p>
        </div>
        <Link className="button button-secondary" href="/kitchen/items">
          Pause items
        </Link>
      </div>

      {!soundEnabled && (
        <div className="kd-banner kd-banner-sound">
          <div>
            <strong>Sound is off.</strong>
            <span>Enable alerts so new paid orders are announced.</span>
          </div>
          <Button variant="secondary" onClick={() => void enableSound()}>
            Enable sound
          </Button>
        </div>
      )}

      {reconnectNote && (
        <div className="kd-banner kd-banner-warning" role="status">
          <div>
            <strong>Feed interrupted.</strong>
            <span>{reconnectNote}</span>
          </div>
          <Button variant="secondary" onClick={reconnect}>
            Retry now
          </Button>
        </div>
      )}

      {recentHandoffs.length > 0 && (
        <div className="kd-handoff" role="status" aria-live="polite">
          <span className="kd-handoff-label">Handed to rider</span>
          {recentHandoffs.map((entry) => (
            <span key={entry.order.public_id} className="kd-pill kd-pill-success">
              #{shortOrderId(entry.order.public_id)} · {customerLabel(entry.order)}
            </span>
          ))}
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="kd-loading" role="status">
          Connecting to the kitchen feed…
        </div>
      ) : error && orders.length === 0 ? (
        <div className="kd-error" role="alert">
          <h2>We couldn’t load the kitchen board</h2>
          <p>{error.message}</p>
          <Button variant="primary" onClick={reconnect}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="kd-board">
          {KITCHEN_COLUMNS.map((column) => {
            const columnOrders = groups[column.id];
            return (
              <section
                key={column.id}
                className="kd-column"
                aria-labelledby={`kd-column-${column.id}`}
              >
                <header className="kd-column-head">
                  <div>
                    <h2 id={`kd-column-${column.id}`}>{column.title}</h2>
                    <span>{column.subtitle}</span>
                  </div>
                  <span className="kd-count" aria-label={`${columnOrders.length} orders`}>
                    {columnOrders.length}
                  </span>
                </header>
                <div className="kd-column-body">
                  {columnOrders.length === 0 ? (
                    <p className="kd-empty">{EMPTY_COPY[column.id]}</p>
                  ) : (
                    columnOrders.map((order) => (
                      <KitchenOrderCard
                        key={order.public_id}
                        order={order}
                        now={now}
                        busy={busyId === order.public_id}
                        onAdvance={transition}
                        onCancel={openCancel}
                        onOverride={openOverride}
                        onAcknowledge={acknowledge}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(cancelOrder)}
        onOpenChange={(open) => !open && setCancelOrder(null)}
        title="Cancel this order?"
        description={
          cancelOrder
            ? `Order #${shortOrderId(cancelOrder.public_id)} will be cancelled immediately.`
            : undefined
        }
        className="kd-dialog"
      >
        <div className="kd-dialog-body">
          <label className="field">
            <span>Reason</span>
            <Select
              id="kd-cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            >
              {CANCEL_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </Select>
          </label>
          {cancelReason === "Other" && (
            <label className="field">
              <span>Tell the customer what happened</span>
              <Input
                value={cancelOther}
                maxLength={500}
                onChange={(event) => setCancelOther(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setCancelOrder(null)}>
            Keep order
          </Button>
          <Button
            variant="danger"
            disabled={
              busyId === cancelOrder?.public_id ||
              (cancelReason === "Other" && !cancelOther.trim())
            }
            onClick={() => void submitCancel()}
          >
            {busyId === cancelOrder?.public_id ? "Cancelling…" : "Cancel order"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(overrideOrder)}
        onOpenChange={(open) => !open && setOverrideOrder(null)}
        title="Change promise time"
        description={
          overrideOrder
            ? `Order #${shortOrderId(overrideOrder.public_id)} is promised by ${formatTime(overrideOrder.promised_at)}.`
            : undefined
        }
        className="kd-dialog"
      >
        <div className="kd-dialog-body">
          <div className="kd-quick-override">
            <Button
              variant="secondary"
              disabled={busyId === overrideOrder?.public_id}
              onClick={() =>
                overrideOrder &&
                void applyOverride(
                  overrideOrder,
                  overrideMinutesFromCurrent(overrideOrder, 5),
                )
              }
            >
              +5 minutes
            </Button>
            <Button
              variant="secondary"
              disabled={busyId === overrideOrder?.public_id}
              onClick={() =>
                overrideOrder &&
                void applyOverride(
                  overrideOrder,
                  overrideMinutesFromCurrent(overrideOrder, 10),
                )
              }
            >
              +10 minutes
            </Button>
          </div>
          <form
            className="kd-custom-override"
            onSubmit={(event) => {
              event.preventDefault();
              if (overrideOrder) {
                void applyOverride(overrideOrder, Number(overrideValue));
              }
            }}
          >
            <label className="field">
              <span>Total minutes from order placed</span>
              <Input
                inputMode="numeric"
                min={1}
                max={240}
                type="number"
                value={overrideValue}
                onChange={(event) => setOverrideValue(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              disabled={busyId === overrideOrder?.public_id}
            >
              {busyId === overrideOrder?.public_id ? "Saving…" : "Set time"}
            </Button>
          </form>
          <p className="kd-dialog-note">
            The customer sees the new time immediately. The promised time includes
            the kitchen’s preparation estimate.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
