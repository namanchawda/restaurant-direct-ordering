"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Tracking } from "@/lib/delivery";

export function useDeliveryTracking(publicId: string, stage: string | undefined) {
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const load = async () => {
      try { const next = await api<Tracking>(`/orders/${publicId}/tracking`); if (!stopped) { setTracking(next); setError(null); } }
      catch (reason) { if (!stopped) setError(reason instanceof Error ? reason : new Error("Tracking unavailable")); }
      if (!stopped && !document.hidden) timer = window.setTimeout(load, stage === "picked_up" || stage === "on_the_way" || stage === "arriving" ? 3000 : 5000);
    };
    const visibility = () => { if (!document.hidden) void load(); else if (timer) window.clearTimeout(timer); };
    void load(); document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [publicId, stage]);
  return { tracking, error };
}
