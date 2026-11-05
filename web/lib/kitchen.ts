import type { Order, OrderStatus } from "./orders";

export type KitchenColumnId = "new" | "preparing" | "ready";
export type KitchenUrgency = "escalated" | "late" | "soon" | "normal";

export const KITCHEN_COLUMNS: readonly {
  id: KitchenColumnId;
  title: string;
  subtitle: string;
  statuses: readonly OrderStatus[];
}[] = [
  {
    id: "new",
    title: "New orders",
    subtitle: "Waiting to be accepted",
    statuses: ["placed"],
  },
  {
    id: "preparing",
    title: "Preparing",
    subtitle: "On the pass",
    statuses: ["accepted", "preparing"],
  },
  {
    id: "ready",
    title: "Ready",
    subtitle: "Waiting for a rider",
    statuses: ["ready_for_pickup"],
  },
];

const LATE_STATUSES: readonly OrderStatus[] = ["placed", "accepted", "preparing"];
const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  "placed",
  "accepted",
  "preparing",
];

export function isKitchenVisible(status: OrderStatus): boolean {
  return (
    status === "placed" ||
    status === "accepted" ||
    status === "preparing" ||
    status === "ready_for_pickup"
  );
}

export function columnIdFor(status: OrderStatus): KitchenColumnId | null {
  const column = KITCHEN_COLUMNS.find((candidate) =>
    candidate.statuses.includes(status),
  );
  return column?.id ?? null;
}

export function sortKitchenOrders(orders: readonly Order[]): Order[] {
  return [...orders].sort((left, right) => {
    const promiseDifference =
      new Date(left.promised_at).getTime() - new Date(right.promised_at).getTime();
    if (promiseDifference !== 0) return promiseDifference;
    return new Date(left.placed_at).getTime() - new Date(right.placed_at).getTime();
  });
}

export function groupKitchenOrders(
  orders: readonly Order[],
): Record<KitchenColumnId, Order[]> {
  const groups: Record<KitchenColumnId, Order[]> = {
    new: [],
    preparing: [],
    ready: [],
  };
  for (const order of sortKitchenOrders(orders)) {
    const column = columnIdFor(order.status);
    if (column) groups[column].push(order);
  }
  return groups;
}

export function minutesRemaining(promisedAt: string, now: number): number {
  const promised = new Date(promisedAt).getTime();
  if (Number.isNaN(promised)) return 0;
  return Math.ceil((promised - now) / 60000);
}

export function isLateOrder(order: Order, now: number): boolean {
  return (
    LATE_STATUSES.includes(order.status) &&
    new Date(order.promised_at).getTime() < now
  );
}

export function lateMinutes(order: Order, now: number): number {
  if (!isLateOrder(order, now)) return 0;
  return Math.max(
    1,
    Math.ceil((now - new Date(order.promised_at).getTime()) / 60000),
  );
}

export function isEscalated(order: Order): boolean {
  return (
    order.is_escalated === true ||
    (order.escalated_at !== null && order.escalation_acknowledged_at === null)
  );
}

export function urgencyFor(order: Order, now: number): KitchenUrgency {
  if (isEscalated(order)) return "escalated";
  if (isLateOrder(order, now)) return "late";
  if (minutesRemaining(order.promised_at, now) <= 5) return "soon";
  return "normal";
}

export function remainingLabel(order: Order, now: number): string {
  const late = lateMinutes(order, now);
  if (late > 0) return `Late ${late} min`;
  const remaining = minutesRemaining(order.promised_at, now);
  if (remaining <= 0) return "Due now";
  if (remaining === 1) return "1 min left";
  return `${remaining} min left`;
}

export function orderAgeMinutes(order: Order, now: number): number {
  const placed = new Date(order.placed_at).getTime();
  if (Number.isNaN(placed)) return 0;
  return Math.max(0, Math.ceil((now - placed) / 60000));
}

export function shortOrderId(publicId: string): string {
  return publicId.replace(/^WEB-/, "");
}

export function customerLabel(order: Order): string {
  const name = order.customer_first_name?.trim();
  return name ? name : "Guest";
}

export function nextActionFor(
  order: Order,
): { status: OrderStatus; label: string } | null {
  switch (order.status) {
    case "placed":
      return { status: "accepted", label: "Accept order" };
    case "accepted":
      return { status: "preparing", label: "Start cooking" };
    case "preparing":
      return { status: "ready_for_pickup", label: "Mark ready" };
    case "ready_for_pickup":
      return { status: "handed_to_rider", label: "Hand to rider" };
    default:
      return null;
  }
}

export function canCancelOrder(order: Order): boolean {
  return CANCELLABLE_STATUSES.includes(order.status);
}

export function clampOverrideMinutes(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(240, Math.max(1, Math.round(value)));
}

export function overrideMinutesFromCurrent(
  order: Order,
  extraMinutes: number,
): number {
  const placed = new Date(order.placed_at).getTime();
  const promised = new Date(order.promised_at).getTime();
  const current = Math.max(1, Math.ceil((promised - placed) / 60000));
  return clampOverrideMinutes(current + extraMinutes);
}

export function handedRecently(
  handedAt: number,
  now: number,
  windowMs = 10000,
): boolean {
  return now - handedAt <= windowMs;
}
