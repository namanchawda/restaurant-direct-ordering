export type CateringPartyOrder = {
  public_id: string;
  outlet_name: string | null;
  event_date: string;
  event_time: string;
  guests: number;
  delivery_or_pickup: "delivery" | "pickup";
  address: string | null;
  contact_name: string;
  contact_phone: string;
  notes: string | null;
  status: "requested" | "confirmed" | "rejected" | "cancelled" | "completed";
  items: Array<{
    item_id: string;
    name: string;
    variant: string | null;
    quantity: number;
    unit_price_inr: number;
  }>;
  estimated_total_inr: number;
  advance_inr: number;
  advance_payment_status: "pending" | "paid" | "failed";
  manager_note: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  price_note: string;
  status_history: Array<{ status: string; at: string; note: string | null }>;
};

export type CateringTab = "requested" | "confirmed" | "completed" | "rejected";

export const CATERING_TABS: Array<{ key: CateringTab; label: string }> = [
  { key: "requested", label: "Requested" },
  { key: "confirmed", label: "Confirmed" },
  { key: "completed", label: "Completed" },
  { key: "rejected", label: "Rejected" },
];

export function eventCountdown(date: string, time: string, now: Date = new Date()): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const event = new Date(y, m - 1, d, h, mi);
  const diff = event.getTime() - now.getTime();
  if (diff <= 0) return "Event has passed";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days >= 1) return `in ${days} day${days > 1 ? "s" : ""}`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 1) return `in ${hours} hour${hours > 1 ? "s" : ""}`;
  const minutes = Math.floor(diff / (1000 * 60));
  return `in ${minutes} minute${minutes > 1 ? "s" : ""}`;
}

export function sortCateringOrders(orders: CateringPartyOrder[], tab: CateringTab): CateringPartyOrder[] {
  return [...orders].sort((a, b) => {
    if (tab === "confirmed") {
      const aa = new Date(`${a.event_date}T${a.event_time}`).getTime();
      const bb = new Date(`${b.event_date}T${b.event_time}`).getTime();
      return aa - bb;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
