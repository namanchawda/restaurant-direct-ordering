"use client";

import { useEffect, useState } from "react";
import { API_URL, api } from "@/lib/api";
import { EventIdTracker, nextReconnectDelay, parseOrderEnvelope } from "@/lib/live-events";
import { isFinalStatus } from "@/lib/orders";
import type { Order } from "@/lib/orders";

const POLL_INTERVAL_MS = 5000;

export function useOrderLive(publicId: string) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let closed = false;
    let final = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;
    let reconnectAttempt = 0;
    let hasOrder = false;
    const tracker = new EventIdTracker(500);

    function apply(next: Order) {
      if (closed) return;
      hasOrder = true;
      setOrder(next);
      setError(null);
      setLoading(false);
      if (isFinalStatus(next.status)) {
        final = true;
        source?.close();
        source = null;
        if (reconnectTimer !== undefined) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        if (pollTimer !== undefined) {
          window.clearInterval(pollTimer);
          pollTimer = undefined;
        }
      }
    }

    async function fetchSnapshot() {
      try {
        const result = await api<Order>(`/orders/${publicId}`);
        apply(result);
      } catch (reason) {
        if (closed) return;
        if (!hasOrder) {
          setError(
            reason instanceof Error
              ? reason
              : new Error("We couldn’t load this order."),
          );
          setLoading(false);
        }
        throw reason;
      }
    }

    function scheduleReconnect() {
      if (closed || final) return;
      const delay = nextReconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delay);
    }

    function restartNow() {
      if (closed || final) return;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      source?.close();
      source = null;
      reconnectAttempt = 0;
      void connect();
    }

    function handleMessage(event: Event) {
      if (closed) return;
      const message = event as MessageEvent<string>;
      if (!tracker.shouldProcess(message.lastEventId)) return;
      const envelope = parseOrderEnvelope<Order>(message);
      if (!envelope) return;
      apply(envelope.order);
    }

    function openStream(token: string) {
      if (closed || final) return;
      source = new EventSource(
        `${API_URL}/orders/${encodeURIComponent(publicId)}/stream?token=${encodeURIComponent(token)}`,
      );
      tracker.reset();
      source.onopen = () => {
        reconnectAttempt = 0;
      };
      for (const eventName of [
        "order.created",
        "order.updated",
        "order.escalated",
      ]) {
        source.addEventListener(eventName, handleMessage);
      }
      source.addEventListener("resync", () => {
        if (closed || final) return;
        restartNow();
      });
      source.onerror = () => {
        if (closed || final) return;
        source?.close();
        source = null;
        scheduleReconnect();
      };
    }

    async function connect() {
      if (closed || final) return;
      try {
        await fetchSnapshot();
      } catch {
        scheduleReconnect();
        return;
      }
      if (closed || final) return;
      try {
        const tokenResponse = await api<{ token: string }>(
          `/orders/${publicId}/stream-token`,
          { method: "POST" },
        );
        if (closed || final) return;
        openStream(tokenResponse.token);
      } catch {
        scheduleReconnect();
      }
    }

    function startPolling() {
      setLoading(false);
      pollTimer = window.setInterval(() => {
        if (!document.hidden && !final) {
          void fetchSnapshot().catch(() => {});
        }
      }, POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      if (closed || final) return;
      if (document.hidden) {
        if (reconnectTimer !== undefined) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        if (source) {
          source.close();
          source = null;
        }
        return;
      }
      if (typeof EventSource === "undefined") {
        void fetchSnapshot().catch(() => {});
        return;
      }
      if (!source) {
        restartNow();
        return;
      }
      void fetchSnapshot().catch(() => {});
    }

    void (async () => {
      if (typeof window === "undefined" || typeof EventSource === "undefined") {
        await fetchSnapshot().catch(() => {});
        if (closed || final) return;
        startPolling();
        return;
      }
      await connect();
    })();

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
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
