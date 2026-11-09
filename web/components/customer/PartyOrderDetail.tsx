"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Skeleton, useToast } from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { api, describeApiError } from "@/lib/api";
import { formatINR } from "@/lib/customer";

export type PartyOrder = {
  public_id: string;
  event_date: string;
  event_time: string;
  guests: number;
  delivery_or_pickup: "delivery" | "pickup";
  address: string | null;
  contact_name: string;
  contact_phone: string;
  notes: string | null;
  status: "requested" | "confirmed" | "rejected" | "cancelled" | "completed";
  items: Array<{ item_id: string; name: string; variant: string | null; quantity: number; unit_price_inr: number }>;
  estimated_total_inr: number;
  advance_inr: number;
  advance_payment_status: "pending" | "paid" | "failed";
  manager_note: string | null;
  confirmed_at: string | null;
  status_history: Array<{ status: string; at: string; note: string | null }>;
};

const STEPS = ["requested", "confirmed", "advance", "completed"] as const;

function TopBar() {
  return (
    <header className="simple-page-header">
      <Link href="/party/mine" className="back-link"><span aria-hidden="true">←</span> Party orders</Link>
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

function stepIndex(order: PartyOrder): number {
  if (order.status === "completed") return 3;
  if (order.advance_payment_status === "paid") return 2;
  if (order.status === "confirmed") return 1;
  return 0;
}

export function PartyOrderDetail({ publicId }: { publicId: string }) {
  const toast = useToast();
  const [order, setOrder] = useState<PartyOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"upi" | "card">("upi");
  const [upiId, setUpiId] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const result = await api<PartyOrder>(`/party-orders/${encodeURIComponent(publicId)}`);
      setOrder(result);
      setError(null);
    } catch (reason) {
      setError(describeApiError(reason, "We couldn't load this party order."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // The request synchronizes this view with the external API and updates loading/error state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [publicId]); // eslint-disable-line react-hooks/exhaustive-deps

  const canCancel = order?.status === "requested" || order?.status === "confirmed";

  async function payAdvance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ advance_payment_status: string }>(`/party-orders/${encodeURIComponent(publicId)}/pay-advance`, { method: "POST", body: JSON.stringify(paymentMethod === "upi" ? { upi_id: upiId } : { card_number: cardNumber }) });
      setPaymentOpen(false);
      toast(result.advance_payment_status === "paid" ? "Advance payment received." : "Payment failed. Try another test method.", result.advance_payment_status === "paid" ? "success" : "error");
      await load();
    } catch (reason) {
      setError(describeApiError(reason, "We couldn't process the advance payment."));
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!order) return;
    setBusy(true);
    try {
      await api(`/party-orders/${encodeURIComponent(publicId)}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Customer cancelled the party order." }) });
      toast("Party order cancelled.", "success");
      await load();
    } catch (reason) { setError(describeApiError(reason, "We couldn't cancel this party order.")); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="party-page"><TopBar /><div className="party-shell"><Skeleton className="party-skeleton" /><Skeleton className="party-skeleton" /></div></main>;
  if (!order) return <main className="party-page"><TopBar /><div className="party-shell"><div className="empty-state"><h1>Party order unavailable</h1><p>{error ?? "This request may have moved or been removed."}</p><Link className="button button-primary" href="/party">Plan another party</Link></div></div></main>;
  const activeStep = stepIndex(order);

  return <main className="party-page"><TopBar /><div className="party-shell party-detail-shell"><header className="party-header"><p className="eyebrow">{order.public_id}</p><h1>Your party request</h1><p>{order.event_date} at {order.event_time} · {order.guests} guests · {order.delivery_or_pickup}</p></header>{error && <p className="form-error" role="alert">{error}</p>}<ol className="party-status-stepper" aria-label="Party order progress">{STEPS.map((step, index) => <li className={index <= activeStep ? "is-current" : ""} key={step}><span>{index < activeStep ? "✓" : index + 1}</span><strong>{step === "advance" ? "Advance paid" : step[0].toUpperCase() + step.slice(1)}</strong></li>)}</ol>{order.manager_note && <section className="party-note"><p className="eyebrow">Manager note</p><p>{order.manager_note}</p></section>}<section className="party-detail-card"><div className="party-detail-heading"><div><p className="eyebrow">Menu</p><h2>{order.items.length} item{order.items.length === 1 ? "" : "s"}</h2></div><div className="party-detail-total"><span>Estimated total</span><strong>{formatINR(order.estimated_total_inr)}</strong><small>incl. 5% GST</small></div></div><ul className="party-order-items">{order.items.map((item) => <li key={`${item.item_id}-${item.variant ?? "base"}`}><span>{item.quantity} × {item.name}{item.variant ? ` · ${item.variant}` : ""}</span><strong>{formatINR(item.quantity * item.unit_price_inr)}</strong></li>)}</ul><dl className="party-totals"><div><dt>Advance</dt><dd>{formatINR(order.advance_inr)}</dd></div><div><dt>Payment</dt><dd>{order.advance_payment_status === "paid" ? "Paid" : "Due after confirmation"}</dd></div></dl></section>{order.status === "confirmed" && order.advance_payment_status !== "paid" && <section className="party-action-card"><div><h2>Ready for the advance?</h2><p>Mock payment only. Use <strong>customer@fail</strong> or <strong>4000000000000002</strong> to test a declined payment.</p></div>{paymentOpen ? <form className="party-payment-form" onSubmit={(event) => void payAdvance(event)}><fieldset className="party-choice-group"><legend>Payment method</legend><label className="party-choice"><input type="radio" checked={paymentMethod === "upi"} onChange={() => setPaymentMethod("upi")} />UPI</label><label className="party-choice"><input type="radio" checked={paymentMethod === "card"} onChange={() => setPaymentMethod("card")} />Card</label></fieldset>{paymentMethod === "upi" ? <label className="field"><span>UPI ID</span><input className="control" value={upiId} onChange={(event) => setUpiId(event.target.value)} placeholder="customer@ok" required /></label> : <label className="field"><span>Card number</span><input className="control" inputMode="numeric" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} placeholder="4111 1111 1111 1111" required /></label>}<div className="dialog-actions"><Button type="button" variant="secondary" onClick={() => setPaymentOpen(false)}>Not now</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "Processing…" : `Pay ${formatINR(order.advance_inr)}`}</Button></div></form> : <Button variant="primary" onClick={() => setPaymentOpen(true)}>Pay advance · {formatINR(order.advance_inr)}</Button>}</section>}{canCancel && <Button className="button-danger party-cancel-button" variant="danger" onClick={() => void cancel()} disabled={busy}>Cancel party order</Button>}</div></main>;
}
