"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Dialog,
  Skeleton,
  useToast,
} from "@/components/ui";
import { useCart } from "@/components/customer/CartProvider";
import { api } from "@/lib/api";
import { cartItemCount } from "@/lib/cart";
import {
  HYDERABAD_AREAS,
  LOCATION_STORAGE_KEY,
  OUTLET_STORAGE_KEY,
} from "@/lib/customer";
import type { DeliveryArea, OutletResult } from "@/lib/customer";

type SavedLocation = DeliveryArea;
type PendingOutlet = OutletResult & { area: SavedLocation };

function readSavedLocation(): SavedLocation | null {
  const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const location: unknown = JSON.parse(raw);
    if (
      typeof location === "object" &&
      location !== null &&
      "name" in location &&
      "lat" in location &&
      "lng" in location &&
      typeof location.name === "string" &&
      typeof location.lat === "number" &&
      typeof location.lng === "number"
    ) {
      return location as SavedLocation;
    }
    throw new Error("Saved location has an invalid shape.");
  } catch (error) {
    console.error("Could not restore the saved delivery location.", error);
    window.localStorage.removeItem(LOCATION_STORAGE_KEY);
    return null;
  }
}

export function OutletPicker() {
  const router = useRouter();
  const toast = useToast();
  const { cart, changeOutlet } = useCart();
  const [area, setArea] = useState<SavedLocation | null>(null);
  const [outlets, setOutlets] = useState<OutletResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [pendingOutlet, setPendingOutlet] = useState<PendingOutlet | null>(null);

  useEffect(() => {
    const savedLocation = readSavedLocation();
    const savedOutlet = window.localStorage.getItem(OUTLET_STORAGE_KEY);
    const changeMode = new URLSearchParams(window.location.search).get("change") === "1";
    if (savedLocation && savedOutlet && !changeMode) router.replace(`/outlet/${savedOutlet}`);
  }, [router]);

  useEffect(() => {
    if (!area) return;
    let active = true;
    api<OutletResult[]>(`/outlets?lat=${area.lat}&lng=${area.lng}`)
      .then((result) => {
        if (active) setOutlets(result);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setOutlets([]);
          setError(
            requestError instanceof Error
              ? requestError.message
              : "We couldn’t load nearby kitchens.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [area]);

  function chooseArea(nextArea: SavedLocation) {
    const previousArea = readSavedLocation();
    if (
      previousArea &&
      (previousArea.lat !== nextArea.lat || previousArea.lng !== nextArea.lng)
    ) {
      window.localStorage.removeItem(OUTLET_STORAGE_KEY);
    }
    setArea(nextArea);
    setOutlets([]);
    setLoading(true);
    setError(null);
    window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(nextArea));
  }

  function retryOutlets() {
    if (!area) return;
    setOutlets([]);
    setLoading(true);
    setError(null);
    setArea({ ...area });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast("Location is not available in this browser. Choose a Hyderabad area instead.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current = {
          name: "Current location",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        chooseArea(current);
        setLocating(false);
      },
      (geolocationError) => {
        setLocating(false);
        toast(
          geolocationError.code === geolocationError.PERMISSION_DENIED
            ? "Location access was declined. Choose a Hyderabad area to continue."
            : "We couldn’t read your location. Choose a Hyderabad area to continue.",
          "error",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function selectOutlet(outlet: OutletResult) {
    if (!area) return;
    if (outlet.is_inside_delivery_radius !== true || !outlet.is_open) return;
    const changed = changeOutlet(outlet.id);
    if (!changed) {
      setPendingOutlet({ ...outlet, area });
      return;
    }
    saveSelection(outlet, area);
  }

  function saveSelection(outlet: OutletResult, selectedArea: SavedLocation) {
    window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(selectedArea));
    window.localStorage.setItem(OUTLET_STORAGE_KEY, outlet.id);
    router.push(`/outlet/${outlet.id}`);
  }

  function confirmSwitch() {
    if (!pendingOutlet) return;
    changeOutlet(pendingOutlet.id, true);
    saveSelection(pendingOutlet, pendingOutlet.area);
    setPendingOutlet(null);
  }

  return (
    <main className="customer-page picker-page">
      <header className="customer-topbar">
        <Link className="brand-lockup" href="/" aria-label="Hyderabad Biryani home">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        {cart.lines.length > 0 && (
          <span className="picker-cart-note">{cartItemCount(cart.lines)} items in your cart</span>
        )}
      </header>

      <div className="picker-layout">
        <section className="picker-intro">
          <p className="customer-eyebrow">Hyderabad, cooked close to home</p>
          <h1>Where shall we deliver?</h1>
          <p>Choose your area to see kitchens nearby and check delivery coverage.</p>
          <Button
            variant="primary"
            className="location-button"
            onClick={useCurrentLocation}
            disabled={locating}
          >
            <span aria-hidden="true">⌖</span>
            {locating ? "Finding your location…" : "Use my current location"}
          </Button>
          <p className="location-privacy">Your location is used to find nearby outlets.</p>
        </section>

        <section className="area-section" aria-labelledby="area-heading">
          <div className="section-heading">
            <div>
              <p className="customer-eyebrow">Or choose an area</p>
              <h2 id="area-heading">Hyderabad areas</h2>
            </div>
            {area && <span className="selected-area-label">Showing: {area.name}</span>}
          </div>
          <div className="area-list" aria-label="Choose a Hyderabad area">
            {HYDERABAD_AREAS.map((candidate) => (
              <button
                key={candidate.name}
                type="button"
                className={`area-chip${area?.name === candidate.name ? " area-chip-selected" : ""}`}
                aria-pressed={area?.name === candidate.name}
                onClick={() => chooseArea(candidate)}
              >
                {candidate.name}
              </button>
            ))}
          </div>
        </section>

        <section className="outlets-section" aria-labelledby="outlets-heading">
          <div className="section-heading">
            <div>
              <p className="customer-eyebrow">Nearby kitchens</p>
              <h2 id="outlets-heading">
                {area ? `Serving ${area.name}` : "Choose an area to find outlets"}
              </h2>
            </div>
          </div>
          {loading && (
            <div className="outlet-grid" aria-label="Loading nearby outlets">
              {[0, 1, 2].map((key) => (
                <Card className="outlet-skeleton" key={key}>
                  <Skeleton className="skeleton-line skeleton-title" />
                  <Skeleton className="skeleton-line" />
                  <Skeleton className="skeleton-line skeleton-short" />
                </Card>
              ))}
            </div>
          )}
          {error && (
            <div className="customer-error" role="alert">
              <p>{error}</p>
              <Button variant="secondary" onClick={retryOutlets}>
                Try again
              </Button>
            </div>
          )}
          {!loading && !error && area && outlets.length === 0 && (
            <div className="customer-empty">
              <h3>No kitchens nearby yet</h3>
              <p>Try a neighboring area to see delivery options.</p>
            </div>
          )}
          {!loading && outlets.length > 0 && (
            <div className="outlet-grid">
              {outlets.map((outlet) => {
                const delivers = outlet.is_inside_delivery_radius === true;
                const selectable = delivers && outlet.is_open;
                return (
                  <Card className={`outlet-card${!selectable ? " outlet-card-muted" : ""}`} key={outlet.id}>
                    <div className="outlet-card-top">
                      <div>
                        <h3>{outlet.name}</h3>
                        {outlet.type === "cloud_kitchen" && (
                          <span className="cloud-kitchen-label">Cloud kitchen</span>
                        )}
                      </div>
                      <span className={`outlet-status ${outlet.is_open ? "is-open" : "is-closed"}`}>
                        <span aria-hidden="true">{outlet.is_open ? "●" : "○"}</span>
                        {outlet.is_open ? "Open" : "Closed"}
                      </span>
                    </div>
                    <p className="outlet-address">{outlet.address}</p>
                    <div className="outlet-details">
                      <span>
                        {outlet.distance_km === null
                          ? "Distance unavailable"
                          : `${outlet.distance_km.toFixed(1)} km away`}
                      </span>
                      <span className={delivers ? "delivery-ok" : "delivery-out"}>
                        {delivers ? "Delivers to you" : "Outside delivery area"}
                      </span>
                    </div>
                    <div className="outlet-foot">
                      <span className="fssai-number">FSSAI {outlet.fssai_number}</span>
                      {!selectable && (
                        <span className="outlet-reason">
                          {!outlet.is_open
                            ? "This kitchen is closed right now."
                            : `This location is beyond the ${outlet.delivery_radius_km} km delivery radius.`}
                        </span>
                      )}
                    </div>
                    {selectable ? (
                      <Button
                        variant="primary"
                        className="outlet-select-button"
                        onClick={() => selectOutlet(outlet)}
                      >
                        Choose this kitchen
                      </Button>
                    ) : (
                      <div className="outlet-disabled-note">
                        <span>Not available for delivery here</span>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={pendingOutlet !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOutlet(null);
        }}
        title="Change kitchen?"
        description="Your current cart belongs to another kitchen."
      >
        <div className="switch-cart-body">
          <p>
            Switching to <strong>{pendingOutlet?.name}</strong> will clear the items in your cart.
            You can add them again from the new menu.
          </p>
          <div className="switch-cart-actions">
            <Button variant="secondary" onClick={() => setPendingOutlet(null)}>
              Keep current cart
            </Button>
            <Button variant="primary" onClick={confirmSwitch}>
              Clear cart and switch
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
