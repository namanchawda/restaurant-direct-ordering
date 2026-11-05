"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useToast } from "@/components/ui";
import {
  addCartLine,
  EMPTY_CART,
  revalidateCartLines,
  setCartLineQuantity,
} from "@/lib/cart";
import type { CartLine, CartState } from "@/lib/cart";
import type { OutletMenu } from "@/lib/customer";

const STORAGE_KEY = "hyderabad-biryani-cart";
const RESTORE_ERROR_EVENT = "hyderabad-biryani-cart-restore-error";
type CartSnapshot = { cart: CartState; hydrated: boolean };
const EMPTY_SNAPSHOT: CartSnapshot = { cart: EMPTY_CART, hydrated: false };
let snapshot = EMPTY_SNAPSHOT;
let storageLoaded = false;
const listeners = new Set<() => void>();

type CartContextValue = {
  cart: CartState;
  hydrated: boolean;
  addLine: (outletId: string, line: CartLine) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  clearCart: () => void;
  changeOutlet: (outletId: string, clearExisting?: boolean) => boolean;
  setNotes: (notes: string) => void;
  revalidate: (menu: OutletMenu) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.id === "string" &&
    typeof line.itemId === "string" &&
    typeof line.name === "string" &&
    typeof line.photoUrl === "string" &&
    typeof line.isVeg === "boolean" &&
    (typeof line.variantId === "string" || line.variantId === null) &&
    (typeof line.variantName === "string" || line.variantName === null) &&
    Array.isArray(line.addonIds) &&
    line.addonIds.every((id) => typeof id === "string") &&
    Array.isArray(line.addonNames) &&
    line.addonNames.every((name) => typeof name === "string") &&
    Array.isArray(line.addonPrices) &&
    line.addonPrices.every((price) => typeof price === "number") &&
    typeof line.unitPrice === "number" &&
    Number.isInteger(line.quantity) &&
    Number(line.quantity) >= 1 &&
    Number(line.quantity) <= 20 &&
    (typeof line.staleReason === "string" || line.staleReason === null)
  );
}

function isCartState(value: unknown): value is CartState {
  if (typeof value !== "object" || value === null) return false;
  const cart = value as Record<string, unknown>;
  return (
    (typeof cart.outletId === "string" || cart.outletId === null) &&
    Array.isArray(cart.lines) &&
    cart.lines.every(isCartLine) &&
    typeof cart.notes === "string"
  );
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function readStoredCart() {
  if (storageLoaded || typeof window === "undefined") return;
  storageLoaded = true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    snapshot = { cart: EMPTY_CART, hydrated: true };
    return;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isCartState(parsed)) throw new Error("Stored cart has an invalid shape.");
    snapshot = { cart: parsed, hydrated: true };
  } catch (error) {
    window.localStorage.removeItem(STORAGE_KEY);
    console.error("Could not restore the saved cart.", error);
    snapshot = { cart: EMPTY_CART, hydrated: true };
    window.dispatchEvent(new Event(RESTORE_ERROR_EVENT));
  }
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return EMPTY_SNAPSHOT;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  readStoredCart();
  listener();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    storageLoaded = false;
    readStoredCart();
    notifyListeners();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function updateCart(update: (current: CartState) => CartState): unknown | null {
  readStoredCart();
  const nextCart = update(snapshot.cart);
  if (nextCart === snapshot.cart) return null;
  snapshot = { cart: nextCart, hydrated: true };
  let storageError: unknown | null = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCart));
  } catch (error) {
    storageError = error;
  }
  notifyListeners();
  return storageError;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const storedSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { cart, hydrated } = storedSnapshot;

  useEffect(() => {
    const onRestoreError = () =>
      toast("Your saved cart could not be restored and has been cleared.", "error");
    window.addEventListener(RESTORE_ERROR_EVENT, onRestoreError);
    return () => window.removeEventListener(RESTORE_ERROR_EVENT, onRestoreError);
  }, [toast]);

  const persistUpdate = useCallback(
    (update: (current: CartState) => CartState) => {
      const error = updateCart(update);
      if (error) {
        console.error("Could not save the cart.", error);
        toast("Your cart could not be saved on this device.", "error");
      }
    },
    [toast],
  );

  const addLine = useCallback(
    (outletId: string, line: CartLine) => {
      if (getSnapshot().cart.outletId && getSnapshot().cart.outletId !== outletId) {
        toast("Choose this outlet before adding items.", "info");
        return;
      }
      persistUpdate((current) => {
        if (current.outletId && current.outletId !== outletId) return current;
        return {
          ...current,
          outletId,
          lines: addCartLine(current.lines, line),
        };
      });
    },
    [persistUpdate, toast],
  );

  const setQuantity = useCallback(
    (lineId: string, quantity: number) =>
      persistUpdate((current) => ({
        ...current,
        lines: setCartLineQuantity(current.lines, lineId, quantity),
      })),
    [persistUpdate],
  );

  const removeLine = useCallback(
    (lineId: string) =>
      persistUpdate((current) => ({
        ...current,
        lines: current.lines.filter((line) => line.id !== lineId),
      })),
    [persistUpdate],
  );

  const clearCart = useCallback(
    () => persistUpdate((current) => ({ ...current, lines: [], notes: "" })),
    [persistUpdate],
  );

  const changeOutlet = useCallback(
    (outletId: string, clearExisting = false) => {
      const current = getSnapshot().cart;
      if (current.outletId === outletId) return true;
      if (current.lines.length > 0 && !clearExisting) return false;
      persistUpdate(() => ({ outletId, lines: [], notes: "" }));
      return true;
    },
    [persistUpdate],
  );

  const setNotes = useCallback(
    (notes: string) => persistUpdate((current) => ({ ...current, notes })),
    [persistUpdate],
  );

  const revalidate = useCallback(
    (menu: OutletMenu) => {
      const current = getSnapshot().cart;
      if (current.outletId !== menu.outlet.id || current.lines.length === 0) return;
      const updatedLines = revalidateCartLines(current.lines, menu);
      const newlyFlagged = updatedLines.filter(
        (line, index) => line.staleReason && !current.lines[index]?.staleReason,
      ).length;
      if (newlyFlagged > 0) {
        toast(
          `${newlyFlagged} cart item${newlyFlagged === 1 ? "" : "s"} need review because menu availability or pricing changed.`,
          "info",
        );
      }
      if (updatedLines.some((line, index) => line !== current.lines[index])) {
        persistUpdate((latest) =>
          latest.outletId === menu.outlet.id
            ? { ...latest, lines: revalidateCartLines(latest.lines, menu) }
            : latest,
        );
      }
    },
    [persistUpdate, toast],
  );

  const value = useMemo(
    () => ({
      cart,
      hydrated,
      addLine,
      setQuantity,
      removeLine,
      clearCart,
      changeOutlet,
      setNotes,
      revalidate,
    }),
    [
      addLine,
      cart,
      changeOutlet,
      clearCart,
      hydrated,
      removeLine,
      revalidate,
      setNotes,
      setQuantity,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider.");
  return context;
}
