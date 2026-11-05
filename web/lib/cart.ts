import type { MenuAddon, MenuItem, OutletMenu } from "./customer";

export type CartLine = {
  id: string;
  itemId: string;
  name: string;
  photoUrl: string;
  isVeg: boolean;
  variantId: string | null;
  variantName: string | null;
  addonIds: string[];
  addonNames: string[];
  addonPrices: number[];
  unitPrice: number;
  quantity: number;
  staleReason: string | null;
};

export type CartState = {
  outletId: string | null;
  lines: CartLine[];
  notes: string;
};

export const EMPTY_CART: CartState = { outletId: null, lines: [], notes: "" };

export function cartLineIdentity(
  itemId: string,
  variantId: string | null,
  addonIds: string[],
): string {
  return JSON.stringify([itemId, variantId, [...addonIds].sort()]);
}

export function makeCartLine(
  item: MenuItem,
  variantId: string | null,
  addonIds: string[],
  quantity: number,
): CartLine {
  const variant = item.variants.find((choice) => choice.id === variantId);
  const selectedAddons = addonIds
    .map((id) => item.addons.find((addon) => addon.id === id))
    .filter((addon): addon is MenuAddon => addon !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  const sortedAddonIds = selectedAddons.map((addon) => addon.id);

  return {
    id: cartLineIdentity(item.id, variantId, sortedAddonIds),
    itemId: item.id,
    name: item.name,
    photoUrl: item.photo_url,
    isVeg: item.is_veg,
    variantId,
    variantName: variant?.name ?? null,
    addonIds: sortedAddonIds,
    addonNames: selectedAddons.map((addon) => addon.name),
    addonPrices: selectedAddons.map((addon) => addon.price),
    unitPrice: variant?.price ?? item.price,
    quantity: clampQuantity(quantity),
    staleReason: null,
  };
}

export function clampQuantity(quantity: number): number {
  const wholeNumber = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  return Math.max(1, Math.min(20, wholeNumber));
}

export function addCartLine(lines: CartLine[], added: CartLine): CartLine[] {
  const existing = lines.find((line) => line.id === added.id);
  if (!existing) return [...lines, added];
  return lines.map((line) =>
    line.id === added.id
      ? { ...line, quantity: clampQuantity(line.quantity + added.quantity) }
      : line,
  );
}

export function setCartLineQuantity(
  lines: CartLine[],
  lineId: string,
  quantity: number,
): CartLine[] {
  return lines.map((line) =>
    line.id === lineId ? { ...line, quantity: clampQuantity(quantity) } : line,
  );
}

export function cartLineTotal(line: CartLine): number {
  return (line.unitPrice + line.addonPrices.reduce((sum, price) => sum + price, 0)) * line.quantity;
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + cartLineTotal(line), 0);
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function includedGstAmount(total: number): number {
  return Math.round((total * 5 / 105) * 100) / 100;
}

export function revalidateCartLines(
  lines: CartLine[],
  menu: OutletMenu,
): CartLine[] {
  const items = new Map(
    menu.categories.flatMap((category) => category.items).map((item) => [item.id, item]),
  );

  return lines.map((line) => {
    const item = items.get(line.itemId);
    if (!item) {
      return line.staleReason === "No longer on this menu"
        ? line
        : { ...line, staleReason: "No longer on this menu" };
    }
    if (!item.available) {
      return line.staleReason === "Unavailable at this outlet"
        ? line
        : { ...line, staleReason: "Unavailable at this outlet" };
    }

    const variant = line.variantId
      ? item.variants.find((choice) => choice.id === line.variantId)
      : null;
    if (line.variantId && !variant) {
      return line.staleReason === "Portion size changed"
        ? line
        : { ...line, staleReason: "Portion size changed" };
    }

    const addons = line.addonIds
      .map((id) => item.addons.find((addon) => addon.id === id))
      .filter((addon): addon is MenuAddon => addon !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (addons.length !== line.addonIds.length) {
      return line.staleReason === "An add-on is no longer available"
        ? line
        : { ...line, staleReason: "An add-on is no longer available" };
    }

    const currentUnitPrice = variant?.price ?? item.price;
    const changedPrice =
      currentUnitPrice !== line.unitPrice ||
      addons.some((addon, index) => addon.price !== line.addonPrices[index]);
    const staleReason = changedPrice ? "Price changed — remove and add it again" : null;
    return line.staleReason === staleReason ? line : { ...line, staleReason };
  });
}
