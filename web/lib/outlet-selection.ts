import type { OutletResult } from "@/lib/customer";

/** Pick a stable outlet without making location a prerequisite for browsing. */
export function selectDefaultOutlet(
  outlets: OutletResult[],
  rememberedOutletId: string | null,
  fallbackName = "Kondapur",
): OutletResult | null {
  if (rememberedOutletId) {
    const remembered = outlets.find((outlet) => outlet.id === rememberedOutletId);
    if (remembered) return remembered;
  }

  const nearestDelivering = outlets.find(
    (outlet) => outlet.is_inside_delivery_radius !== false && outlet.is_open,
  );
  if (nearestDelivering) return nearestDelivering;

  const fallback = outlets.find((outlet) => outlet.name.toLowerCase().includes(fallbackName.toLowerCase()));
  return fallback ?? outlets[0] ?? null;
}
