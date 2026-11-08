"use client";

import Link from "next/link";
import { Card, Price } from "@/components/ui";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { useCart } from "@/components/customer/CartProvider";
import { FoodImage } from "@/components/customer/FoodImage";
import { cartItemCount, cartLineTotal, cartSubtotal, includedGstAmount } from "@/lib/cart";
import { DELIVERY_FEE_INR, freeDeliveryStatus, FREE_DELIVERY_THRESHOLD_INR } from "@/lib/checkout";
import { formatINR } from "@/lib/customer";

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

export function CartSummary() {
  const { cart, hydrated, setQuantity, removeLine } = useCart();
  const subtotal = cartSubtotal(cart.lines);
  const gstAmount = includedGstAmount(subtotal);
  const freeDelivery = freeDeliveryStatus(subtotal);
  const deliveryFee = freeDelivery.unlocked ? 0 : DELIVERY_FEE_INR;
  const total = subtotal + deliveryFee;

  return (
    <Card className="menu-cart-summary">
      <div className="cart-summary-heading pattern-bg">
        <h2>My cart</h2>
        <span
          className="cart-count-badge"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`Cart: ${cartItemCount(cart.lines)} items`}
        >
          {cartItemCount(cart.lines)}
        </span>
      </div>
      <div className="cart-summary-body">
        {!hydrated ? (
          <p className="cart-summary-muted">Loading your cart…</p>
        ) : cart.lines.length === 0 ? (
          <p className="cart-summary-muted">Add a dish to get started.</p>
        ) : (
          <>
            <ul className="cart-summary-lines">
              {cart.lines.map((line) => {
                const selection = [line.variantName, ...line.addonNames]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={line.id} className="cart-summary-line">
                    <FoodImage
                      src={line.photoUrl}
                      name={line.name}
                      isVeg={line.isVeg}
                      className="cart-summary-line-photo"
                      sizes="64px"
                    />
                    <div className="cart-summary-line-main">
                      <div className="cart-summary-line-title">
                        <div>
                          <strong>{line.name}</strong>
                          {selection && <span className="cart-summary-line-selection">{selection}</span>}
                        </div>
                        <Price amount={cartLineTotal(line)} showGst={false} />
                      </div>
                    </div>
                    <div className="cart-summary-line-controls">
                      <QuantityStepper
                        quantity={line.quantity}
                        label={`Quantity of ${line.name}`}
                        onDecrease={() =>
                          line.quantity > 1
                            ? setQuantity(line.id, line.quantity - 1)
                            : removeLine(line.id)
                        }
                        onIncrease={() => setQuantity(line.id, line.quantity + 1)}
                      />
                      <button
                        type="button"
                        className="cart-summary-line-remove"
                        aria-label={`Remove ${line.name}`}
                        onClick={() => removeLine(line.id)}
                      >
                        <RemoveIcon />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {freeDelivery.unlocked ? (
              <p className="free-delivery-hint unlocked" role="status">
                You&rsquo;ve unlocked free delivery
              </p>
            ) : (
              <>
                <p className="free-delivery-hint">
                  Add Rs {freeDelivery.remainingInr} more for free delivery
                </p>
                <div
                  className="free-delivery-progress"
                  role="progressbar"
                  aria-label="Progress towards free delivery"
                  aria-valuemin={0}
                  aria-valuemax={FREE_DELIVERY_THRESHOLD_INR}
                  aria-valuenow={Math.min(subtotal, FREE_DELIVERY_THRESHOLD_INR)}
                  aria-valuetext={`Rs ${Math.min(subtotal, FREE_DELIVERY_THRESHOLD_INR)} of Rs ${FREE_DELIVERY_THRESHOLD_INR} for free delivery`}
                >
                  <span style={{ width: `${Math.round(freeDelivery.progress * 100)}%` }} />
                </div>
              </>
            )}

            <p className="cart-summary-muted coupon-checkout-note">
              Have a coupon? Apply it at checkout.
            </p>

            <div className="cart-summary-totals">
              <div className="cart-summary-total">
                <span>
                  Subtotal <span className="gst-inline">incl. 5% GST</span>
                </span>
                <Price amount={subtotal} showGst={false} />
              </div>
              <div className="cart-summary-total">
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
            </div>

            <Link className="button button-primary cart-summary-checkout" href="/cart">
              PROCEED TO CHECKOUT
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}
