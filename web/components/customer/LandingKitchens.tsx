"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, useToast } from "@/components/ui";
import { describeApiError } from "@/lib/api";
import { OUTLET_STORAGE_KEY } from "@/lib/customer";
import type { OutletResult } from "@/lib/customer";
import { loadLandingData, invalidateLandingData } from "@/lib/landing-data";

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

    loadLandingData()
      .then((data) => {
        if (!active) return;
        setOutlets(data.outlets);
        if (!selected) {
          setSelected(window.localStorage.getItem(OUTLET_STORAGE_KEY));
        }
        setLoading(false);
      })
      .catch((reason) => {
        if (!active) return;
        setError(describeApiError(reason, "We couldn't load our kitchens. Please try again."));
        setLoading(false);
      });

    return () => { active = false; };
  }, [reload, selected]);

  function choose(outlet: OutletResult) {
    window.localStorage.setItem(OUTLET_STORAGE_KEY, outlet.id);
    setSelected(outlet.id);
    invalidateLandingData();
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
              <Button variant="secondary" onClick={() => { invalidateLandingData(); setError(null); setLoading(true); setReload((n) => n + 1); }}>Try again</Button>
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
