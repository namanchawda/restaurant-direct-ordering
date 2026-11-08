"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/* Edit these two to change the sticker on the hero image. */
const STICKER = { name: "Chicken dum biryani", price: "₹380" };
const MARQUEE = ["Dum biryani", "Haleem", "Kebabs", "Free delivery over ₹499", "Earn points on every order", "Fresh from the dum pot"];

/* Transparent cutout at /public/images/hero-biryani.png. The illustrated handi shows if it fails to load. */
const BOWL_SRC = "/images/hero-biryani.png";

function Letters({ text, start }: { text: string; start: number }) {
  return (
    <span className="hb-word" aria-hidden="true">
      {text.split("").map((char, index) => (
        <span key={index} style={{ animationDelay: `${start + index * 55}ms` }}>{char}</span>
      ))}
    </span>
  );
}

function HandiFallback() {
  return (
    <svg className="hb-bowl-art" viewBox="0 0 360 300" role="img" aria-label="A handi of Hyderabadi dum biryani">
      <ellipse cx="180" cy="272" rx="130" ry="14" fill="rgba(0,0,0,.22)" />
      <path d="M46 130 Q40 262 180 262 Q320 262 314 130 Z" fill="#2a1410" />
      <path d="M60 140 Q58 250 180 250 Q302 250 300 140 Z" fill="#4a2018" />
      <ellipse cx="180" cy="128" rx="140" ry="34" fill="#2a1410" />
      <ellipse cx="180" cy="124" rx="128" ry="28" fill="#f6c453" />
      <path d="M70 120 Q110 70 180 66 Q250 70 290 120 Q250 140 180 140 Q110 140 70 120Z" fill="#f2b33d" />
      <g fill="#fff3d6">{[[120,104],[150,88],[190,84],[226,96],[250,112],[100,118],[170,108],[210,116],[140,122]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="14" ry="4" transform={`rotate(${(i * 37) % 60 - 30} ${x} ${y})`} />)}</g>
      <g fill="#b5451f">{[[135,96],[200,100],[165,118],[232,108]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="7" />)}</g>
      <g fill="#2f8a4a"><ellipse cx="150" cy="76" rx="14" ry="7" transform="rotate(-25 150 76)" /><ellipse cx="214" cy="80" rx="13" ry="6" transform="rotate(20 214 80)" /></g>
    </svg>
  );
}

export function HomeHero({ areaName, isOpen, outletName }: { areaName?: string; isOpen?: boolean; outletName?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  // onError can fire before React hydrates, so also check once on mount
  useEffect(() => {
    const img = imageRef.current;
    if (img && img.complete && img.naturalWidth === 0) setImageFailed(true);
  }, []);
  const loop = [...MARQUEE, ...MARQUEE];

  return (
    <section className="hb-hero" aria-label="Hyderabadi Biryani">
      <div className="hb-panel">
        <p className="hb-note">
          <svg viewBox="0 0 60 40" aria-hidden="true"><path d="M4 6 C 30 -4, 54 10, 52 34" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><path d="M44 28 L52 35 L56 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Go on, take a bite
        </p>

        <h1 className="hb-title">
          <span className="sr-only">Hyderabadi Biryani</span>
          <Letters text="Hyderabadi" start={150} />
          <Letters text="Biryani" start={800} />
        </h1>

        <div className="hb-copy">
          <p className="hb-tagline">Bold masala.<br />Real dum.</p>
          <div className="hb-actions">
            <a className="hb-btn hb-btn-solid" href="#hb-menu">Order now</a>
            <Link className="hb-btn hb-btn-ghost" href="/party">Plan a party</Link>
          </div>
          <p className="hb-status">
            <span className={`hb-dot${isOpen === false ? " hb-dot-closed" : ""}`} aria-hidden="true" />
            {isOpen === false ? "Kitchen closed right now" : "Open now"}
            {outletName ? ` · ${outletName}` : ""}
            {areaName ? ` · Delivering to ${areaName}` : ""}
          </p>
        </div>

        <div className="hb-stage">
          <div className="hb-steam" aria-hidden="true"><i /><i /><i /></div>
          <div className="hb-bowl">
            {imageFailed ? (
              <HandiFallback />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img ref={imageRef} src={BOWL_SRC} alt="Hyderabadi dum biryani" onError={() => setImageFailed(true)} />
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hb-salan" src="/images/hero-salan.png" alt="Mirchi ka salan in a copper bowl" />
          <div className="hb-price" aria-label={`${STICKER.name}, ${STICKER.price}`}>
            <small>{STICKER.name}</small>
            <strong>{STICKER.price}</strong>
          </div>
          <div className="hb-badge" aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <defs><path id="hb-circle" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" /></defs>
              <text><textPath href="#hb-circle">Dum-cooked daily · Fresh from Kondapur · </textPath></text>
            </svg>
            <span>Dum</span>
          </div>
        </div>
      </div>

      <div className="hb-marquee" aria-hidden="true">
        <div className="hb-marquee-track">
          {loop.map((text, index) => <span key={index}>{text}<b>✦</b></span>)}
        </div>
      </div>
    </section>
  );
}