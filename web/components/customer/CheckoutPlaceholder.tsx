"use client";

import Link from "next/link";
import { Card, EmptyState, Price } from "@/components/ui";
import { useCart } from "@/components/customer/CartProvider";
import { cartItemCount, cartSubtotal, includedGstAmount } from "@/lib/cart";
import { formatINR } from "@/lib/customer";

export function CheckoutPlaceholder() {
  const { cart, hydrated } = useCart();
  const total = cartSubtotal(cart.lines);

  return (
    <main className="customer-page checkout-page">
      <header className="simple-page-header">
        <Link href="/cart" className="back-link"><span aria-hidden="true">←</span> Cart</Link>
        <Link className="brand-lockup" href="/">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
      </header>
      {!hydrated ? (
        <p>Loading your cart…</p>
      ) : cart.lines.length === 0 ? (
        <EmptyState
          title="Your cart is empty"
          description="Add a dish before continuing to checkout."
          action={<Link className="button button-primary" href="/">Find a kitchen</Link>}
        />
      ) : (
        <div className="checkout-placeholder-layout">
          <section className="checkout-placeholder-copy">
            <p className="customer-eyebrow">Next step</p>
            <h1>Checkout arrives in the next step</h1>
            <p>Your cart is ready. Delivery details, OTP login and payment will be added next.</p>
            <Link className="button button-secondary" href="/cart">Back to cart</Link>
          </section>
          <Card className="checkout-summary-card">
            <div className="checkout-summary-heading">
              <h2>Cart summary</h2>
              <span>{cartItemCount(cart.lines)} items</span>
            </div>
            <ul className="checkout-summary-lines">
              {cart.lines.map((line) => (
                <li key={line.id}>
                  <span>{line.quantity} × {line.name}{line.variantName ? ` · ${line.variantName}` : ""}</span>
                  <strong>{formatINR((line.unitPrice + line.addonPrices.reduce((sum, price) => sum + price, 0)) * line.quantity)}</strong>
                </li>
              ))}
            </ul>
            <div className="cart-total-row">
              <span>Subtotal <span className="gst-inline">incl. 5% GST</span></span>
              <Price amount={total} showGst={false} />
            </div>
            <div className="cart-total-row cart-gst-row">
              <span>GST included</span>
              <strong>{formatINR(includedGstAmount(total), 2)}</strong>
            </div>
            <div className="cart-total-row cart-grand-total">
              <strong>Total</strong>
              <Price amount={total} showGst={false} />
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
