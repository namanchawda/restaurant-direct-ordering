"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, useToast } from "@/components/ui";
import { api, describeApiError } from "@/lib/api";
import { LOCATION_STORAGE_KEY, OUTLET_STORAGE_KEY } from "@/lib/customer";
import type { OutletResult } from "@/lib/customer";

export function LandingKitchens() {
  const toast = useToast();
  const [outlets, setOutlets] = useState<OutletResult[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      let lat = 17.4649;
      let lng = 78.3639;
      try {
        setSelected(window.localStorage.getItem(OUTLET_STORAGE_KEY));
        const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
        if (raw) {
          const area = JSON.parse(raw) as { lat: number; lng: number };
          if (typeof area?.lat === "number" && typeof area?.lng === "number") { lat = area.lat; lng = area.lng; }
        }
      } catch { /* defaults */ }
      try {
        const result = await api<OutletResult[]>(`/outlets?lat=${lat}&lng=${lng}`);
        if (active) setOutlets(result);
      } catch (reason) {
        if (active) setError(describeApiError(reason, "We couldn't load our kitchens. Please try again."));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [reload]);

  function choose(outlet: OutletResult) {
    window.localStorage.setItem(OUTLET_STORAGE_KEY, outlet.id);
    setSelected(outlet.id);
    toast(`${outlet.name} is now your kitchen.`, "success");
  }

  return (
    <section id="kitchens" className="landing-kitchens">
      <div className="hb-checker" aria-hidden="true" />
      <div className="landing-kitchens-inner">
        <div className="landing-kitchens-list">
          <h2>FIND YOUR<br />KITCHEN</h2>
          {error ? (
            <div role="alert" className="landing-error">
              <p>{error}</p>
              <Button variant="secondary" onClick={() => { setError(null); setLoading(true); setReload((n) => n + 1); }}>Try again</Button>
            </div>
          ) : loading ? (
            <div className="landing-skeleton-card" />
          ) : (
            <ul className="landing-kitchen-rows">
              {outlets.map((outlet) => (
                <li key={outlet.id} className="landing-kitchen-row">
                  <div>
                    <strong>{outlet.name}</strong>
                    <span>{outlet.address}</span>
                    <small>
                      {outlet.is_open ? "Open now" : "Closed now"}
                      {outlet.type === "cloud_kitchen" ? " · Cloud kitchen" : ""}
                      {outlet.distance_km !== null ? ` · ${outlet.distance_km} km away` : ""}
                      {` · FSSAI ${outlet.fssai_number}`}
                    </small>
                  </div>
                  <button type="button" className={`landing-kitchen-select${selected === outlet.id ? " is-on" : ""}`} aria-pressed={selected === outlet.id} onClick={() => choose(outlet)}>
                    {selected === outlet.id ? "Selected" : "Select"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link className="landing-pill-dark" href="/menu">Order from your kitchen</Link>
        </div>
        <div className="landing-kitchens-photo">
          {!photoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/images/kitchen-interior.jpg" alt="Inside a Hyderabad Biryani kitchen" onError={() => setPhotoFailed(true)} />
          ) : (
            <div className="landing-story-fallback" aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
