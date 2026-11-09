"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, useToast } from "@/components/ui";
import { useCart } from "@/components/customer/CartProvider";
import { api, describeApiError } from "@/lib/api";
import { LOCATION_STORAGE_KEY, OUTLET_STORAGE_KEY, formatINR } from "@/lib/customer";
import type { MenuItem, OutletMenu, OutletResult } from "@/lib/customer";
import { selectDefaultOutlet } from "@/lib/outlet-selection";
import { makeCartLine } from "@/lib/cart";

export function LandingBuilder() {
  const toast = useToast();
  const { addLine } = useCart();
  const [outlet, setOutlet] = useState<OutletResult | null>(null);
  const [dishes, setDishes] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dishId, setDishId] = useState("");
  const [variantId, setVariantId] = useState<string | null>(null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      let lat = 17.4649;
      let lng = 78.3639;
      let remembered: string | null = null;
      try {
        remembered = window.localStorage.getItem(OUTLET_STORAGE_KEY);
        const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
        if (raw) {
          const area = JSON.parse(raw) as { lat: number; lng: number };
          if (typeof area?.lat === "number" && typeof area?.lng === "number") { lat = area.lat; lng = area.lng; }
        }
      } catch { /* use defaults */ }
      try {
        const outlets = await api<OutletResult[]>(`/outlets?lat=${lat}&lng=${lng}`);
        const picked = selectDefaultOutlet(outlets, remembered);
        if (!picked) throw new Error("No outlet found");
        const menu = await api<OutletMenu>(`/outlets/${picked.id}/menu`);
        if (!active) return;
        const biryanis = menu.categories
          .filter((category) => category.available_now && category.name.toLowerCase().includes("biryani"))
          .flatMap((category) => category.items)
          .filter((item) => item.available && item.variants.length > 0);
        setOutlet(picked);
        setDishes(biryanis);
        setDishId(biryanis[0]?.id ?? "");
        setVariantId(biryanis[0]?.variants[0]?.id ?? null);
      } catch (reason) {
        if (active) setError(describeApiError(reason, "We couldn't load the builder. Please try again."));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [reload]);

  const dish = dishes.find((item) => item.id === dishId) ?? null;
  const variant = dish?.variants.find((entry) => entry.id === variantId) ?? null;
  const addons = useMemo(() => dish?.addons.filter((addon) => addonIds.includes(addon.id)) ?? [], [dish, addonIds]);
  const unit = (variant?.price ?? dish?.price ?? 0) + addons.reduce((sum, addon) => sum + addon.price, 0);
  const total = unit * quantity;
  const gst = Math.round((total * 5) / 105);

  function chooseDish(item: MenuItem) {
    setDishId(item.id);
    setVariantId(item.variants[0]?.id ?? null);
    setAddonIds([]);
  }
  function toggleAddon(id: string) {
    setAddonIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }
  function addToCart() {
    if (!dish || !outlet) return;
    addLine(outlet.id, makeCartLine(dish, variantId, addonIds, quantity));
    toast(`${quantity} × ${dish.name} added to cart.`, "success");
  }

  if (error) {
    return (
      <section className="landing-builder" role="alert">
        <div className="landing-builder-inner landing-error">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => { setError(null); setLoading(true); setReload((n) => n + 1); }}>Try again</Button>
        </div>
      </section>
    );
  }
  if (!loading && !dish) return null;

  return (
    <section id="builder" className="landing-builder">
      <div className="hb-checker" aria-hidden="true" />
      <div className="landing-builder-inner">
        <h2>BUILD YOUR<br />HANDI</h2>
        {loading || !dish ? (
          <div className="landing-skeleton-card" />
        ) : (
          <div className="landing-builder-grid">
            <div className="landing-builder-choices">
              <fieldset className="landing-builder-group">
                <legend>1. Pick your biryani</legend>
                <div className="landing-chip-row">
                  {dishes.map((item) => (
                    <button type="button" key={item.id} className={`landing-chip${item.id === dishId ? " is-on" : ""}`} aria-pressed={item.id === dishId} onClick={() => chooseDish(item)}>{item.name.replace(/ biryani/i, "")}</button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="landing-builder-group">
                <legend>2. Choose the portion</legend>
                <div className="landing-chip-row">
                  {dish.variants.map((entry) => (
                    <button type="button" key={entry.id} className={`landing-chip${entry.id === variantId ? " is-on" : ""}`} aria-pressed={entry.id === variantId} onClick={() => setVariantId(entry.id)}>{entry.name} · {formatINR(entry.price)}</button>
                  ))}
                </div>
              </fieldset>
              {dish.addons.length > 0 && (
                <fieldset className="landing-builder-group">
                  <legend>3. Add extras</legend>
                  <div className="landing-chip-row">
                    {dish.addons.map((addon) => (
                      <button type="button" key={addon.id} className={`landing-chip${addonIds.includes(addon.id) ? " is-on" : ""}`} aria-pressed={addonIds.includes(addon.id)} onClick={() => toggleAddon(addon.id)}>{addon.name} +{formatINR(addon.price)}</button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>

            <div className="landing-builder-pot">
              {!imgFailed && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/images/craving-handi.png" alt="Copper handi" onError={() => setImgFailed(true)} />
              )}
            </div>

            <aside className="landing-receipt" aria-label="Your handi receipt">
              <p className="landing-receipt-title">Your order</p>
              <div className="landing-receipt-row"><span>{dish.name}{variant ? ` (${variant.name})` : ""}</span><span>{formatINR(variant?.price ?? dish.price)}</span></div>
              {addons.map((addon) => (
                <div className="landing-receipt-row" key={addon.id}><span>+ {addon.name}</span><span>{formatINR(addon.price)}</span></div>
              ))}
              <div className="landing-receipt-qty">
                <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
                <span aria-live="polite">{quantity}</span>
                <button type="button" aria-label="Increase quantity" onClick={() => setQuantity((q) => Math.min(20, q + 1))}>+</button>
              </div>
              <div className="landing-receipt-row landing-receipt-total"><span>Total</span><span>{formatINR(total)}</span></div>
              <p className="landing-receipt-note">incl. 5% GST ({formatINR(gst)}). Delivery fee is shown at checkout.</p>
              <button type="button" className="landing-receipt-add" onClick={addToCart}>Add to cart</button>
              <Link className="landing-receipt-link" href="/menu">Or browse the full menu</Link>
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}
