export type OrderStatus =
  | "placed"
  | "accepted"
  | "preparing"
  | "ready_for_pickup"
  | "handed_to_rider"
  | "delivered"
  | "cancelled";

export type OrderAddon = {
  id: string;
  name: string;
  price_inr: number;
};

export type OrderItem = {
  name: string;
  unit_price_inr: number;
  quantity: number;
  addons: OrderAddon[];
};

export type OrderStatusEvent = {
  status: OrderStatus;
  at: string;
};

export type Order = {
  public_id: string;
  outlet_id: string;
  status: OrderStatus;
  payment_method: "upi" | "card";
  payment_status: "pending" | "paid" | "failed" | "refunded";
  total_inr: number;
  items_subtotal_inr: number;
  coupon_discount_inr: number;
  points_discount_inr: number;
  delivery_fee_inr: number;
  coupon_code: string | null;
  redeemed_points: number;
  earn_points: number;
  gst_included_inr: number;
  placed_at: string;
  promised_at: string;
  is_late: boolean;
  minutes_late: number;
  delivery_address: string | null;
  notes: string | null;
  cancellation_reason: string | null;
  customer_first_name: string | null;
  manager_override_minutes: number | null;
  ai_estimate_minutes: number | null;
  estimate_breakdown_text: string | null;
  kitchen_busy: boolean;
  escalated_at: string | null;
  escalation_acknowledged_at: string | null;
  is_escalated: boolean;
  price_note: string;
  items: OrderItem[];
  status_history: OrderStatusEvent[];
};

export type PaymentResult = {
  public_id: string;
  payment_status: Order["payment_status"];
};

export const ORDER_STEPS: { status: OrderStatus; label: string }[] = [
  { status: "placed", label: "Placed" },
  { status: "accepted", label: "Accepted" },
  { status: "preparing", label: "Preparing" },
  { status: "ready_for_pickup", label: "Ready for pickup" },
  { status: "handed_to_rider", label: "With rider" },
  { status: "delivered", label: "Delivered" },
];

const STATUS_LABELS: Record<OrderStatus, string> = {
  placed: "Placed",
  accepted: "Accepted",
  preparing: "Preparing",
  ready_for_pickup: "Ready for pickup",
  handed_to_rider: "With rider",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function statusLabel(status: OrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function isFinalStatus(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled";
}

export function activeStepIndex(status: OrderStatus): number {
  return ORDER_STEPS.findIndex((step) => step.status === status);
}

export function orderItemTotal(item: OrderItem): number {
  const addonTotal = item.addons.reduce((sum, addon) => sum + addon.price_inr, 0);
  return (item.unit_price_inr + addonTotal) * item.quantity;
}

export function orderItemCount(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}
