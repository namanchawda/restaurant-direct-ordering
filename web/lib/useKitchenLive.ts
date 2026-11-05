"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, api } from "@/lib/api";
import {
  EventIdTracker,
  POLLING_INTERVAL_MS,
  nextReconnectDelay,
  parseOrderEnvelope,
} from "@/lib/live-events";
import { isKitchenVisible, sortKitchenOrders } from "@/lib/kitchen";
import type { Order } from "@/lib/orders";

export type KitchenLiveStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling"
  | "offline";

export type JustHandedOrder = {
  order: Order;
  at: number;
};

export function useKitchenLive() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<KitchenLiveStatus>("idle");
  const [justHanded, setJustHanded] = useState<JustHandedOrder[]>([]);
  const [newOrderSignal, setNewOrderSignal] = useState(0);

  const revisionRef = useRef(0);
  const refetchRef = useRef<() => Promise<void>>(async () => {});
  const reconnectRef = useRef<() => void>(() => {});

  const upsertOrder = useCallback((incoming: Order) => {
    revisionRef.current += 1;
    if (incoming.status === "handed_to_rider") {
      setJustHanded((current) => [
        ...current.filter(
          (entry) => entry.order.public_id !== incoming.public_id,
        ),
        { order: incoming, at: Date.now() },
      ]);
    }
    setOrders((current) => {
      const rest = current.filter(
        (entry) => entry.public_id !== incoming.public_id,
      );
      if (!isKitchenVisible(incoming.status)) return rest;
      return sortKitchenOrders([...rest, incoming]);
    });
  }, []);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;
    let attempt = 0;
    let suppressBeepUntil = 0;
    const tracker = new EventIdTracker(2000);

    async function fetchSnapshot() {
      const revision = revisionRef.current;
      try {
        const rows = await api<Order[]>("/kitchen/orders");
        if (closed) return;
        if (revisionRef.current === revision) {
          setOrders(
            sortKitchenOrders(rows.filter((row) => isKitchenVisible(row.status))),
          );
        }
        setLoading(false);
        setError(null);
      } catch (reason) {
        if (closed) return;
        setLoading(false);
        setError(
          reason instanceof Error
            ? reason
            : new Error("We couldn’t load the kitchen orders."),
        );
        throw reason;
      }
    }

    function scheduleReconnect() {
      if (closed) return;
      setStatus(attempt >= 3 ? "offline" : "reconnecting");
      const delay = nextReconnectDelay(attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delay);
    }

    function restartNow() {
      if (closed) return;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      source?.close();
      source = null;
      attempt = 0;
      void connect();
    }

    function handleMessage(event: Event) {
      if (closed) return;
      const message = event as MessageEvent<string>;
      if (!tracker.shouldProcess(message.lastEventId)) return;
      const envelope = parseOrderEnvelope<Order>(message);
      if (!envelope) return;
      if (
        message.type === "order.created" &&
        Date.now() >= suppressBeepUntil
      ) {
        setNewOrderSignal((value) => value + 1);
      }
      upsertOrder(envelope.order);
    }

    function openStream(token: string) {
      if (closed) return;
      source = new EventSource(
        `${API_URL}/kitchen/stream?token=${encodeURIComponent(token)}`,
      );
      tracker.reset();
      source.onopen = () => {
        if (closed) return;
        attempt = 0;
        suppressBeepUntil = Date.now() + 2000;
        setStatus("live");
        setError(null);
        setLoading(false);
      };
      for (const eventName of [
        "order.created",
        "order.updated",
        "order.escalated",
      ]) {
        source.addEventListener(eventName, handleMessage);
      }
      source.addEventListener("resync", () => {
        if (closed) return;
        restartNow();
      });
      source.onerror = () => {
        if (closed) return;
        source?.close();
        source = null;
        scheduleReconnect();
      };
    }

    async function connect() {
      if (closed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      try {
        await fetchSnapshot();
      } catch {
        // Snapshot errors are surfaced; the stream may still recover.
      }
      if (closed) return;
      try {
        const tokenResponse = await api<{ token: string }>(
          "/kitchen/stream-token",
          { method: "POST" },
        );
        if (closed) return;
        openStream(tokenResponse.token);
      } catch (reason) {
        if (closed) return;
        setError(
          reason instanceof Error
            ? reason
            : new Error("We couldn’t connect to the live kitchen feed."),
        );
        scheduleReconnect();
      }
    }

    refetchRef.current = async () => {
      try {
        await fetchSnapshot();
      } catch {
        // Error state is already set by fetchSnapshot.
      }
    };
    reconnectRef.current = restartNow;

    function onVisibilityChange() {
      if (closed) return;
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
        void refetchRef.current();
        return;
      }
      if (!source) {
        restartNow();
        return;
      }
      void refetchRef.current();
    }

    void (async () => {
      if (typeof window === "undefined" || typeof EventSource === "undefined") {
        setStatus("polling");
        await refetchRef.current();
        pollTimer = window.setInterval(() => {
          void refetchRef.current();
        }, POLLING_INTERVAL_MS);
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
      refetchRef.current = async () => {};
      reconnectRef.current = () => {};
      setStatus("idle");
    };
  }, [upsertOrder]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setJustHanded((current) =>
        current.filter((entry) => Date.now() - entry.at <= 10000),
      );
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const refetch = useCallback(() => refetchRef.current(), []);
  const reconnect = useCallback(() => reconnectRef.current(), []);

  return {
    orders,
    loading,
    error,
    status,
    justHanded,
    newOrderSignal,
    refetch,
    reconnect,
    upsertOrder,
  };
}
