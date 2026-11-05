import type { CartLine } from "./cart";

export const ADDRESS_STORAGE_KEY = "hyderabad-biryani-delivery-address";

export type SavedAddress = {
  address: string;
  lat: number;
  lng: number;
};

export type OrderLinePayload = {
  item_id: string;
  variant_id: string | null;
  addon_ids: string[];
  quantity: number;
};

export type OrderPayload = {
  outlet_id: string;
  items: OrderLinePayload[];
  payment_method: "upi" | "card";
  delivery_address: SavedAddress;
  phone: string;
  notes?: string;
};

export function cartToOrderItems(lines: CartLine[]): OrderLinePayload[] {
  return lines.map((line) => ({
    item_id: line.itemId,
    variant_id: line.variantId,
    addon_ids: line.addonIds,
    quantity: line.quantity,
  }));
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latDelta = toRadians(lat2 - lat1);
  const lngDelta = toRadians(lng2 - lng1);
  const value =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
}

export function totalsMatch(serverTotal: number, cartTotal: number): boolean {
  return Math.round(serverTotal * 100) === Math.round(cartTotal * 100);
}

export function readSavedAddress(): SavedAddress | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ADDRESS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "address" in parsed &&
      "lat" in parsed &&
      "lng" in parsed &&
      typeof parsed.address === "string" &&
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number"
    ) {
      return parsed as SavedAddress;
    }
    throw new Error("Saved address has an invalid shape.");
  } catch (error) {
    console.error("Could not restore the saved delivery address.", error);
    window.localStorage.removeItem(ADDRESS_STORAGE_KEY);
    return null;
  }
}

export function saveAddress(address: SavedAddress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADDRESS_STORAGE_KEY, JSON.stringify(address));
  } catch (error) {
    console.error("Could not save the delivery address.", error);
  }
}

export class SingleFlightOrderCreator<T> {
  private inFlight: Promise<T> | null = null;

  run(create: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.inFlight;
    const request = create();
    this.inFlight = request;
    void request.finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    }).catch(() => {
      // The caller handles the rejection; this catch only clears the guard.
    });
    return request;
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }
}
