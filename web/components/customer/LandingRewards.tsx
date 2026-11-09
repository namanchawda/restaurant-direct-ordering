"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useSignIn } from "@/components/auth/SignInProvider";
import { formatINR } from "@/lib/customer";

/* Rules mirror the API: 1 point per Rs 10 paid, 100 points = Rs 50, redeem in steps of 100, max 20% of an order. */
const POINTS_PER_RUPEE = 0.1;
const RUPEES_PER_POINT = 0.5;

const COLLAGE = [
  { src: "/images/collage-1.jpg", alt: "A table of biryani and kebabs to share", sticker: "Share the dum" },
  { src: "/images/collage-2.jpg", alt: "A hand tearing fresh naan", sticker: "Fresh naan" },
  { src: "/images/collage-3.jpg", alt: "A spoonful of slow-cooked haleem", sticker: "Haleem hour" },
  { src: "/images/collage-4.jpg", alt: "A tray of Hyderabadi desserts", sticker: "Sweet finish" },
];

export function LandingRewards() {
  const { user } = useAuth();
  const { openSignIn } = useSignIn();
  const [order, setOrder] = useState(800);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const points = Math.floor(order * POINTS_PER_RUPEE);
  const worth = points * RUPEES_PER_POINT;
  const maxOff = Math.floor(order * 0.2);
  const isCustomer = user?.role === "customer";

  return (
    <>
      <section id="rewards" className="landing-rewards">
        <div className="hb-checker" aria-hidden="true" />
        <div className="landing-rewards-inner">
          <div className="landing-rewards-copy">
            <h2>EARN<br />POINTS</h2>
            <p>Order direct and every order earns points. Points arrive once your order is delivered.</p>
            <div className="landing-slider-card">
              <label htmlFor="rewards-slider">If your order is <strong>{formatINR(order)}</strong></label>
              <input id="rewards-slider" type="range" min={200} max={2000} step={50} value={order} onChange={(event) => setOrder(Number(event.target.value))} />
              <div className="landing-slider-scale" aria-hidden="true"><span>₹200</span><span>₹2,000</span></div>
              <p className="landing-slider-result" aria-live="polite">You earn <strong>{points} points</strong>, worth {formatINR(worth, worth % 1 ? 2 : 0)} off a later order.</p>
              <p className="landing-slider-note">Use points in steps of 100 (100 points = ₹50), up to 20% of an order. On this order that is up to {formatINR(maxOff)}.</p>
            </div>
            {isCustomer ? (
              <Link className="landing-pill-dark" href="/rewards">See my points</Link>
            ) : (
              <button type="button" className="landing-pill-dark" onClick={() => openSignIn({ mode: "customer" })}>Sign in to start earning</button>
            )}
          </div>
          <div className="landing-phone" aria-hidden="true">
            <div className="landing-phone-screen">
              <p className="landing-phone-brand">Hyderabad Biryani</p>
              <div className="landing-phone-ring"><strong>{points}</strong><span>points</span></div>
              <div className="landing-phone-row"><span>Earned on delivery</span><b>+{points}</b></div>
              <div className="landing-phone-row"><span>Worth</span><b>{formatINR(worth, worth % 1 ? 2 : 0)}</b></div>
              <div className="landing-phone-bar"><i style={{ width: `${Math.min(100, (points % 100) || 100)}%` }} /></div>
              <p className="landing-phone-hint">Next ₹50 reward at {Math.ceil((points + 1) / 100) * 100} points</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-collage" aria-label="Food moments">
        <div className="landing-collage-grid">
          {COLLAGE.map((tile, index) => (
            <figure key={tile.src} className={`landing-tile landing-tile-${index + 1}`}>
              {!failed.has(tile.src) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tile.src} alt={tile.alt} loading="lazy" onError={() => setFailed((prev) => new Set(prev).add(tile.src))} />
              ) : (
                <div className="landing-tile-empty" role="img" aria-label={tile.alt} />
              )}
              <figcaption className="landing-tile-sticker">{tile.sticker}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
