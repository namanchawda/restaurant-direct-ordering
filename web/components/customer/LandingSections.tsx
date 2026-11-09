"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, useToast, VegMark } from "@/components/ui";
import { FoodImage } from "@/components/customer/FoodImage";
import { describeApiError } from "@/lib/api";
import { formatINR } from "@/lib/customer";
import type { MenuItem, OutletResult } from "@/lib/customer";
import { useCart } from "@/components/customer/CartProvider";
import { makeCartLine } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { loadLandingData, invalidateLandingData } from "@/lib/landing-data";

const TARGET_NAMES = ["Chicken dum biryani", "Mutton haleem", "Veg biryani", "Seekh kebab"];
const IMAGE_BY_NAME: Record<string, string> = {
  "Chicken dum biryani": "/images/lineup-biryani.png",
  "Mutton haleem": "/images/lineup-haleem.png",
  "Veg biryani": "/images/lineup-veg-biryani.png",
  "Seekh kebab": "/images/lineup-kebab.png",
};
const FILTERS = [
  { label: "All", match: null as string | null },
  { label: "Biryani", match: "biryani" },
  { label: "Kebabs", match: "kebab" },
  { label: "Curries", match: "curr" },
  { label: "Sides", match: "bread" },
];

export function LandingSections() {
  const toast = useToast();
  const { addLine } = useCart();
  const [outlet, setOutlet] = useState<OutletResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineup, setLineup] = useState<MenuItem[]>([]);
  const [pool, setPool] = useState<{ category: string; item: MenuItem }[]>([]);
  const [filter, setFilter] = useState(0);
  const [cravingImgFailed, setCravingImgFailed] = useState(false);
  const [failedCardImages, setFailedCardImages] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;

    loadLandingData()
      .then((data) => {
        if (!active.current) return;
        if (!data.pickedOutlet) {
          setError("No outlet found");
          setLoading(false);
          return;
        }
        setOutlet(data.pickedOutlet);

        const menu = data.menu;
        if (!menu) {
          setLoading(false);
          return;
        }

        const items = menu.categories.flatMap((cat) => cat.items);
        setPool(menu.categories.flatMap((cat) => cat.items.map((item) => ({ category: cat.name.toLowerCase(), item }))));
        const pickedItems: MenuItem[] = [];
        for (const name of TARGET_NAMES) {
          const found = items.find((item) => item.name === name);
          if (found) pickedItems.push(found);
        }
        if (pickedItems.length < 4) {
          for (const item of items) {
            if (!pickedItems.includes(item) && pickedItems.length < 4) {
              pickedItems.push(item);
            }
          }
        }
        setLineup(pickedItems);
        setLoading(false);
      })
      .catch((err) => {
        if (!active.current) return;
        setError(describeApiError(err, "We couldn't load the menu. Please try again."));
        setLoading(false);
      });

    return () => { active.current = false; };
  }, [reloadKey]);

  const handleAdd = useCallback(
    (item: MenuItem, source?: HTMLElement | null) => {
      if (!outlet) return;
      addLine(outlet.id, makeCartLine(item, item.variants[0]?.id ?? null, [], 1));
      if (source) flyToCart(source);
      toast(`1 × ${item.name} added to cart.`, "success");
    },
    [outlet, addLine, toast],
  );

  const retry = useCallback(() => {
    invalidateLandingData();
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }, [setReloadKey]);

  if (error) {
    return (
      <section className="landing-error" role="alert">
        <p>{error}</p>
        <Button variant="secondary" onClick={retry}>Try again</Button>
      </section>
    );
  }

  const cravingItem = lineup[0];

  const activeFilter = FILTERS[filter];
  const shown = activeFilter.match
    ? pool.filter((entry) => entry.category.includes(activeFilter.match as string)).slice(0, 4).map((entry) => entry.item)
    : lineup;
  const TINTS = ["landing-tint-red", "landing-tint-white", "landing-tint-tan", "landing-tint-ink"];

  return (
    <>
      <section id="craving" className="landing-craving">
        <div className="hb-checker" aria-hidden="true" />
        <div className="landing-craving-inner">
          <div className="landing-craving-copy">
            <h2>WHAT&apos;S<br />THE MOOD?</h2>
            <p>Slow-cooked dum biryani, smoky kebabs and Hyderabadi classics, straight from the kitchen nearest you.</p>
            <Link className="landing-pill-dark" href="/menu">Start your order</Link>
            {outlet && <p className="landing-delivery">Delivery or pickup from {outlet.name}</p>}
          </div>
          <div className="landing-craving-photo">
            {!cravingImgFailed && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/images/craving-handi.png" alt="Copper handi of dum biryani" className="landing-craving-img" onError={() => setCravingImgFailed(true)} />
            )}
            {cravingImgFailed && cravingItem && (
              <FoodImage src={cravingItem.photo_url} name={cravingItem.name} isVeg={cravingItem.is_veg} className="landing-craving-fallback" />
            )}
            {cravingItem && <span className="landing-price-sticker">{formatINR(cravingItem.price)}</span>}
          </div>
        </div>
      </section>

      <section id="lineup" className="landing-lineup">
        <div className="hb-checker" aria-hidden="true" />
        <div className="landing-lineup-inner">
          <div className="landing-lineup-header">
            <h2>THE LINEUP</h2>
            <div className="landing-filters" role="group" aria-label="Filter the lineup">
              {FILTERS.map((entry, index) => (
                <button type="button" key={entry.label} className={`landing-filter${filter === index ? " is-active" : ""}`} aria-pressed={filter === index} onClick={() => setFilter(index)}>
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="landing-grid">{[0, 1, 2, 3].map((key) => <div key={key} className="landing-skeleton-card" />)}</div>
          ) : shown.length > 0 ? (
            <div className="landing-grid">
              {shown.map((item, index) => {
                const src = IMAGE_BY_NAME[item.name] ?? item.photo_url;
                const failed = failedCardImages.has(item.id);
                return (
                  <article key={item.id} className={`landing-card ${TINTS[index % 4]}`}>
                    <Link href="/menu" className="landing-card-link" aria-label={`View ${item.name} on the menu`}>
                      <div className="landing-card-visual">
                        {!failed ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt={item.name} className="landing-card-photo" onError={() => setFailedCardImages((prev) => new Set(prev).add(item.id))} />
                        ) : (
                          <FoodImage src={item.photo_url} name={item.name} isVeg={item.is_veg} className="landing-card-photo-fallback" />
                        )}
                      </div>
                      <h3 className="landing-card-name">{item.name}</h3>
                      <p className="landing-card-desc">{item.description}</p>
                    </Link>
                    <div className="landing-card-foot">
                      <span className="landing-card-price">{formatINR(item.price)}</span>
                      <VegMark isVeg={item.is_veg} />
                      {item.available ? (
                        <button type="button" className="landing-add-button" onClick={(event) => handleAdd(item, event.currentTarget)} aria-label={`Add ${item.name} to cart`}>+</button>
                      ) : (
                        <span className="landing-unavailable">Served later</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="landing-empty">No items available right now.</div>
          )}
          <div className="landing-menu-cta">
            <Link className="button button-primary" href="/menu">See the full menu</Link>
            <p className="landing-gst">All prices incl. 5% GST</p>
          </div>
        </div>
        <div className="hb-checker" aria-hidden="true" />
      </section>
    </>
  );
}
