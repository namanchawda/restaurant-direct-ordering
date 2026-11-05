"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isFinalStatus } from "@/lib/orders";
import type { Order } from "@/lib/orders";

export function useOrderLive(publicId: string) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let inFlight = false;

    async function load() {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const result = await api<Order>(`/orders/${publicId}`);
        if (!active) return;
        setOrder(result);
        setError(null);
        setLoading(false);
        if (!isFinalStatus(result.status) && !document.hidden) {
          timer = window.setTimeout(load, 5000);
        }
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError
            : new Error("We couldn’t load this order."),
        );
        setLoading(false);
      } finally {
        inFlight = false;
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (timer) {
          window.clearTimeout(timer);
          timer = undefined;
        }
        return;
      }
      if (timer) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      void load();
    }

    void load();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [publicId, attempt]);

  return {
    order,
    loading,
    error,
    retry: () => {
      setLoading(true);
      setAttempt((value) => value + 1);
    },
  };
}
