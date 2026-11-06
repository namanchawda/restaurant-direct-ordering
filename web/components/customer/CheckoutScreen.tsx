"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Price,
  Textarea,
  useToast,
} from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { useCart } from "@/components/customer/CartProvider";
import { api, ApiError } from "@/lib/api";
import {
  cartItemCount,
  cartLineTotal,
  cartSubtotal,
  includedGstAmount,
} from "@/lib/cart";
import {
  cartToOrderItems,
  distanceKm,
  readSavedAddress,
  saveAddress,
  SingleFlightOrderCreator,
  totalsMatch,
} from "@/lib/checkout";
import { formatINR, LOCATION_STORAGE_KEY } from "@/lib/customer";
import { formatItemCount, formatTime } from "@/lib/format";
import type { DeliveryArea, OutletResult } from "@/lib/customer";
import { formatCardNumber, formatExpiry, validatePayment } from "@/lib/payment";
import type { PaymentMethod } from "@/lib/payment";
import { orderItemCount, orderItemTotal } from "@/lib/orders";
import type { Order, PaymentResult } from "@/lib/orders";
import { useAuth } from "@/lib/auth";

type AuthStage = "phone" | "otp" | "name";
type FieldErrors = Record<string, string>;

const FIELD_IDS: Record<string, string> = {
  address: "checkout-address",
  upi_id: "checkout-upi",
  card_number: "checkout-card-number",
  expiry: "checkout-expiry",
  cvv: "checkout-cvv",
};

function readSavedLocation(): DeliveryArea | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      "lat" in parsed &&
      "lng" in parsed &&
      typeof parsed.name === "string" &&
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number"
    ) {
      return parsed as DeliveryArea;
    }
    throw new Error("Saved location has an invalid shape.");
  } catch (error) {
    console.error("Could not restore the saved delivery location.", error);
    window.localStorage.removeItem(LOCATION_STORAGE_KEY);
    return null;
  }
}

function otpMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "Too many codes requested. Please wait a few minutes and try again.";
    }
    if (error.status === 401) {
      return "That code is incorrect or has expired. Check it and try again.";
    }
    if (error.status === 409) return error.message;
    return error.message;
  }
  return "We couldn’t reach the service. Check your connection and try again.";
}

function checkoutMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "We couldn’t reach the service. Check your connection and try again.";
}

function focusFirstError(errors: FieldErrors) {
  const firstKey = Object.keys(errors)[0];
  if (!firstKey) return;
  const target = document.getElementById(FIELD_IDS[firstKey] ?? "");
  target?.focus();
}

export function CheckoutScreen() {
  const router = useRouter();
  const toast = useToast();
  const { cart, hydrated, clearCart } = useCart();
  const { user, ready, requestOtp, verifyOtp, logout } = useAuth();

  const [outlet, setOutlet] = useState<OutletResult | null>(null);
  const [loadedOutletKey, setLoadedOutletKey] = useState("");
  const [outletError, setOutletError] = useState<string | null>(null);
  const [outletAttempt, setOutletAttempt] = useState(0);
  const initialisedOutletRef = useRef("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);

  const [authStage, setAuthStage] = useState<AuthStage>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [nameStage, setNameStage] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const otpRef = useRef("");

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("upi");
  const [upiId, setUpiId] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const orderCreator = useRef(new SingleFlightOrderCreator<Order>());

  const phoneDigits = phone.replace(/\D+/g, "").slice(0, 10);
  const outletRequestKey = cart.outletId ? `${cart.outletId}:${outletAttempt}` : "";
  const outletLoading = Boolean(cart.outletId) && loadedOutletKey !== outletRequestKey;

  useEffect(() => {
    if (!cart.outletId) return;
    let active = true;
    const outletId = cart.outletId;
    api<OutletResult[]>("/outlets")
      .then((outlets) => {
        if (!active) return;
        const selected = outlets.find((candidate) => candidate.id === outletId);
        if (!selected) {
          setOutletError("This kitchen could not be found. Choose another kitchen to continue.");
          setOutlet(null);
          return;
        }
        setOutlet(selected);
        setOutletError(null);

        if (initialisedOutletRef.current === outletId) return;
        const savedLocation = readSavedLocation();
        const savedAddress = readSavedAddress();
        let nextCoords = savedLocation
          ? { lat: savedLocation.lat, lng: savedLocation.lng }
          : { lat: selected.lat, lng: selected.lng };
        let nextAddress = savedLocation
          ? `${savedLocation.name}, Hyderabad`
          : `${selected.name}, Hyderabad`;

        if (savedAddress) {
          const savedDistance = distanceKm(
            savedAddress.lat,
            savedAddress.lng,
            selected.lat,
            selected.lng,
          );
          if (savedDistance <= selected.delivery_radius_km) {
            nextCoords = { lat: savedAddress.lat, lng: savedAddress.lng };
            nextAddress = savedAddress.address;
          }
        }

        setCoords(nextCoords);
        setAddress((current) => current || nextAddress);
        initialisedOutletRef.current = outletId;
      })
      .catch((error: unknown) => {
        if (!active) return;
        setOutletError(checkoutMessage(error));
      })
      .finally(() => {
        if (active) setLoadedOutletKey(outletRequestKey);
      });
    return () => {
      active = false;
    };
  }, [cart.outletId, outletAttempt, outletRequestKey]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (authStage !== "otp" || otp.length !== 6 || authBusy) return;
    if (otpRef.current === otp) return;
    otpRef.current = otp;
    void submitOtp(otp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStage, authBusy, otp]);

  function resetAuth(nextPhone = "") {
    setAuthStage("phone");
    setOtp("");
    setName("");
    setMarketing(false);
    setNameStage(false);
    setAuthError(null);
    setResendIn(0);
    setPhone(nextPhone);
    otpRef.current = "";
  }

  async function sendOtp(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (authBusy) return;
    if (phoneDigits.length !== 10) {
      setAuthError("Enter a 10-digit mobile number.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      await requestOtp(phoneDigits);
      setPhone(phoneDigits);
      setAuthStage("otp");
      setOtp("");
      otpRef.current = "";
      setResendIn(30);
    } catch (error) {
      setAuthError(otpMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitOtp(code: string) {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const signedInUser = await verifyOtp(phoneDigits, code);
      if (!signedInUser.name || signedInUser.name.trim().toLowerCase() === "customer") {
        setNameStage(true);
        setAuthStage("name");
        setName("");
        setMarketing(false);
      } else {
        setNameStage(false);
        setAuthStage("phone");
      }
    } catch (error) {
      setAuthError(otpMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setAuthError("Enter the name the rider should ask for.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      await verifyOtp(phoneDigits, otp, {
        name: trimmed,
        marketingOptIn: marketing,
      });
      setNameStage(false);
      setAuthStage("phone");
    } catch (error) {
      setAuthError(otpMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  function changeContact() {
    resetAuth(user?.phone ?? "");
    setOrder(null);
    setPriceChanged(false);
    setFormError(null);
    logout();
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast("Location is not available in this browser. Enter your address instead.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
        toast("Using your current location for delivery.", "success");
      },
      (error) => {
        setLocating(false);
        toast(
          error.code === error.PERMISSION_DENIED
            ? "Location access was declined. Enter your address instead."
            : "We couldn’t read your location. Enter your address instead.",
          "error",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || submitting) return;
    if (!outlet || !coords) {
      setFormError("Choose a delivery area and enter your address before paying.");
      return;
    }
    if (!outlet.is_open) {
      setFormError("This kitchen is closed right now. Choose another kitchen to order.");
      return;
    }
    const deliveryDistance = distanceKm(coords.lat, coords.lng, outlet.lat, outlet.lng);
    if (deliveryDistance > outlet.delivery_radius_km) {
      setFormError(
        `This address is about ${deliveryDistance.toFixed(1)} km away, outside the ${outlet.delivery_radius_km} km delivery area.`,
      );
      return;
    }
    if (address.trim().length < 5) {
      const errors = { address: "Enter your delivery address." };
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    if (!user || user.role !== "customer") {
      setFormError("Sign in to place your order.");
      return;
    }

    const errors = validatePayment(paymentMethod, { upiId, cardNumber, expiry, cvv });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError("Check your payment details and try again.");
      focusFirstError(errors);
      return;
    }

    setFormError(null);
    submittingRef.current = true;
    setSubmitting(true);
    let currentOrder = order;
    try {
      if (!currentOrder) {
        currentOrder = await orderCreator.current.run(() =>
          api<Order>("/orders", {
            method: "POST",
            body: JSON.stringify({
              outlet_id: outlet.id,
              items: cartToOrderItems(cart.lines),
              payment_method: paymentMethod,
              delivery_address: {
                address: address.trim(),
                lat: coords.lat,
                lng: coords.lng,
              },
              phone: user.phone,
              notes: cart.notes.trim() || undefined,
            }),
          }),
        );
        setOrder(currentOrder);
        if (!totalsMatch(currentOrder.total_inr, cartSubtotal(cart.lines))) {
          setPriceChanged(true);
          return;
        }
      }

      const paymentBody =
        paymentMethod === "upi"
          ? { upi_id: upiId.trim() }
          : { card_number: cardNumber.replace(/\s+/g, "") };
      const result = await api<PaymentResult>(`/orders/${currentOrder.public_id}/pay`, {
        method: "POST",
        body: JSON.stringify(paymentBody),
      });

      if (result.payment_status === "paid") {
        saveAddress({ address: address.trim(), lat: coords.lat, lng: coords.lng });
        clearCart();
        router.push(`/order/${currentOrder.public_id}`);
        return;
      }

      setOrder({
        ...currentOrder,
        payment_status: result.payment_status,
        payment_method: paymentMethod,
      });
      setFormError(
        `Payment failed. Order ${currentOrder.public_id} is saved — try again or switch payment method.`,
      );
    } catch (error) {
      const message = checkoutMessage(error);
      setFormError(
        currentOrder
          ? `${message} Order ${currentOrder.public_id} is saved; you can try payment again.`
          : message,
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!hydrated || !ready) {
    return (
      <main className="customer-page checkout-page">
        <p className="checkout-loading">Loading checkout…</p>
      </main>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <main className="customer-page checkout-page">
        <header className="simple-page-header">
          <Link href="/cart" className="back-link"><span aria-hidden="true">←</span> Cart</Link>
          <div className="header-end">
            <Link className="brand-lockup" href="/" aria-label="Hyderabad Biryani home">
              <span className="brand-mark" aria-hidden="true">H</span>
              <span>Hyderabad Biryani</span>
            </Link>
            <AccountMenu />
          </div>
        </header>
        <EmptyState
          title="Your cart is empty"
          description="Add a dish before continuing to checkout."
          action={<Link className="button button-primary" href="/">Find a kitchen</Link>}
        />
      </main>
    );
  }

  const subtotal = cartSubtotal(cart.lines);
  const gstAmount = includedGstAmount(subtotal);
  const summarySubtotal = order?.total_inr ?? subtotal;
  const summaryGst = order?.gst_included_inr ?? gstAmount;
  const summaryCount = order ? orderItemCount(order) : cartItemCount(cart.lines);
  const displayTotal = order?.total_inr ?? subtotal;
  const deliveryDistance =
    outlet && coords ? distanceKm(coords.lat, coords.lng, outlet.lat, outlet.lng) : null;
  const outsideRadius =
    outlet && deliveryDistance !== null
      ? deliveryDistance > outlet.delivery_radius_km
      : false;
  const signedInCustomer = user?.role === "customer";
  const staffSignedIn = Boolean(user && user.role !== "customer");

  function renderAuth() {
    if (staffSignedIn) {
      return (
        <Card className="checkout-card checkout-auth-card">
          <p className="checkout-step-label">Customer checkout</p>
          <h2>Sign out of the staff account</h2>
          <p className="checkout-card-copy">
            Staff accounts can’t place customer orders. Sign out, then continue with your phone
            number.
          </p>
          <Button
            variant="primary"
            onClick={() => {
              logout();
              resetAuth();
            }}
          >
            Sign out to order
          </Button>
        </Card>
      );
    }

    if (nameStage && user) {
      return (
        <Card className="checkout-card checkout-auth-card">
          <p className="checkout-step-label">Almost done</p>
          <h2>What should we call you?</h2>
          <p className="checkout-card-copy">
            We’ll share this name with the kitchen and rider.
          </p>
          <form className="checkout-auth-form" onSubmit={submitName}>
            <label className="field">
              <span>Your name</span>
              <Input
                autoFocus
                autoComplete="name"
                id="checkout-name"
                maxLength={160}
                name="name"
                placeholder="Name for this order"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(event) => setMarketing(event.target.checked)}
              />
              <span>
                Send me offers by WhatsApp or SMS. Optional, you can opt out any time.
              </span>
            </label>
            <p className="checkout-privacy-note">
              We collect only what we need to deliver your order. Read our{" "}
              <Link href="/privacy">privacy notice</Link>.
            </p>
            {authError && <p className="form-error" role="alert">{authError}</p>}
            <Button className="checkout-auth-submit" type="submit" variant="primary" disabled={authBusy}>
              {authBusy ? "Saving…" : "Continue to delivery"}
            </Button>
            <button type="button" className="checkout-text-link" onClick={changeContact}>
              Use a different number
            </button>
          </form>
        </Card>
      );
    }

    if (authStage === "otp") {
      return (
        <Card className="checkout-card checkout-auth-card">
          <p className="checkout-step-label">Step 2 of 2 · Verify</p>
          <h2>Enter the 6-digit code</h2>
          <p className="checkout-card-copy">
            We sent a code to <strong>{phoneDigits}</strong>. It expires shortly.
          </p>
          <form className="checkout-auth-form" onSubmit={(event) => { event.preventDefault(); void submitOtp(otp); }}>
            <label className="field">
              <span>One-time code</span>
              <Input
                autoFocus
                autoComplete="one-time-code"
                className="otp-input"
                id="checkout-otp"
                inputMode="numeric"
                maxLength={6}
                name="otp"
                pattern="[0-9]*"
                placeholder="000000"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D+/g, "").slice(0, 6))}
              />
            </label>
            {process.env.NEXT_PUBLIC_SHOW_DEV_OTP === "true" && (
              <p className="dev-otp-hint">Dev OTP: 123456</p>
            )}
            {authError && <p className="form-error" role="alert">{authError}</p>}
            <Button className="checkout-auth-submit" type="submit" variant="primary" disabled={authBusy || otp.length !== 6}>
              {authBusy ? "Verifying…" : "Verify code"}
            </Button>
          </form>
          <div className="checkout-auth-actions">
            <button
              type="button"
              className="checkout-text-link"
              onClick={() => void sendOtp()}
              disabled={resendIn > 0 || authBusy}
            >
              {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
            </button>
            <button type="button" className="checkout-text-link" onClick={() => resetAuth(phoneDigits)}>
              Use a different number
            </button>
          </div>
        </Card>
      );
    }

    return (
      <Card className="checkout-card checkout-auth-card">
        <p className="checkout-step-label">Step 1 of 2 · Sign in</p>
        <h2>Continue with your phone</h2>
        <p className="checkout-card-copy">
          We’ll text a one-time code. No password, no account to remember.
        </p>
        <form className="checkout-auth-form" onSubmit={sendOtp}>
          <label className="field">
            <span>Mobile number</span>
            <Input
              autoFocus
              autoComplete="tel"
              id="checkout-phone"
              inputMode="tel"
              maxLength={10}
              name="phone"
              placeholder="10-digit mobile number"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D+/g, "").slice(0, 10))}
            />
          </label>
          {authError && <p className="form-error" role="alert">{authError}</p>}
          <Button className="checkout-auth-submit" type="submit" variant="primary" disabled={authBusy}>
            {authBusy ? "Sending code…" : "Send code"}
          </Button>
        </form>
        <p className="checkout-privacy-note">
          We use your number for this order and delivery updates only. Read our{" "}
          <Link href="/privacy">privacy notice</Link>.
        </p>
      </Card>
    );
  }

  return (
    <main className="customer-page checkout-page">
      <header className="simple-page-header">
        <Link href="/cart" className="back-link"><span aria-hidden="true">←</span> Cart</Link>
        <div className="header-end">
          <Link className="brand-lockup" href="/" aria-label="Hyderabad Biryani home">
            <span className="brand-mark" aria-hidden="true">H</span>
            <span>Hyderabad Biryani</span>
          </Link>
          <AccountMenu />
        </div>
      </header>

      <div className="checkout-heading">
        <div>
          <p className="customer-eyebrow">Checkout</p>
          <h1>Almost at your table</h1>
        </div>
        <span className="checkout-count">{formatItemCount(summaryCount)}</span>
      </div>

      <div className="checkout-layout">
        <div className="checkout-main">
          {!signedInCustomer || nameStage ? (
            renderAuth()
          ) : (
            <form className="checkout-form" onSubmit={placeOrder} noValidate>
              <Card className="checkout-card checkout-contact-card">
                <div className="checkout-contact-row">
                  <div>
                    <p className="checkout-step-label">Contact</p>
                    <h2>{user?.name ?? "Customer"}</h2>
                    <p className="checkout-card-copy">{user?.phone}</p>
                  </div>
                  <button type="button" className="text-button" onClick={changeContact}>
                    Change
                  </button>
                </div>
              </Card>

              <Card className="checkout-card">
                <div className="checkout-card-heading-row">
                  <div>
                    <p className="checkout-step-label">Delivery</p>
                    <h2>Where should we bring it?</h2>
                  </div>
                  <Link className="checkout-text-link" href="/?change=1">Change area</Link>
                </div>

                {outletLoading ? (
                  <p className="checkout-card-copy" role="status">Loading delivery details…</p>
                ) : outletError ? (
                  <div className="checkout-inline-error" role="alert">
                    <p>{outletError}</p>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => setOutletAttempt((attempt) => attempt + 1)}
                    >
                      Try again
                    </Button>
                  </div>
                ) : outlet ? (
                  <>
                    <div className="checkout-outlet-row">
                      <div>
                        <strong>{outlet.name}</strong>
                        <span>
                          {deliveryDistance === null
                            ? outlet.address
                            : `${deliveryDistance.toFixed(1)} km away · ${outlet.address}`}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={useCurrentLocation}
                        disabled={locating}
                      >
                        {locating ? "Finding you…" : "Use my current location"}
                      </Button>
                    </div>

                    <label className="field checkout-address-field">
                      <span>Delivery address</span>
                      <Textarea
                        autoComplete="street-address"
                        error={fieldErrors.address}
                        id="checkout-address"
                        maxLength={500}
                        name="address"
                        placeholder="Flat, building, street, area"
                        rows={3}
                        value={address}
                        onChange={(event) => {
                          setAddress(event.target.value);
                          if (fieldErrors.address) {
                            setFieldErrors((current) => ({ ...current, address: "" }));
                          }
                        }}
                      />
                    </label>
                    <p className="checkout-hint">
                      We share this address only with the kitchen and the delivery partner.
                    </p>

                    {outsideRadius && (
                      <div className="checkout-inline-error" role="alert">
                        This address is about {deliveryDistance?.toFixed(1)} km away, outside the{" "}
                        {outlet.delivery_radius_km} km delivery area for {outlet.name}.{" "}
                        <Link href="/?change=1">Choose a closer kitchen</Link>.
                      </div>
                    )}
                    {!outlet.is_open && (
                      <div className="checkout-inline-error" role="alert">
                        {outlet.name} is closed right now. <Link href="/?change=1">Choose another kitchen</Link>.
                      </div>
                    )}
                  </>
                ) : null}
              </Card>

              <Card className="checkout-card">
                <div className="checkout-card-heading-row">
                  <div>
                    <p className="checkout-step-label">Payment</p>
                    <h2>How would you like to pay?</h2>
                  </div>
                  <Badge tone="warning">Test mode - no real payment</Badge>
                </div>

                <div className="payment-options" role="radiogroup" aria-label="Payment method">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentMethod === "upi"}
                    className={paymentMethod === "upi" ? "payment-option selected" : "payment-option"}
                    onClick={() => {
                      setPaymentMethod("upi");
                      setFieldErrors({});
                      setFormError(null);
                    }}
                  >
                    UPI
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentMethod === "card"}
                    className={paymentMethod === "card" ? "payment-option selected" : "payment-option"}
                    onClick={() => {
                      setPaymentMethod("card");
                      setFieldErrors({});
                      setFormError(null);
                    }}
                  >
                    Card
                  </button>
                </div>

                {paymentMethod === "upi" ? (
                  <div className="checkout-payment-fields">
                    <label className="field">
                      <span>UPI ID</span>
                      <Input
                        autoComplete="username"
                        error={fieldErrors.upi_id}
                        id="checkout-upi"
                        name="upi_id"
                        placeholder="you@bank"
                        value={upiId}
                        onChange={(event) => {
                          setUpiId(event.target.value);
                          if (fieldErrors.upi_id) setFieldErrors((current) => ({ ...current, upi_id: "" }));
                        }}
                      />
                    </label>
                    <p className="checkout-hint">
                      Any UPI ID works. To try a failed payment, use an ID ending in @fail.
                    </p>
                  </div>
                ) : (
                  <div className="checkout-payment-fields">
                    <label className="field">
                      <span>Card number</span>
                      <Input
                        autoComplete="cc-number"
                        error={fieldErrors.card_number}
                        id="checkout-card-number"
                        inputMode="numeric"
                        maxLength={23}
                        name="card_number"
                        placeholder="4242 4242 4242 4242"
                        value={cardNumber}
                        onChange={(event) => {
                          setCardNumber(formatCardNumber(event.target.value));
                          if (fieldErrors.card_number) setFieldErrors((current) => ({ ...current, card_number: "" }));
                        }}
                      />
                    </label>
                    <div className="checkout-card-row">
                      <label className="field">
                        <span>Expiry</span>
                        <Input
                          autoComplete="cc-exp"
                          error={fieldErrors.expiry}
                          id="checkout-expiry"
                          inputMode="numeric"
                          maxLength={5}
                          name="expiry"
                          placeholder="MM/YY"
                          value={expiry}
                          onChange={(event) => {
                            setExpiry(formatExpiry(event.target.value));
                            if (fieldErrors.expiry) setFieldErrors((current) => ({ ...current, expiry: "" }));
                          }}
                        />
                      </label>
                      <label className="field">
                        <span>CVV</span>
                        <Input
                          autoComplete="cc-csc"
                          error={fieldErrors.cvv}
                          id="checkout-cvv"
                          inputMode="numeric"
                          maxLength={4}
                          name="cvv"
                          placeholder="123"
                          type="password"
                          value={cvv}
                          onChange={(event) => {
                            setCvv(event.target.value.replace(/\D+/g, "").slice(0, 4));
                            if (fieldErrors.cvv) setFieldErrors((current) => ({ ...current, cvv: "" }));
                          }}
                        />
                      </label>
                    </div>
                    <p className="checkout-hint">
                      Use 4242 4242 4242 4242. To try a failure, use 4000 0000 0000 0002.
                      Card details stay in this browser and are not saved.
                    </p>
                  </div>
                )}
              </Card>

              <Card className="checkout-card checkout-submit-card">
                {priceChanged && order && (
                  <div className="checkout-price-change" role="status">
                    <strong>The kitchen updated your total to {formatINR(order.total_inr)}.</strong>
                    <span>Review the new total, then tap pay to continue.</span>
                  </div>
                )}
                {order && !priceChanged && (
                  <p className="checkout-saved-order">
                    Order <strong>{order.public_id}</strong> is saved. Payment is still needed.
                  </p>
                )}
                {formError && <p className="checkout-inline-error" role="alert">{formError}</p>}
                <Button
                  className="checkout-place-button"
                  type="submit"
                  variant="primary"
                  disabled={
                    submitting ||
                    outletLoading ||
                    !outlet ||
                    !coords ||
                    outsideRadius ||
                    !outlet.is_open
                  }
                >
                  {submitting
                    ? order ? "Paying…" : "Placing order…"
                    : priceChanged
                      ? `Pay ${formatINR(displayTotal)} now`
                      : order
                        ? `Try payment again · ${formatINR(displayTotal)}`
                        : `Place order · ${formatINR(displayTotal)}`}
                </Button>
                <p className="checkout-hint">
                  By placing this order you agree to our{" "}
                  <Link href="/privacy">privacy notice</Link>. Payment is simulated for this
                  project.
                </p>
              </Card>
            </form>
          )}
        </div>

        <aside className="checkout-summary-panel" aria-label="Order summary">
          <Card className="checkout-summary-card">
            <div className="checkout-summary-heading">
              <h2>Order summary</h2>
              <span>{formatItemCount(summaryCount)}</span>
            </div>
            {outlet && <p className="checkout-summary-outlet">{outlet.name}</p>}
            {order && (
              <p className="checkout-summary-arrival" role="status">
                Arriving by {formatTime(order.promised_at)}
              </p>
            )}
            <ul className="checkout-summary-lines">
              {order
                ? order.items.map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                      <span>
                        {item.quantity} × {item.name}
                        {item.addons.length > 0 && (
                          <small>{item.addons.map((addon) => addon.name).join(", ")}</small>
                        )}
                      </span>
                      <strong>{formatINR(orderItemTotal(item))}</strong>
                    </li>
                  ))
                : cart.lines.map((line) => (
                    <li key={line.id}>
                      <span>
                        {line.quantity} × {line.name}
                        {line.variantName ? ` · ${line.variantName}` : ""}
                        {line.addonNames.length > 0 && (
                          <small>{line.addonNames.join(", ")}</small>
                        )}
                      </span>
                      <strong>{formatINR(cartLineTotal(line))}</strong>
                    </li>
                  ))}
            </ul>
            <div className="cart-total-row">
              <span>Subtotal <span className="gst-inline">incl. 5% GST</span></span>
              <Price amount={summarySubtotal} showGst={false} />
            </div>
            <div className="cart-total-row cart-gst-row">
              <span>GST included</span>
              <strong>{formatINR(summaryGst)}</strong>
            </div>
            <div className="cart-total-row cart-grand-total">
              <strong>Total</strong>
              <Price amount={displayTotal} showGst={false} />
            </div>
            {cart.notes.trim() && (
              <p className="checkout-summary-note">
                Kitchen note: {cart.notes.trim()}
              </p>
            )}
            <p className="checkout-hint">
              Prices include 5% GST. The server confirms availability and the final total before
              payment.
            </p>
          </Card>
        </aside>
      </div>
    </main>
  );
}
