"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, EmptyState, Price, Textarea } from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { useCart } from "@/components/customer/CartProvider";
import { FoodImage } from "@/components/customer/FoodImage";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { api, describeApiError } from "@/lib/api";
import type { OutletMenu } from "@/lib/customer";
import {
  cartItemCount,
  cartLineTotal,
  cartSubtotal,
  includedGstAmount,
} from "@/lib/cart";
import type { CartLine } from "@/lib/cart";
import { formatINR } from "@/lib/customer";
import { DELIVERY_FEE_INR, freeDeliveryStatus } from "@/lib/checkout";
import "@/components/customer/components-theme.css";
import "@/components/customer/home-theme.css";

function RemoveIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function CartLineCard({ line }: { line: CartLine }) {
  const { setQuantity, removeLine } = useCart();
  const selection = [
    line.variantName,
    line.addonNames.length > 0 ? `Add-ons: ${line.addonNames.join(", ")}` : null,
  ].filter(Boolean);

  return (
    <Card className={`cart-line${line.staleReason ? " cart-line-stale" : ""}`}>
      <FoodImage
        src={line.photoUrl}
        name={line.name}
        isVeg={line.isVeg}
        className="cart-line-photo"
        sizes="96px"
      />
      <div className="cart-line-main">
        <div className="cart-line-title">
          <div>
            <strong>{line.name}</strong>
            {selection.length > 0 && <span className="cart-line-selection">{selection.join(" · ")}</span>}
          </div>
          <Price amount={cartLineTotal(line)} showGst={false} />
        </div>
        {line.staleReason && (
          <p className="cart-stale-reason" role="status">{line.staleReason}</p>
        )}
        <div className="cart-line-controls">
          <QuantityStepper
            quantity={line.quantity}
            label={`Quantity of ${line.name}`}
            onDecrease={() => setQuantity(line.id, line.quantity - 1)}
            onIncrease={() => setQuantity(line.id, line.quantity + 1)}
          />
          <button type="button" className="cart-line-remove" aria-label={`Remove ${line.name}`} onClick={() => removeLine(line.id)}>
            <RemoveIcon />
          </button>
        </div>
      </div>
    </Card>
  );
}

export function CartScreen() {
  const { cart, hydrated, setNotes, revalidate } = useCart();
  const [verifiedMenuKey, setVerifiedMenuKey] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const validationKey = `${cart.outletId ?? ""}:${cart.lines.map((line) => line.id).sort().join("|")}`;

  useEffect(() => {
    if (!hydrated || !cart.outletId || cart.lines.length === 0) return;
    let active = true;
    const requestMenu = async () => {
      try {
        const menu = await api<OutletMenu>(`/outlets/${cart.outletId}/menu`);
        if (!active) return;
        revalidate(menu);
        setMenuError(null);
        setVerifiedMenuKey(validationKey);
      } catch (requestError) {
        if (!active) return;
        setMenuError(
          describeApiError(requestError, "We couldn’t verify the latest menu."),
        );
      }
    };
    void requestMenu();
    return () => {
      active = false;
    };
  }, [cart.lines.length, cart.outletId, hydrated, revalidate, validationAttempt, validationKey]);

  const subtotal = cartSubtotal(cart.lines);
  const gstAmount = includedGstAmount(subtotal);
  const freeDelivery = freeDeliveryStatus(subtotal);
  const deliveryFee = freeDelivery.unlocked ? 0 : DELIVERY_FEE_INR;
  const total = subtotal + deliveryFee;
  const staleCount = cart.lines.filter((line) => line.staleReason).length;
  const menuLoading = hydrated && cart.lines.length > 0 && verifiedMenuKey !== validationKey && !menuError;
  const checkoutBlocked = menuLoading || Boolean(menuError) || staleCount > 0;

  return (
    <main className="customer-page cart-page hb-themed">
      <header className="simple-page-header">
        <Link href={cart.outletId ? `/outlet/${cart.outletId}` : "/"} className="back-link">
          <span aria-hidden="true">←</span> Menu
        </Link>
        <div className="header-end">
          <Link className="brand-lockup" href="/">
            <span className="brand-mark" aria-hidden="true">H</span>
            <span>Hyderabad Biryani</span>
          </Link>
          <AccountMenu />
        </div>
      </header>

      <div className="cart-page-heading">
        <div>
          <p className="customer-eyebrow">Almost at your table</p>
          <h1>Your cart</h1>
        </div>
        {cart.lines.length > 0 && (
          <span className="cart-item-count">{cartItemCount(cart.lines)} items</span>
        )}
      </div>

      {!hydrated ? (
        <div className="cart-loading">Loading your saved cart…</div>
      ) : cart.lines.length === 0 ? (
        <EmptyState
          title="Your cart is waiting"
          description="Pick a favorite from the menu and it’ll appear here."
          action={
            <Link
              className="button button-primary"
              href={cart.outletId ? `/outlet/${cart.outletId}` : "/"}
            >
              Browse the menu
            </Link>
          }
        />
      ) : (
        <div className="cart-page-layout">
          <section className="cart-lines" aria-label="Items in your cart">
            {menuLoading && (
              <p className="cart-validation-note" role="status">Checking today’s menu and prices…</p>
            )}
            {menuError && (
              <div className="customer-error cart-validation-error" role="alert">
                <p>{menuError} We’ll keep checkout paused until the menu is verified.</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMenuError(null);
                    setVerifiedMenuKey("");
                    setValidationAttempt((attempt) => attempt + 1);
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
            {cart.lines.map((line) => <CartLineCard key={line.id} line={line} />)}
            <label className="cart-notes-field">
              <span>Order note <span className="optional-label">Optional</span></span>
              <Textarea
                placeholder="Anything the kitchen should know?"
                maxLength={1000}
                value={cart.notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
              />
              <small>Up to 1,000 characters. Please don’t include personal or payment details.</small>
            </label>
            <p className="display-price-disclaimer">
              Prices are shown for reference. The server verifies current prices and availability at order time.
            </p>
          </section>

          <aside className="cart-total-panel" aria-label="Order totals">
            <Card className="cart-total-card">
              <h2>Order summary</h2>
              <div className="cart-summary-total">
                <span>Subtotal <span className="gst-inline">incl. 5% GST</span></span>
                <Price amount={subtotal} showGst={false} />
              </div>
              <div className="cart-summary-total cart-gst-row">
                <span>GST included</span>
                <strong>{formatINR(gstAmount, 2)}</strong>
              </div>
              <div className="cart-summary-total">
                <span>Delivery fee</span>
                <strong>{freeDelivery.unlocked ? "Free" : formatINR(deliveryFee)}</strong>
              </div>
              <div className="cart-summary-total cart-summary-grand">
                <span>Total</span>
                <Price amount={total} showGst={false} />
              </div>
              {staleCount > 0 && (
                <p className="checkout-hint" role="alert">
                  Review or remove {staleCount} changed item{staleCount === 1 ? "" : "s"} before checkout.
                </p>
              )}
              {!menuError && !menuLoading && staleCount === 0 && (
                <p className="checkout-hint">Delivery and payment are selected in the next step.</p>
              )}
              <Link
                className={`button button-primary checkout-button${checkoutBlocked ? " checkout-button-disabled" : ""}`}
                href={checkoutBlocked ? "#" : "/checkout"}
                aria-disabled={checkoutBlocked}
                tabIndex={checkoutBlocked ? -1 : undefined}
                onClick={(event) => {
                  if (checkoutBlocked) event.preventDefault();
                }}
              >
                {menuLoading ? "Verifying menu…" : "PROCEED TO CHECKOUT"}
              </Link>
              <Link
                className="continue-shopping"
                href={cart.outletId ? `/outlet/${cart.outletId}` : "/"}
              >
                Continue browsing
              </Link>
            </Card>
          </aside>
        </div>
      )}
    </main>
  );
}
