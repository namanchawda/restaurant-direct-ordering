"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Skeleton, useToast } from "@/components/ui";
import { CartSummary } from "@/components/customer/CartSummary";
import { FoodImage } from "@/components/customer/FoodImage";
import { HeartToggle } from "@/components/customer/HeartToggle";
import { MenuScreen } from "@/components/customer/MenuScreen";
import { SiteHeader } from "@/components/customer/SiteHeader";
import { useCart } from "@/components/customer/CartProvider";
import { api, describeApiError, listFavourites, removeFavourite } from "@/lib/api";
import {
  HYDERABAD_AREAS,
  LOCATION_STORAGE_KEY,
  OUTLET_STORAGE_KEY,
  formatINR,
} from "@/lib/customer";
import type { DeliveryArea, OutletResult } from "@/lib/customer";
import { selectDefaultOutlet } from "@/lib/outlet-selection";
import { useAuth } from "@/lib/auth";
import { useSignIn } from "@/components/auth/SignInProvider";
import { shouldShowWelcome } from "@/lib/welcome";
import "@/components/customer/home-theme.css";
import "@/components/customer/components-theme.css";

const WELCOME_SEEN_KEY = "hyderabad-biryani-welcome-seen";

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
  const { user, ready: authReady } = useAuth();
  const { openSignIn } = useSignIn();
  const [welcome, setWelcome] = useState(false);
  const [areaQuery, setAreaQuery] = useState("");
  const [search, setSearch] = useState("");
  const [favourites, setFavourites] = useState<{ item_id: string; name: string; photo_url: string | null; price_inr: number; is_veg: boolean }[]>([]);

  function markWelcomeSeen() { window.localStorage.setItem(WELCOME_SEEN_KEY, "1"); setWelcome(false); }

  function closeLocation() {
    setLocationOpen(false);
    if (welcome) markWelcomeSeen();
  }

  useEffect(() => { cartRef.current = cart; }, [cart]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const locationStored = !!window.localStorage.getItem(LOCATION_STORAGE_KEY);
      const welcomeSeen = !!window.localStorage.getItem(WELCOME_SEEN_KEY);
      const firstVisit = shouldShowWelcome(locationStored, welcomeSeen);
      setArea(savedArea());
      setAreaReady(true);
      if (firstVisit) { setWelcome(true); setLocationOpen(true); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (welcome && authReady && user && user.role !== "customer") {
      const handle = window.setTimeout(() => {
        setLocationOpen(false);
        markWelcomeSeen();
      }, 0);
      return () => window.clearTimeout(handle);
    }
  }, [welcome, authReady, user]);

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

  useEffect(() => {
    if (!authReady || !(user?.role === "customer")) return;
    let active = true;
    void listFavourites()
      .then((result) => {
        if (active) setFavourites(result);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [authReady, user]);

  function chooseArea(nextArea: DeliveryArea) {
    if (welcome) markWelcomeSeen();
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

  const filteredAreas = HYDERABAD_AREAS.filter((candidate) => candidate.name.toLowerCase().includes(areaQuery.trim().toLowerCase()));

  const favouritesSection = favourites.length > 0 ? (
    <section className="home-favourites-section" aria-labelledby="home-favourites-heading">
      <div className="home-row-heading">
        <p className="customer-eyebrow">Saved for later</p>
        <h2 id="home-favourites-heading">Your favourites</h2>
      </div>
      <div className="home-favourite-scroll" role="list" aria-label="Your favourite dishes">
        {favourites.map((favourite) => (
          <article className="dish-row-card" role="listitem" key={favourite.item_id}>
            <div className="dish-row-main">
              {favourite.photo_url ? (
                <FoodImage
                  src={favourite.photo_url}
                  name={favourite.name}
                  isVeg={favourite.is_veg}
                  className="dish-row-photo"
                  sizes="72px"
                />
              ) : (
                <span className="dish-row-photo dish-row-photo-empty" aria-hidden="true" />
              )}
              <span className="dish-row-copy">
                <strong>{favourite.name}</strong>
                <span>{formatINR(favourite.price_inr)}</span>
              </span>
            </div>
            <HeartToggle
              itemId={favourite.item_id}
              isFavourite
              onToggle={() => {
                setFavourites((current) => current.filter((item) => item.item_id !== favourite.item_id));
                void removeFavourite(favourite.item_id).catch(() => {
                  void listFavourites().then((updated) => setFavourites(updated)).catch(() => undefined);
                });
              }}
            />
          </article>
        ))}
      </div>
    </section>
  ) : null;

  return (
    <main className="customer-page menu-page browse-home hb-themed">
      <div className="hb-checker" aria-hidden="true" />
      <SiteHeader
        area={areaReady ? area : undefined}
        onChangeLocation={() => setLocationOpen(true)}
        onOpenCart={() => setCartOpen(true)}
        search={search}
        onSearch={setSearch}
      />
      {loading && <div className="home-loading"><Skeleton className="home-loading-hero" /><Skeleton className="home-loading-line" /><Skeleton className="home-loading-line short" /></div>}
      {error && <div className="customer-error home-load-error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => setArea({ ...area })}>Try again</Button></div>}
      {outlet && !error && (
        <div id="hb-menu" className="hb-menu-panel">
          <MenuScreen
            outletId={outlet.id}
            browseFirst
            onOpenCart={() => setCartOpen(true)}
            search={search}
            onSearch={setSearch}
            favouritesSection={favouritesSection}
          />
        </div>
      )}
      <div className="hb-checker hb-checker-end" aria-hidden="true" style={{ marginTop: 28 }} />

      <Dialog
        open={locationOpen}
        onOpenChange={(open) => { if (open) setLocationOpen(true); else closeLocation(); }}
        title={welcome ? "Welcome! Where should we deliver?" : "Where should we deliver?"}
        className="location-dialog"
        header={(titleId) => (
          <header className="location-dialog-header">
            <div className="location-dialog-header-copy" id={titleId}>
              {welcome && <span className="location-dialog-script">Welcome</span>}
              <h2>Where should we deliver?</h2>
            </div>
            <button type="button" className="location-dialog-close" aria-label="Close dialog" onClick={closeLocation}>×</button>
          </header>
        )}
      >
        <div className="location-sheet">
          <Button variant="primary" onClick={useCurrentLocation} disabled={locating}>{locating ? "Finding your location…" : "Use my current location"}</Button>
          <label className="field"><span className="sr-only">Search areas</span><input type="search" className="location-search" placeholder="Search your area" value={areaQuery} onChange={(event) => setAreaQuery(event.target.value)} /></label>
          <p className="location-sheet-label">Hyderabad areas</p>
          <div className="area-list" aria-label="Choose a Hyderabad area">
            {filteredAreas.map((candidate) => <button type="button" className={`area-chip${candidate.name === area.name ? " area-chip-selected" : ""}`} key={candidate.name} onClick={() => selectLocation(candidate)}>{candidate.name}</button>)}
            {filteredAreas.length === 0 && <p className="signin-hint">No area matches. Try another name.</p>}
          </div>
          {outlets.length > 1 && <div className="location-outlet-list"><p className="location-sheet-label">Available kitchens nearby</p>{outlets.slice(0, 4).map((candidate) => <button type="button" className="location-outlet-row" key={candidate.id} onClick={() => { selectOutlet(candidate); setLocationOpen(false); }}><span><strong>{candidate.name}</strong><small>{candidate.address}</small></span><span className={candidate.is_open ? "delivery-ok" : "delivery-out"}>{candidate.is_open ? "Open" : "Closed"}</span></button>)}</div>}
          {!user && <p className="signin-hint location-signin">Already ordered before? <button type="button" className="checkout-text-link" onClick={() => { closeLocation(); openSignIn({ mode: "customer" }); }}>Sign in</button></p>}
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