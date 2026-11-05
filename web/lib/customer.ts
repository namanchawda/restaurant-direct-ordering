export type DeliveryArea = {
  name: string;
  lat: number;
  lng: number;
};

export type OutletResult = {
  id: string;
  name: string;
  type: "outlet" | "cloud_kitchen";
  city: string;
  address: string;
  lat: number;
  lng: number;
  delivery_radius_km: number;
  distance_km: number | null;
  is_inside_delivery_radius: boolean | null;
  is_open: boolean;
  fssai_number: string;
};

export type MenuVariant = {
  id: string;
  name: string;
  price: number;
};

export type MenuAddon = {
  id: string;
  name: string;
  price: number;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  photo_url: string;
  is_veg: boolean;
  spice_level: number;
  allergens: string[];
  price: number;
  available: boolean;
  variants: MenuVariant[];
  addons: MenuAddon[];
};

export type MenuCategory = {
  id: string;
  name: string;
  sort_order: number;
  available_now: boolean;
  window_text: string | null;
  items: MenuItem[];
};

export type OutletMenu = {
  outlet: {
    id: string;
    name: string;
    is_open: boolean;
    fssai_number: string;
    type: "outlet" | "cloud_kitchen";
  };
  price_note: string;
  categories: MenuCategory[];
};

export const LOCATION_STORAGE_KEY = "hyderabad-biryani-location";
export const OUTLET_STORAGE_KEY = "hyderabad-biryani-outlet";

export const HYDERABAD_AREAS: DeliveryArea[] = [
  { name: "Kondapur", lat: 17.4649, lng: 78.3639 },
  { name: "Gachibowli", lat: 17.4401, lng: 78.3489 },
  { name: "Kukatpally", lat: 17.4849, lng: 78.4138 },
  { name: "Madhapur", lat: 17.4483, lng: 78.3915 },
  { name: "Jubilee Hills", lat: 17.4325, lng: 78.4074 },
  { name: "Ameerpet", lat: 17.4375, lng: 78.4483 },
  { name: "Secunderabad", lat: 17.4399, lng: 78.4983 },
];

export function servedWindow(windowText: string | null): string | null {
  if (!windowText) return null;
  const times = windowText.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})/);
  return times ? `Served ${times[1]} to ${times[2]}` : windowText;
}

export function formatINR(amount: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}
