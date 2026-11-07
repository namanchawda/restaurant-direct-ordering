export type DeliveryPoint = { lat: number; lng: number };
export type Tracking = {
  stage: "finding_rider" | "rider_assigned" | "at_restaurant" | "picked_up" | "on_the_way" | "arriving" | "delivered";
  rider: { name: string; vehicle: string; rating: number; masked_phone: string; fictional: boolean } | null;
  route: DeliveryPoint[];
  current_position: DeliveryPoint;
  heading: number;
  progress: number;
  eta_at: string | null;
  minutes_remaining: number | null;
  outlet: DeliveryPoint & { name: string };
  destination: DeliveryPoint & { address: string | null };
  distance_km: number;
};

export const TRACKING_STEPS = [
  ["finding_rider", "Finding a rider"],
  ["rider_assigned", "Rider assigned"],
  ["at_restaurant", "At the restaurant"],
  ["on_the_way", "On the way"],
  ["arriving", "Arriving"],
  ["delivered", "Delivered"],
] as const;
