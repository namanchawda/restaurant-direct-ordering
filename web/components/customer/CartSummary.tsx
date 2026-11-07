"use client";

import Link from "next/link";
import { Card, Price } from "@/components/ui";
import { useCart } from "@/components/customer/CartProvider";
import { cartItemCount, cartSubtotal } from "@/lib/cart";
import { freeDeliveryStatus, FREE_DELIVERY_THRESHOLD_INR } from "@/lib/checkout";
import { formatINR } from "@/lib/customer";

export function CartSummary() {
  const { cart, hydrated } = useCart();
  const subtotal = cartSubtotal(cart.lines);
  const freeDelivery = freeDeliveryStatus(subtotal);

  return (
    <Card className="menu-cart-summary">
      <div className="cart-summary-heading">
        <div>
          <p className="customer-eyebrow">Your order</p>
          <h2>Cart</h2>
        </div>
        <span
          className="cart-count-badge"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`Cart: ${cartItemCount(cart.lines)} items`}
        >
          {cartItemCount(cart.lines)}
        </span>
      </div>
      {!hydrated ? (
        <p className="cart-summary-muted">Loading your cart…</p>
      ) : cart.lines.length === 0 ? (
        <p className="cart-summary-muted">Add a dish to get started.</p>
      ) : (
        <>
          <ul className="cart-summary-lines">
            {cart.lines.slice(0, 4).map((line) => (
              <li key={line.id}>
                <span>
                  {line.quantity} × {line.name}
                  {line.variantName && <small>{line.variantName}</small>}
                </span>
                <strong>{formatINR((line.unitPrice + line.addonPrices.reduce((sum, price) => sum + price, 0)) * line.quantity)}</strong>
              </li>
            ))}
            {cart.lines.length > 4 && (
              <li className="cart-summary-extra">+ {cart.lines.length - 4} more</li>
            )}
          </ul>
          <div className="cart-summary-total">
            <span>Subtotal</span>
            <Price amount={subtotal} showGst={false} />
          </div>
          <p className="cart-summary-gst">incl. 5% GST</p>
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
          <p className="cart-summary-muted coupon-checkout-note">Have a coupon? Apply it at checkout.</p>
          <Link className="button button-primary cart-summary-link" href="/cart">
            View cart
          </Link>
        </>
      )}
    </Card>
  );
}
