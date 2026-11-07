"use client";

import { useEffect, useRef, useState } from "react";
import type { Tracking } from "@/lib/delivery";

const markerIcons = {
  outlet: `<path d="M16 1C8.82 1 3 6.82 3 14c0 9.1 13 24 13 24s13-14.9 13-24C29 6.82 23.18 1 16 1Z" fill="#9b3b2f" stroke="#fff" stroke-width="2"/><circle cx="16" cy="14" r="5" fill="#fff"/>`,
  home: `<path d="M16 1C8.82 1 3 6.82 3 14c0 9.1 13 24 13 24s13-14.9 13-24C29 6.82 23.18 1 16 1Z" fill="#247248" stroke="#fff" stroke-width="2"/><path d="m10 14 6-5 6 5v7h-4v-4h-4v4h-4Z" fill="#fff"/>`,
  rider: `<path d="M16 1C8.82 1 3 6.82 3 14c0 9.1 13 24 13 24s13-14.9 13-24C29 6.82 23.18 1 16 1Z" fill="#241d1b" stroke="#fff" stroke-width="2"/><circle cx="16" cy="11" r="3" fill="#fff"/><path d="m10 21 3-7h5l4 7h-3l-2-4-2 4Z" fill="#fff"/>`,
} as const;

function markerMarkup(icon: keyof typeof markerIcons, label: string) {
  return `<div class="delivery-marker-content"><svg viewBox="0 0 32 40" aria-hidden="true">${markerIcons[icon]}</svg><span>${label}</span></div>`;
}

function point(point: { lat: number; lng: number }, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  const x = 12 + ((point.lng - bounds.minLng) / Math.max(0.0001, bounds.maxLng - bounds.minLng)) * 76;
  const y = 12 + (1 - (point.lat - bounds.minLat) / Math.max(0.0001, bounds.maxLat - bounds.minLat)) * 76;
  return { x, y };
}

export function DeliveryMap({ tracking }: { tracking: Tracking }) {
  const [leafletReady, setLeafletReady] = useState(false);
  const mapCanvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let removeMap: (() => void) | undefined;
    const showFallback = () => {
      removeMap?.();
      removeMap = undefined;
      if (!disposed) setLeafletReady(false);
    };

    void import("leaflet").then((L) => {
      if (disposed || !mapCanvasRef.current) return;
      const map = L.map(mapCanvasRef.current, { zoomControl: false }).setView([tracking.current_position.lat, tracking.current_position.lng], 14);
      removeMap = () => map.remove();
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" });
      tiles.on("tileerror", showFallback).addTo(map);

      const route = tracking.route.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(route, { color: "#fff", weight: 9, opacity: 0.96, lineCap: "round", lineJoin: "round" }).addTo(map);
      L.polyline(route, { color: "#9b3b2f", weight: 4, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(map);

      const addMarker = (position: { lat: number; lng: number }, icon: keyof typeof markerIcons, label: string) => {
        L.marker([position.lat, position.lng], {
          title: label,
          icon: L.divIcon({ className: "delivery-marker", html: markerMarkup(icon, label), iconSize: [32, 64], iconAnchor: [16, 38] }),
        }).addTo(map).bindTooltip(label);
      };
      addMarker(tracking.outlet, "outlet", "Restaurant");
      addMarker(tracking.destination, "home", "Your address");
      const riderPosition = tracking.stage === "delivered" ? tracking.destination : tracking.current_position;
      addMarker(riderPosition, "rider", "Rider");
      map.fitBounds(L.latLngBounds([...route, [tracking.outlet.lat, tracking.outlet.lng], [tracking.destination.lat, tracking.destination.lng]]), { padding: [36, 48] });

      const pane = mapCanvasRef.current.querySelector<HTMLElement>(".leaflet-pane");
      if (!pane || getComputedStyle(pane).position !== "absolute") {
        showFallback();
        return;
      }
      setLeafletReady(true);
    }).catch(showFallback);

    return () => {
      disposed = true;
      removeMap?.();
    };
  }, [tracking]);

  const all = [tracking.outlet, tracking.destination, ...tracking.route];
  const bounds = { minLat: Math.min(...all.map((p) => p.lat)), maxLat: Math.max(...all.map((p) => p.lat)), minLng: Math.min(...all.map((p) => p.lng)), maxLng: Math.max(...all.map((p) => p.lng)) };
  const route = tracking.route.map((p) => { const xy = point(p, bounds); return `${xy.x},${xy.y}`; }).join(" ");
  const rider = point(tracking.current_position, bounds);
  const outlet = point(tracking.outlet, bounds);
  const home = point(tracking.destination, bounds);
  const fallbackRider = tracking.stage === "delivered" ? home : rider;

  return <div className={`delivery-map ${leafletReady ? "has-leaflet" : "inline-map"}`} aria-label="Live delivery map">
    {!leafletReady && <svg viewBox="0 0 100 100" role="img" aria-label="Rider route from restaurant to your address"><path d="M0 22h100M0 52h100M20 0v100M70 0v100" className="map-grid" /><polyline points={route} className="map-route-outline" /><polyline points={route} className="map-route" /><circle cx={outlet.x} cy={outlet.y} r="5" className="map-outlet" /><circle cx={home.x} cy={home.y} r="5" className="map-home" /><g className="map-bike" style={{ transform: `translate(${fallbackRider.x}px, ${fallbackRider.y}px) rotate(${tracking.heading}deg)` }}><circle r="5" /><text y="1.5" textAnchor="middle">⌁</text></g></svg>}
    <div className="delivery-map-canvas" ref={mapCanvasRef} aria-hidden={!leafletReady} />
    <div className="map-legend"><span><i className="legend-outlet" /> Restaurant</span><span><i className="legend-home" /> Home</span><span><i className="legend-bike" /> Rider</span></div>
  </div>;
}
