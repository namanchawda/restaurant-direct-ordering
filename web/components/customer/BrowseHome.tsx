"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Skeleton, useToast } from "@/components/ui";
import { CartSummary } from "@/components/customer/CartSummary";
import { MenuScreen } from "@/components/customer/MenuScreen";
import { useCart } from "@/components/customer/CartProvider";
import { api, describeApiError } from "@/lib/api";
import {
  HYDERABAD_AREAS,
  LOCATION_STORAGE_KEY,
  OUTLET_STORAGE_KEY,
} from "@/lib/customer";
import type { DeliveryArea, OutletResult } from "@/lib/customer";
import { selectDefaultOutlet } from "@/lib/outlet-selection";

function savedArea(): DeliveryArea {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DeliveryArea;
        if (parsed?.name && typeof parsed.lat === "number" && typeof parsed.lng === "number") return parsed;
      }
    } catch { /* fall through to the friendly default */ }
  }
  return HYDERABAD_AREAS[0];
}

export function BrowseHome() {
  const toast = useToast();
  const { cart, changeOutlet } = useCart();
  const cartRef = useRef(cart);
  const [area, setArea] = useState<DeliveryArea>(HYDERABAD_AREAS[0]);
  const [areaReady, setAreaReady] = useState(false);
  const [outlets, setOutlets] = useState<OutletResult[]>([]);
  const [outlet, setOutlet] = useState<OutletResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [pendingOutlet, setPendingOutlet] = useState<OutletResult | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => { cartRef.current = cart; }, [cart]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setArea(savedArea());
      setAreaReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!areaReady) return;
    window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(area));
    let active = true;
    api<OutletResult[]>(`/outlets?lat=${area.lat}&lng=${area.lng}`)
      .then((result) => {
        if (!active) return;
        setOutlets(result);
        const remembered = window.localStorage.getItem(OUTLET_STORAGE_KEY);
        const next = selectDefaultOutlet(result, remembered);
        const currentCart = cartRef.current;
        if (next && currentCart.lines.length > 0 && currentCart.outletId && next.id !== currentCart.outletId) {
          setPendingOutlet(next);
        } else {
          setOutlet(next);
          if (next) window.localStorage.setItem(OUTLET_STORAGE_KEY, next.id);
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(describeApiError(requestError, "We couldn't load nearby kitchens. Please try again."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [area, areaReady]);

  function chooseArea(nextArea: DeliveryArea) {
    setArea(nextArea);
    setLocationOpen(false);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast("Location is not available here. Choose a Hyderabad area instead.", "info");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        chooseArea({ name: "Current location", lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => { setLocating(false); toast("We couldn't read your location. Choose a Hyderabad area instead.", "info"); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function selectOutlet(next: OutletResult) {
    if (outlet?.id === next.id) return;
    if (!changeOutlet(next.id)) { setPendingOutlet(next); return; }
    saveOutlet(next);
  }

  function saveOutlet(next: OutletResult) {
    setOutlet(next);
    window.localStorage.setItem(OUTLET_STORAGE_KEY, next.id);
    setPendingOutlet(null);
  }

  const selectLocation = (nextArea: DeliveryArea) => {
    chooseArea(nextArea);
  };

  return (
    <main className="customer-page menu-page browse-home">
      {loading && <div className="home-loading"><Skeleton className="home-loading-hero" /><Skeleton className="home-loading-line" /><Skeleton className="home-loading-line short" /></div>}
      {error && <div className="customer-error home-load-error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => setArea({ ...area })}>Try again</Button></div>}
      {outlet && !error && <MenuScreen outletId={outlet.id} browseFirst deliveryArea={area} onChangeLocation={() => setLocationOpen(true)} onOpenCart={() => setCartOpen(true)} />}

      <Dialog open={locationOpen} onOpenChange={setLocationOpen} title="Where should we deliver?" description="Choose an area or share your current location. You can keep browsing either way.">
        <div className="location-sheet">
          <Button variant="primary" onClick={useCurrentLocation} disabled={locating}>{locating ? "Finding your location…" : "Use my current location"}</Button>
          <p className="location-sheet-label">Hyderabad areas</p>
          <div className="area-list" aria-label="Choose a Hyderabad area">
            {HYDERABAD_AREAS.map((candidate) => <button type="button" className={`area-chip${candidate.name === area.name ? " area-chip-selected" : ""}`} key={candidate.name} onClick={() => selectLocation(candidate)}>{candidate.name}</button>)}
          </div>
          {outlets.length > 1 && <div className="location-outlet-list"><p className="location-sheet-label">Available kitchens nearby</p>{outlets.slice(0, 4).map((candidate) => <button type="button" className="location-outlet-row" key={candidate.id} onClick={() => { selectOutlet(candidate); setLocationOpen(false); }}><span><strong>{candidate.name}</strong><small>{candidate.address}</small></span><span className={candidate.is_open ? "delivery-ok" : "delivery-out"}>{candidate.is_open ? "Open" : "Closed"}</span></button>)}</div>}
        </div>
      </Dialog>

      <Dialog open={cartOpen} onOpenChange={setCartOpen} title="Your order" className="cart-drawer-dialog">
        <CartSummary />
        <Button variant="quiet" className="drawer-continue" onClick={() => setCartOpen(false)}>Continue browsing</Button>
      </Dialog>

      <Dialog open={pendingOutlet !== null} onOpenChange={(open) => { if (!open) setPendingOutlet(null); }} title="Change kitchen?" description="Your current cart belongs to another kitchen.">
        <div className="switch-cart-body"><p>Switching to <strong>{pendingOutlet?.name}</strong> will clear the items in your cart. You can add them again from the new menu.</p><div className="switch-cart-actions"><Button variant="secondary" onClick={() => setPendingOutlet(null)}>Keep current cart</Button><Button variant="primary" onClick={() => pendingOutlet && (changeOutlet(pendingOutlet.id, true), saveOutlet(pendingOutlet))}>Clear cart and switch</Button></div></div>
      </Dialog>
    </main>
  );
}
