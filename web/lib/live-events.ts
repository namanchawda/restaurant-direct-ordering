export type StreamEventLike = {
  data: string;
  lastEventId?: string;
};

export type OrderEnvelope<TOrder> = {
  type: string;
  order: TOrder;
};

export const MAX_RECONNECT_DELAY_MS = 15000;
export const POLLING_INTERVAL_MS = 15000;

export function parseOrderEnvelope<TOrder>(
  event: StreamEventLike,
): OrderEnvelope<TOrder> | null {
  try {
    const value: unknown = JSON.parse(event.data);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.type !== "string") return null;
    if (typeof record.order !== "object" || record.order === null) return null;
    return { type: record.type, order: record.order as TOrder };
  } catch {
    return null;
  }
}

export function nextReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 8));
  const base = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** safeAttempt);
  const jitter = base * 0.2;
  return Math.min(
    MAX_RECONNECT_DELAY_MS,
    Math.round(base - jitter + random() * jitter * 2),
  );
}

export class EventIdTracker {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly limit = 1000) {}

  shouldProcess(id: string | null | undefined): boolean {
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.limit) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  reset(): void {
    this.seen.clear();
    this.order.length = 0;
  }
}
