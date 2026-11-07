import type { Order } from "@/lib/orders";

export const SAVED_UNPAID_ORDER_KEY = "hyderabad-biryani-unpaid-order";

export function isUnpaidOrder(order: Pick<Order, "payment_status" | "status">): boolean {
  return (order.payment_status === "pending" || order.payment_status === "failed") && order.status !== "cancelled";
}

export function saveUnpaidOrder(order: Order): void {
  if (typeof window === "undefined" || !isUnpaidOrder(order)) return;
  window.localStorage.setItem(SAVED_UNPAID_ORDER_KEY, JSON.stringify(order));
}

export function readSavedUnpaidOrder(): Order | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SAVED_UNPAID_ORDER_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "public_id" in value &&
      typeof value.public_id === "string" &&
      "payment_status" in value &&
      (value.payment_status === "pending" || value.payment_status === "failed") &&
      "status" in value &&
      typeof value.status === "string" &&
      value.status !== "cancelled"
    ) {
      return value as Order;
    }
  } catch {
    // Remove malformed state below.
  }
  clearSavedUnpaidOrder();
  return null;
}

export function clearSavedUnpaidOrder(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(SAVED_UNPAID_ORDER_KEY);
}
