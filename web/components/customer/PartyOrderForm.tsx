"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Skeleton } from "@/components/ui";
import { api, ApiError, describeApiError } from "@/lib/api";
import type { MenuItem, OutletMenu, OutletResult } from "@/lib/customer";
import { formatINR, OUTLET_STORAGE_KEY } from "@/lib/customer";
import { useAuth } from "@/lib/auth";
import {
  guestLimitMessage,
  isPartySlotValid,
  isValidPartyGuestCount,
  maximumPartyDateInputValue,
  minimumPartyDateTime,
  partyDateInputValue,
  partyTimeInputValue,
  PARTY_MAX_GUESTS,
  PARTY_MIN_GUESTS,
  PARTY_MIN_NOTICE_HOURS,
} from "@/lib/party";

type PartyLine = { itemId: string; variantId: string | null; quantity: number };
type PartyQuote = {
  items: Array<{ item_id: string; name: string; variant: string | null; quantity: number; unit_price_inr: number }>;
  estimated_total_inr: number;
  advance_inr: number;
  minimum_total_inr: number;
  price_note: string;
};
type FieldErrors = Record<string, string>;
type AuthStage = "phone" | "otp";

function allMenuItems(menu: OutletMenu | null): MenuItem[] {
  return menu?.categories.flatMap((category) => category.items) ?? [];
}

function lineKey(line: PartyLine): string {
  return `${line.itemId}:${line.variantId ?? "base"}`;
}

function itemPrice(item: MenuItem, variantId: string | null): number {
  return item.variants.find((variant) => variant.id === variantId)?.price ?? item.price;
}

export function PartyOrderForm() {
  const router = useRouter();
  const { user, ready, requestOtp, verifyOtp } = useAuth();
  const [outlets, setOutlets] = useState<OutletResult[]>([]);
  const [outletId, setOutletId] = useState("");
  const [menu, setMenu] = useState<OutletMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [guests, setGuests] = useState(10);
  const [mode, setMode] = useState<"delivery" | "pickup">("pickup");
  const [address, setAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PartyLine[]>([]);
  const [quote, setQuote] = useState<PartyQuote | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authStage, setAuthStage] = useState<AuthStage>("phone");
  const [authPhone, setAuthPhone] = useState("");
  const [authOtp, setAuthOtp] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const minSlot = useMemo(() => minimumPartyDateTime(), []);
  const items = useMemo(() => allMenuItems(menu), [menu]);
  useEffect(() => {
    if (!ready) return;
    if (user?.role === "customer") {
      // Auth state is external to this form; populate contact defaults when it becomes available.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContactPhone((current) => current || user.phone);
      setContactName((current) => current || (user.name === "Customer" ? "" : user.name ?? ""));
    }
  }, [ready, user]);

  useEffect(() => {
    let active = true;
    api<OutletResult[]>("/outlets")
      .then((result) => {
        if (!active) return;
        const remembered = window.localStorage.getItem(OUTLET_STORAGE_KEY);
        const selected = result.find((outlet) => outlet.id === remembered && outlet.is_open) ?? result.find((outlet) => outlet.is_open) ?? result[0];
        setOutlets(result);
        setOutletId(selected?.id ?? "");
      })
      .catch((error: unknown) => { if (active) setMenuError(describeApiError(error, "We couldn't load kitchens. Please try again.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!outletId) return;
    let active = true;
    api<OutletMenu>(`/outlets/${outletId}/menu`)
      .then((result) => { if (active) setMenu(result); })
      .catch((error: unknown) => { if (active) setMenuError(describeApiError(error, "We couldn't load the party menu. Please try again.")); });
    return () => { active = false; };
  }, [outletId]);

  useEffect(() => {
    if (!outletId || lines.length === 0) {
      return;
    }
    let active = true;
    api<PartyQuote>("/party-orders/quote", { method: "POST", body: JSON.stringify({ outlet_id: outletId, items: lines }) })
      .then((result) => { if (active) setQuote(result); })
      .catch((error: unknown) => { if (active) setFormError(describeApiError(error, "We couldn't refresh the estimate.")); });
    return () => { active = false; };
  }, [outletId, lines]);

  function updateLine(item: MenuItem, variantId: string | null, quantity: number) {
    const nextKey = `${item.id}:${variantId ?? "base"}`;
    setLines((current) => {
      const without = current.filter((line) => lineKey(line) !== nextKey);
      return quantity > 0 ? [...without, { itemId: item.id, variantId, quantity }] : without;
    });
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!isPartySlotValid(eventDate, eventTime)) errors.event_date = `Choose a slot at least ${PARTY_MIN_NOTICE_HOURS} hours from now.`;
    if (!isValidPartyGuestCount(guests)) errors.guests = guestLimitMessage();
    if (mode === "delivery" && !address.trim()) errors.address = "Add a delivery address so the manager can confirm the event.";
    if (!contactName.trim()) errors.contact_name = "Add a contact name for the catering manager.";
    if (!contactPhone.trim()) errors.contact_phone = "Add a contact phone number.";
    if (lines.length === 0) errors.items = "Choose at least one menu item.";
    if (quote && quote.estimated_total_inr < quote.minimum_total_inr) errors.items = `Choose items totalling at least ${formatINR(quote.minimum_total_inr)}.`;
    return errors;
  }

  async function createPartyOrder() {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      document.getElementById(Object.keys(errors)[0] === "items" ? "party-menu" : `party-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    if (!user || user.role !== "customer") {
      setAuthPhone(contactPhone.replace(/\D+/g, "").slice(0, 10));
      setAuthOpen(true);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api<{ public_id: string }>("/party-orders", {
        method: "POST",
        body: JSON.stringify({ outlet_id: outletId, event_date: eventDate, event_time: eventTime, guests, delivery_or_pickup: mode, address: mode === "delivery" ? address.trim() : null, contact_name: contactName.trim(), contact_phone: contactPhone.trim(), notes: notes.trim() || null, items: lines }),
      });
      router.push(`/party/${result.public_id}`);
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(error.fields);
      setFormError(describeApiError(error, "We couldn't send the party request. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;
    const phone = authPhone.replace(/\D+/g, "").slice(0, 10);
    if (phone.length !== 10) { setAuthError("Enter a 10-digit mobile number."); return; }
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (authStage === "phone") {
        await requestOtp(phone);
        setAuthPhone(phone);
        setAuthStage("otp");
      } else {
        await verifyOtp(phone, authOtp);
        setAuthOpen(false);
        await createPartyOrder();
      }
    } catch (error) {
      setAuthError(describeApiError(error, "We couldn't verify that code. Please try again."));
    } finally {
      setAuthBusy(false);
    }
  }

  if (loading) return <main className="party-page"><Skeleton className="party-skeleton" /><Skeleton className="party-skeleton" /></main>;

  return (
    <main className="party-page">
      <div className="party-shell">
        <header className="party-header">
          <Link className="back-link" href="/">← Browse menu</Link>
          <p className="eyebrow">Catering for your table</p>
          <h1>Plan a party, calmly.</h1>
          <p>Tell us the shape of the event. A catering manager will confirm the menu and final details.</p>
        </header>

        <div className="party-notice" role="note"><strong>Needs at least {PARTY_MIN_NOTICE_HOURS} hours notice.</strong><span>Choose a time after {partyDateInputValue(minSlot)} at {partyTimeInputValue(minSlot)}.</span></div>
        {menuError && <div className="customer-error" role="alert"><p>{menuError}</p></div>}

        <form className="party-form" onSubmit={(event) => { event.preventDefault(); void createPartyOrder(); }} noValidate>
          <section className="party-section" aria-labelledby="party-event-heading">
            <div className="party-section-heading"><span className="party-step">1</span><div><p className="eyebrow">Event</p><h2 id="party-event-heading">When should we set the table?</h2></div></div>
            <div className="party-field-grid">
              <label className="field"><span>Date</span><input id="party-event_date" className={`control${fieldErrors.event_date ? " control-error" : ""}`} type="date" min={partyDateInputValue(minSlot)} max={maximumPartyDateInputValue()} value={eventDate} onChange={(event) => setEventDate(event.target.value)} required />{fieldErrors.event_date && <small className="field-error">{fieldErrors.event_date}</small>}</label>
              <label className="field"><span>Time</span><input id="party-event_time" className={`control${fieldErrors.event_date ? " control-error" : ""}`} type="time" min={eventDate === partyDateInputValue(minSlot) ? partyTimeInputValue(minSlot) : undefined} value={eventTime} onChange={(event) => setEventTime(event.target.value)} required /></label>
            </div>
            <div className="field"><span>Guests</span><div className="party-guest-control"><button type="button" aria-label="Decrease guests" onClick={() => setGuests((value) => Math.max(PARTY_MIN_GUESTS, value - 1))}>−</button><strong aria-live="polite">{guests}</strong><button type="button" aria-label="Increase guests" onClick={() => setGuests((value) => Math.min(PARTY_MAX_GUESTS, value + 1))}>+</button><span>people</span></div>{fieldErrors.guests && <small className="field-error">{fieldErrors.guests}</small>}</div>
            <fieldset className="party-choice-group"><legend>Delivery or pickup</legend><label className="party-choice"><input type="radio" checked={mode === "pickup"} onChange={() => setMode("pickup")} />Pickup</label><label className="party-choice"><input type="radio" checked={mode === "delivery"} onChange={() => setMode("delivery")} />Delivery</label></fieldset>
            {mode === "delivery" && <label className="field"><span>Delivery address</span><textarea id="party-address" className="control control-textarea" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Building, street, area" />{fieldErrors.address && <small className="field-error">{fieldErrors.address}</small>}</label>}
          </section>

          <section className="party-section" aria-labelledby="party-menu-heading" id="party-menu">
            <div className="party-section-heading"><span className="party-step">2</span><div><p className="eyebrow">Menu</p><h2 id="party-menu-heading">Choose what sounds right</h2><p className="party-section-copy">The manager checks availability and confirms the final menu. Suggestions are only guidance.</p></div></div>
            <label className="field"><span>Kitchen</span><select className="control control-select" value={outletId} onChange={(event) => { setOutletId(event.target.value); setLines([]); }}><option value="">Choose a kitchen</option>{outlets.map((outlet) => <option value={outlet.id} key={outlet.id}>{outlet.name}</option>)}</select></label>
            <div className="party-item-list">
              {items.map((item) => {
                const current = lines.find((line) => line.itemId === item.id && line.variantId === (item.variants[0]?.id ?? null));
                const selectedVariant = item.variants[0]?.id ?? null;
                const quantity = current?.quantity ?? 0;
                return <article className="party-item-card" key={item.id}><div><strong>{item.name}</strong><p>{item.description}</p>{item.variants.length > 0 && <label className="party-variant"><span className="sr-only">Portion for {item.name}</span><select className="control control-select" value={selectedVariant ?? ""} onChange={(event) => { const next = event.target.value || null; const old = lines.find((line) => line.itemId === item.id); if (old) updateLine(item, next, old.quantity); }}><option value="">Standard · {formatINR(item.price)}</option>{item.variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.name} · {formatINR(variant.price)}</option>)}</select></label>}<span className="party-suggestion">About 1 {item.variants.find((variant) => /family/i.test(variant.name))?.name.toLowerCase() ?? "serving"} per {Math.max(1, Math.round(guests / 4))} guests</span></div><div className="party-item-action">{quantity > 0 ? <div className="quantity-stepper"><button type="button" aria-label={`Decrease ${item.name}`} onClick={() => updateLine(item, selectedVariant, quantity - 1)}>−</button><span aria-live="polite">{quantity}</span><button type="button" aria-label={`Increase ${item.name}`} onClick={() => updateLine(item, selectedVariant, quantity + 1)}>+</button></div> : <Button type="button" variant="secondary" onClick={() => updateLine(item, selectedVariant, 1)}>Add</Button>}<span className="party-unit-price">{formatINR(itemPrice(item, selectedVariant))}</span></div></article>;
              })}
            </div>
            {fieldErrors.items && <small className="field-error">{fieldErrors.items}</small>}
          </section>

          <section className="party-section" aria-labelledby="party-contact-heading">
            <div className="party-section-heading"><span className="party-step">3</span><div><p className="eyebrow">Contact</p><h2 id="party-contact-heading">Who should we speak with?</h2></div></div>
            <div className="party-field-grid"><label className="field"><span>Name</span><input id="party-contact_name" className="control" value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Your name" />{fieldErrors.contact_name && <small className="field-error">{fieldErrors.contact_name}</small>}</label><label className="field"><span>Phone</span><input id="party-contact_phone" className="control" inputMode="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="10-digit mobile number" />{fieldErrors.contact_phone && <small className="field-error">{fieldErrors.contact_phone}</small>}</label></div>
            <label className="field"><span>Notes <em>(optional)</em></span><textarea className="control control-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Dietary needs, arrival details, or anything the manager should know" /></label>
          </section>

          <aside className="party-estimate" aria-live="polite"><div className="party-estimate-summary"><p className="eyebrow">Live estimate</p><h2>{quote ? formatINR(quote.estimated_total_inr) : "Choose menu items"}</h2><p>{quote?.price_note ?? "Prices are confirmed by the manager"}</p>{quote && <ul className="party-estimate-items">{quote.items.map((line) => <li key={line.item_id}><span>{line.quantity} × {line.name}{line.variant ? ` · ${line.variant}` : ""}</span><strong>{formatINR(line.quantity * line.unit_price_inr)}</strong></li>)}</ul>}</div>{quote && <dl><div><dt>Advance</dt><dd>{formatINR(quote.advance_inr)}</dd></div><div><dt>At confirmation</dt><dd>{formatINR(quote.estimated_total_inr)}</dd></div></dl>}</aside>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <Button type="submit" variant="primary" className="party-submit" disabled={submitting || !outletId}>{submitting ? "Sending request…" : user ? "Send party request" : "Sign in and send request"}</Button>
        </form>
      </div>

      <Dialog open={authOpen} onOpenChange={setAuthOpen} title="Sign in to send your request" description="We’ll send a one-time code to your mobile. No password needed.">
        <form className="party-auth-form" onSubmit={(event) => void submitAuth(event)}><label className="field"><span>Mobile number</span><input className="control" inputMode="tel" value={authPhone} onChange={(event) => setAuthPhone(event.target.value)} disabled={authStage === "otp"} autoFocus /></label>{authStage === "otp" && <label className="field"><span>One-time code</span><input className="control" inputMode="numeric" autoComplete="one-time-code" value={authOtp} onChange={(event) => setAuthOtp(event.target.value)} autoFocus /></label>}{authError && <p className="form-error" role="alert">{authError}</p>}<Button type="submit" variant="primary" disabled={authBusy}>{authBusy ? "Checking…" : authStage === "phone" ? "Send code" : "Verify and continue"}</Button></form>
      </Dialog>
    </main>
  );
}
