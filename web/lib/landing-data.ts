import { api } from "@/lib/api";
import { LOCATION_STORAGE_KEY, OUTLET_STORAGE_KEY } from "@/lib/customer";
import type { OutletMenu, OutletResult } from "@/lib/customer";
import { selectDefaultOutlet } from "@/lib/outlet-selection";

export type LandingData = {
  outlets: OutletResult[];
  pickedOutlet: OutletResult | null;
  menu: OutletMenu | null;
};

let cached: Promise<LandingData> | null = null;

export function invalidateLandingData() {
  cached = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === OUTLET_STORAGE_KEY || event.key === LOCATION_STORAGE_KEY) {
      invalidateLandingData();
    }
  });
}

export function loadLandingData(): Promise<LandingData> {
  if (cached) return cached;
  cached = (async () => {
    let lat = 17.4649;
    let lng = 78.3639;
    let remembered: string | null = null;

    try {
      remembered = window.localStorage.getItem(OUTLET_STORAGE_KEY);
      const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
      if (raw) {
        const area = JSON.parse(raw) as { lat: number; lng: number };
        if (typeof area?.lat === "number" && typeof area?.lng === "number") {
          lat = area.lat;
          lng = area.lng;
        }
      }
    } catch { /* defaults */ }

    const outlets = await api<OutletResult[]>(`/outlets?lat=${lat}&lng=${lng}`);
    const picked = selectDefaultOutlet(outlets, remembered);
    if (!picked) return { outlets, pickedOutlet: null, menu: null };
    const menu = await api<OutletMenu>(`/outlets/${picked.id}/menu`);
    return { outlets, pickedOutlet: picked, menu };
  })();
  return cached;
}
