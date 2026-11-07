"use client";

import { useState } from "react";
import { Button, Dialog, Skeleton, useToast } from "@/components/ui";
import { api, describeApiError } from "@/lib/api";
import { formatINR } from "@/lib/customer";
import type { CateringPartyOrder } from "@/lib/catering";

type Props = {
  open: boolean;
  order: CateringPartyOrder;
  onClose: () => void;
  onOrderUpdated: () => void;
};

const REJECT_REASONS = [
  "Customer cancelled",
  "Item unavailable",
  "Unable to contact customer",
  "Event date not feasible",
  "Other",
];

function eventPassed(date: string, time: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi).getTime() <= new Date().getTime();
}

export function CateringOrderDetail({ open, order, onClose, onOrderUpdated }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"detail" | "confirm">("detail");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [managerNote, setManagerNote] = useState("");
  const [adjustedTotal, setAdjustedTotal] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectFreeText, setRejectFreeText] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const totalChanged =
    adjustedTotal.trim() !== "" && Number(adjustedTotal) !== order.estimated_total_inr;
  const confirmFormInvalid =
    totalChanged && !managerNote.trim();

  async function handleConfirm() {
    setConfirmError(null);
    if (confirmFormInvalid) {
      setConfirmError("A manager note is required when changing the total.");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { manager_note: managerNote.trim() || null };
      if (totalChanged) body.adjusted_total_inr = Number(adjustedTotal);
      await api(`/catering/party-orders/${encodeURIComponent(order.public_id)}/confirm`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setConfirmOpen(false);
      setStage("detail");
      setManagerNote("");
      setAdjustedTotal("");
      toast("Party order confirmed.", "success");
      onOrderUpdated();
    } catch (reason) {
      setConfirmError(describeApiError(reason, "We couldn't confirm this party order."));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setRejectError(null);
    const reason = rejectReason === "Other" ? rejectFreeText.trim() : rejectReason;
    if (!reason) {
      setRejectError("A reason is required to reject the party order.");
      return;
    }
    setBusy(true);
    try {
      await api(`/catering/party-orders/${encodeURIComponent(order.public_id)}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      setRejectOpen(false);
      setRejectReason("");
      setRejectFreeText("");
      toast("Party order rejected.", "success");
      onOrderUpdated();
    } catch (reasonErr) {
      setRejectError(describeApiError(reasonErr, "We couldn't reject this party order."));
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    setBusy(true);
    try {
      await api(`/catering/party-orders/${encodeURIComponent(order.public_id)}/complete`, {
        method: "PATCH",
      });
      toast("Party order marked completed.", "success");
      onOrderUpdated();
      onClose();
    } catch (reason) {
      toast(describeApiError(reason, "We couldn't mark this party order completed."), "error");
    } finally {
      setBusy(false);
    }
  }

  if (busy && stage === "detail") {
    return (
      <Dialog open onOpenChange={() => {}} title="Updating…">
        <div className="dialog-content" style={{ padding: 40, textAlign: "center" }}>
          <Skeleton className="catering-skeleton" />
          <p className="catering-loading-copy">Updating…</p>
        </div>
      </Dialog>
    );
  }

  const canComplete = order.status === "confirmed" && eventPassed(order.event_date, order.event_time);

  return (
    <Dialog open={open} onOpenChange={onClose} title={order.public_id} className="catering-detail-dialog">
      <div className="dialog-content">
        <header className="catering-detail-head">
          <Button variant="quiet" className="catering-detail-close" type="button" onClick={onClose}>
            ← Back
          </Button>
          <div>
            <h2>Party order</h2>
            <p className="catering-detail-status">
              {order.status === "requested" ? "Awaiting action" : order.status[0].toUpperCase() + order.status.slice(1)}
            </p>
          </div>
        </header>

        {stage === "detail" ? (
          <section className="catering-detail-body">
            <div className="catering-detail-section">
              <p className="catering-detail-section-title">Customer contact</p>
              <p className="catering-detail-contact-name">{order.contact_name}</p>
              <p className="catering-detail-contact-phone">{order.contact_phone}</p>
              {order.address && (
                <p className="catering-detail-contact-address">{order.address}</p>
              )}
            </div>

            <div className="catering-detail-section">
              <p className="catering-detail-section-title">Menu</p>
              <ul className="catering-detail-items">
                {order.items.map((item) => (
                  <li key={`${item.item_id}-${item.variant ?? "base"}`}>
                    <span>{item.quantity} × {item.name}{item.variant ? ` · ${item.variant}` : ""}</span>
                    <strong>{formatINR(item.quantity * item.unit_price_inr)}</strong>
                  </li>
                ))}
              </ul>
            </div>

            {order.notes && (
              <div className="catering-detail-section">
                <p className="catering-detail-section-title">Notes</p>
                <p className="catering-detail-notes">{order.notes}</p>
              </div>
            )}

            <div className="catering-detail-section catering-detail-totals">
              <p className="catering-detail-section-title">Totals</p>
              <div className="catering-total-row"><span>Estimated total</span><strong>{formatINR(order.estimated_total_inr)}</strong></div>
              <div className="catering-total-row"><span>Advance (25%)</span><strong>{formatINR(order.advance_inr)}</strong></div>
              <div className="catering-total-row"><span>{order.price_note}</span></div>
            </div>

            <div className="catering-detail-actions">
              {order.status === "requested" && (
                <>
                  <Button type="button" variant="primary" onClick={() => setStage("confirm")} disabled={busy}>
                    Confirm order
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setRejectOpen(true)} disabled={busy}>
                    Reject order
                  </Button>
                </>
              )}
              {order.status === "confirmed" && canComplete && (
                <Button type="button" variant="secondary" onClick={handleComplete} disabled={busy}>
                  Mark completed
                </Button>
              )}
            </div>
          </section>
        ) : (
          <section className="catering-detail-confirm">
            <p className="catering-detail-section-title">Confirm party order</p>
            <p className="catering-detail-copy">Add a manager note and, optionally, adjust the total before confirming.</p>
            <label className="field">
              <span>Manager note</span>
              <textarea
                className="control control-textarea"
                value={managerNote}
                onChange={(event) => setManagerNote(event.target.value)}
                placeholder="Notes for the customer and kitchen"
              />
            </label>
            <label className="field">
              <span>Adjusted total (INR)</span>
              <input
                className="control"
                type="number"
                min="0"
                value={adjustedTotal}
                onChange={(event) => setAdjustedTotal(event.target.value)}
                placeholder={String(order.estimated_total_inr)}
              />
              {totalChanged && <p className="catering-adjusted-hint">Adjusted from {formatINR(order.estimated_total_inr)} to {formatINR(Number(adjustedTotal))}.</p>}
            </label>
            {confirmFormInvalid && confirmError && <p className="form-error" role="alert">{confirmError}</p>}
            <div className="catering-detail-actions">
              <Button type="button" variant="secondary" onClick={() => setStage("detail")}>Back to order</Button>
              <Button type="button" variant="primary" onClick={() => setConfirmOpen(true)} disabled={busy || confirmFormInvalid}>
                {busy ? "Confirming…" : "Confirm party order"}
              </Button>
            </div>
          </section>
        )}

        {confirmOpen && (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Confirm this party order?">
            <div className="dialog-content">
              <p>This will confirm the order and make the advance due.</p>
              <div className="dialog-actions">
                <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>Not yet</Button>
                <Button type="button" variant="primary" onClick={handleConfirm} disabled={busy}>
                  Confirm
                </Button>
              </div>
            </div>
          </Dialog>
        )}

        {rejectOpen && (
          <Dialog open={rejectOpen} onOpenChange={setRejectOpen} title="Reject party order">
            <div className="dialog-content">
              <p>Select a reason. Choose Other to enter your own.</p>
              <div className="catering-reason-list" role="radiogroup" aria-label="Rejection reason">
                {REJECT_REASONS.map((reason) => (
                  <label key={reason} className="catering-reason-choice">
                    <input
                      type="radio"
                      name="reject-reason"
                      value={reason}
                      checked={rejectReason === reason}
                      onChange={() => { setRejectReason(reason); if (reason !== "Other") setRejectFreeText(""); }}
                    />
                    {reason}
                  </label>
                ))}
                {rejectReason === "Other" && (
                  <label className="field">
                    <span>Your reason</span>
                    <input className="control" value={rejectFreeText} onChange={(event) => setRejectFreeText(event.target.value)} placeholder="Tell us why" />
                  </label>
                )}
              </div>
              {rejectError && <p className="form-error" role="alert">{rejectError}</p>}
              <div className="dialog-actions">
                <Button type="button" variant="secondary" onClick={() => setRejectOpen(false)}>Cancel</Button>
                <Button type="button" variant="primary" onClick={handleReject} disabled={busy}>
                  {busy ? "Rejecting…" : "Reject order"}
                </Button>
              </div>
            </div>
          </Dialog>
        )}
      </div>
    </Dialog>
  );
}
