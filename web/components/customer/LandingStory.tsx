"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { LOCATION_STORAGE_KEY, OUTLET_STORAGE_KEY } from "@/lib/customer";
import type { OutletMenu, OutletResult } from "@/lib/customer";
import { selectDefaultOutlet } from "@/lib/outlet-selection";

/* Edit these three points so they describe what your kitchen really does. */
const POINTS = [
  { title: "Sealed and slow", text: "Each handi is dum-cooked, sealed so the steam stays in." },
  { title: "Layered by hand", text: "Rice, meat and spices are layered, not stirred together." },
  { title: "Cooked to order", text: "We start your order in the kitchen nearest to you." },
];

function istMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function parseWindow(text: string | null | undefined): [number, number] {
  const match = text?.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
  if (!match) return [16 * 60, 23 * 60];
  return [Number(match[1]) * 60 + Number(match[2]), Number(match[3]) * 60 + Number(match[4])];
}

function span(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function LandingStory() {
  const [windowText, setWindowText] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

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
        const outlets = await api<OutletResult[]>(`/outlets?lat=${lat}&lng=${lng}`);
        const picked = selectDefaultOutlet(outlets, remembered);
        if (!picked) return;
        const menu = await api<OutletMenu>(`/outlets/${picked.id}/menu`);
        const haleem = menu.categories.find((c) => c.name.toLowerCase().includes("haleem"));
        if (active && haleem) setWindowText(haleem.window_text);
      } catch { /* the section falls back to the default window */ }
    }
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  const [start, end] = parseWindow(windowText);
  const current = now ? istMinutes(now) : null;
  const serving = current !== null && current >= start && current < end;
  let status = "";
  if (current !== null) {
    if (serving) status = `Serving now · ${span(end - current)} left`;
    else status = `Opens in ${span(current < start ? start - current : 24 * 60 - current + start)}`;
  }
  const label = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  return (
    <>
      <section id="story" className="landing-story">
        <div className="hb-checker" aria-hidden="true" />
        <div className="landing-story-inner">
          <div className="landing-story-copy">
            <h2>WHY IT TASTES<br />LIKE THAT</h2>
            <ul className="landing-story-points">
              {POINTS.map((point) => (
                <li key={point.title}><strong>{point.title}</strong><span>{point.text}</span></li>
              ))}
            </ul>
          </div>
          <div className="landing-story-photo">
            {!photoFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/images/slow-dum.jpg" alt="A handi of dum biryani being opened, steam rising" onError={() => setPhotoFailed(true)} />
            ) : (
              <div className="landing-story-fallback" aria-hidden="true" />
            )}
          </div>
        </div>
      </section>

      <section id="haleem-season" className="landing-season" aria-labelledby="season-title">
        <div className="landing-season-inner">
          <div>
            <p className="scribble">Evenings only</p>
            <h2 id="season-title">HALEEM<br />SEASON</h2>
            <p className="landing-season-text">Slow-cooked haleem is served {label(start)} to {label(end)}.</p>
          </div>
          <div className="landing-season-card">
            <span className={`landing-season-dot${serving ? " is-on" : ""}`} aria-hidden="true" />
            <strong aria-live="polite">{status || "Checking the kitchen…"}</strong>
            <Link className="landing-pill-dark" href="/menu">{serving ? "Order haleem" : "See the menu"}</Link>
          </div>
        </div>
      </section>
    </>
  );
}
