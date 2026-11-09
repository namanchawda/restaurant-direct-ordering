"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Button, Price, Skeleton, VegMark, useToast } from "@/components/ui";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { useCart } from "@/components/customer/CartProvider";
import { FoodImage } from "@/components/customer/FoodImage";
import { HeartToggle } from "@/components/customer/HeartToggle";
import { api, describeApiError, addFavourite, listFavourites, removeFavourite } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  cartLineIdentity,
  makeCartLine,
} from "@/lib/cart";
import type { CartLine } from "@/lib/cart";
import { formatINR } from "@/lib/customer";
import type { MenuItem, OutletMenu } from "@/lib/customer";
import { openOrderAgainItem } from "@/lib/order-suggestions";
import { flyToCart } from "@/lib/fly-to-cart";

type OrderSuggestion = {
  item_id: string;
};

const ALLERGEN_LABELS: Record<string, string> = {
  milk: "Milk",
  gluten: "Gluten",
  nuts: "Tree nuts",
  egg: "Egg",
  fish: "Fish",
  shellfish: "Shellfish",
  soy: "Soy",
  sesame: "Sesame",
};

const TINTS = ["landing-tint-red", "landing-tint-white", "landing-tint-tan", "landing-tint-ink"];

function ItemCard({
  item,
  categoryAvailable,
  onOpen,
  isFavourite,
  onToggleFavourite,
  priority = false,
  outletId,
  tint,
}: {
  item: MenuItem;
  categoryAvailable: boolean;
  onOpen: (item: MenuItem) => void;
  isFavourite: boolean;
  onToggleFavourite: () => void;
  priority?: boolean;
  outletId: string;
  tint: string;
}) {
  const available = categoryAvailable && item.available;
  const { cart, addLine, setQuantity, removeLine } = useCart();
  const toast = useToast();
  const defaultVariantId = item.variants[0]?.id ?? null;
  const defaultLineId = cartLineIdentity(item.id, defaultVariantId, []);
  const itemLines = cart.lines.filter((line) => line.itemId === item.id);
  const quantity = itemLines.reduce((total, line) => total + line.quantity, 0);

  function handleCardKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(item);
    }
  }

  function handleAdd(source?: HTMLElement | null) {
    addLine(outletId, makeCartLine(item, defaultVariantId, [], 1));
    if (source) flyToCart(source);
    toast(`1 × ${item.name} added to cart.`, "success");
  }

  function handleIncrease() {
    const defaultLine = itemLines.find((line) => line.id === defaultLineId);
    if (defaultLine) setQuantity(defaultLineId, defaultLine.quantity + 1);
    else handleAdd();
  }

  function handleDecrease() {
    const target =
      [...itemLines].reverse().find((line) => line.quantity > 1) ??
      itemLines[itemLines.length - 1];
    if (!target) return;
    if (target.quantity > 1) setQuantity(target.id, target.quantity - 1);
    else removeLine(target.id);
  }

  return (
    <article className={`landing-card ${tint}${!available ? " landing-card-unavailable" : ""}`}>
      <button
        type="button"
        className="landing-card-link"
        onClick={() => onOpen(item)}
        onKeyDown={handleCardKeyDown}
        aria-label={`View ${item.name} details`}
      >
        <div className="landing-card-visual">
          <FoodImage
            src={item.photo_url}
            name={item.name}
            isVeg={item.is_veg}
            className="landing-card-photo"
            priority={priority}
            sizes="(max-width: 680px) 46vw, 280px"
          />
        </div>
        <h3 className="landing-card-name">{item.name}</h3>
        <p className="landing-card-desc">{item.description}</p>
      </button>
      <div className="landing-card-foot">
        <span className="landing-card-price">{formatINR(item.price)}</span>
        <VegMark isVeg={item.is_veg} />
        {available ? (
          quantity > 0 ? (
            <QuantityStepper
              quantity={quantity}
              label={`Quantity of ${item.name}`}
              onDecrease={handleDecrease}
              onIncrease={handleIncrease}
            />
          ) : (
            <button
              type="button"
              className="landing-add-button"
              aria-label={`Add ${item.name} to cart`}
              onClick={(event) => handleAdd(event.currentTarget)}
            >
              +
            </button>
          )
        ) : (
          <span className="landing-unavailable">
            {!categoryAvailable ? "Served later" : "Unavailable"}
          </span>
        )}
      </div>
    </article>
  );
}

function ItemSheet({
  item,
  outletId,
  onClose,
  isFavourite,
  onToggleFavourite,
}: {
  item: MenuItem | null;
  outletId: string;
  onClose: () => void;
  isFavourite: boolean;
  onToggleFavourite: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { addLine } = useCart();
  const toast = useToast();
  const [variantId, setVariantId] = useState<string | null>(() => item?.variants[0]?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  const selectedVariant = item?.variants.find((variant) => variant.id === variantId);
  const selectedAddons = item?.addons.filter((addon) => addonIds.includes(addon.id)) ?? [];
  const total = item
    ? (selectedVariant?.price ?? item.price) +
      selectedAddons.reduce((sum, addon) => sum + addon.price, 0)
    : 0;

  function toggleAddon(addonId: string) {
    setAddonIds((selected) =>
      selected.includes(addonId)
        ? selected.filter((id) => id !== addonId)
        : [...selected, addonId],
    );
  }

  function addToCart() {
    if (!item) return;
    const line: CartLine = makeCartLine(item, variantId, addonIds, quantity);
    addLine(outletId, line);
    toast(`${quantity} × ${item.name} added to cart.`, "success");
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="item-dialog"
      aria-label={item ? `${item.name} options` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      {item && (
        <div className="item-sheet-content">
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close item details">
            ×
          </button>
          <div className="item-sheet-photo-wrap">
            <FoodImage
              src={item.photo_url}
              name={item.name}
              isVeg={item.is_veg}
              className="item-sheet-photo"
              sizes="(max-width: 700px) 100vw, 560px"
            />
            <HeartToggle
              itemId={item.id}
              isFavourite={isFavourite}
              onToggle={onToggleFavourite}
            />
          </div>
          <div className="item-sheet-body">
            <div className="item-sheet-title">
              <div>
                <div className="menu-item-name-row">
                  <h2>{item.name}</h2>
                  <VegMark isVeg={item.is_veg} />
                </div>
                <p>{item.description}</p>
              </div>
            </div>
            <p className="sheet-gst-note">Prices incl. 5% GST</p>

            {item.allergens.length > 0 && (
              <div className="allergen-block">
                <strong>Contains allergens</strong>
                <p>{item.allergens.map((allergen) => ALLERGEN_LABELS[allergen] ?? allergen).join(", ")}</p>
              </div>
            )}

            {item.variants.length > 0 && (
              <fieldset className="sheet-choice-group">
                <legend>Choose a portion</legend>
                {item.variants.map((variant) => (
                  <label className={`choice-row${variantId === variant.id ? " choice-row-selected" : ""}`} key={variant.id}>
                    <span>
                      <input type="radio" name="portion" value={variant.id} className="pill-input" checked={variantId === variant.id} onChange={() => setVariantId(variant.id)} />
                      {variant.name}
                    </span>
                    <strong>{formatINR(variant.price)}</strong>
                  </label>
                ))}
              </fieldset>
            )}

            {item.addons.length > 0 && (
              <fieldset className="sheet-choice-group">
                <legend>Add something extra</legend>
                {item.addons.map((addon) => (
                  <label className={`choice-row${addonIds.includes(addon.id) ? " choice-row-selected" : ""}`} key={addon.id}>
                    <span>
                      <input type="checkbox" className="pill-input" checked={addonIds.includes(addon.id)} onChange={() => toggleAddon(addon.id)} />
                      {addon.name}
                    </span>
                    <strong>+ {formatINR(addon.price)}</strong>
                  </label>
                ))}
              </fieldset>
            )}

            <div className="sheet-add-row">
              <QuantityStepper
                quantity={quantity}
                label={`Quantity of ${item.name}`}
                onDecrease={() => setQuantity((value) => Math.max(1, value - 1))}
                onIncrease={() => setQuantity((value) => Math.min(20, value + 1))}
              />
              <Button variant="primary" className="sheet-add-button" onClick={addToCart}>
                Add to cart · {formatINR(total * quantity)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

function MenuSkeleton() {
  return (
    <div className="landing-grid" role="status" aria-label="Loading menu">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="landing-skeleton-card" />
      ))}
    </div>
  );
}

export function MenuScreen({
  outletId,
  browseFirst = false,
  onOpenCart,
  search: searchProp,
  onSearch,
  favouritesSection,
}: {
  outletId: string;
  browseFirst?: boolean;
  onOpenCart?: () => void;
  search?: string;
  onSearch?: (value: string) => void;
  favouritesSection?: ReactNode;
}) {
  const toast = useToast();
  const { cart, hydrated, revalidate } = useCart();
  const { user, ready: authReady } = useAuth();
  const [menu, setMenu] = useState<OutletMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [vegOnly, setVegOnly] = useState(false);
  const [ownSearch, setOwnSearch] = useState("");
  const search = searchProp ?? ownSearch;
  const setSearch = onSearch ?? setOwnSearch;
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [suggestionResult, setSuggestionResult] = useState<{
    key: string;
    suggestions: OrderSuggestion[];
  } | null>(null);
  const [suggestionFailure, setSuggestionFailure] = useState<{ key: string; message: string } | null>(null);
  const [suggestionRequestVersion, setSuggestionRequestVersion] = useState(0);
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const requestMenu = async () => {
      try {
        const result = await api<OutletMenu>(`/outlets/${outletId}/menu`);
        if (!active) return;
        setMenu(result);
        setError(null);
      } catch (requestError) {
        if (!active) return;
        setMenu(null);
        setError(describeApiError(requestError, "We couldn't load this menu."));
      } finally {
        if (active) setLoading(false);
      }
    };
    void requestMenu();
    return () => {
      active = false;
    };
  }, [outletId, requestVersion]);

  const customerUserId = user?.role === "customer" ? user.id : null;
  const suggestionKey = customerUserId
    ? `${customerUserId}:${outletId}:${suggestionRequestVersion}`
    : "";

  useEffect(() => {
    if (!authReady || !customerUserId) return;

    let active = true;
    const query = new URLSearchParams({ outlet_id: outletId });
    void api<OrderSuggestion[]>(`/orders/suggestions?${query}`)
      .then((result) => {
        if (active) {
          setSuggestionResult({ key: suggestionKey, suggestions: result });
          setSuggestionFailure(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSuggestionFailure({
            key: suggestionKey,
            message: describeApiError(error, "Saved dishes couldn't load."),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [authReady, customerUserId, outletId, suggestionKey]);

  useEffect(() => {
    if (!authReady || !(user?.role === "customer")) return;
    let active = true;
    void listFavourites()
      .then((result) => {
        if (active) {
          setFavouriteIds(new Set(result.map((favourite) => favourite.item_id)));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authReady, user]);

  async function toggleFavourite(itemId: string) {
    const next = new Set(favouriteIds);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setFavouriteIds(next);
    try {
      if (next.has(itemId)) await addFavourite(itemId);
      else await removeFavourite(itemId);
      toast(next.has(itemId) ? "Added to favourites." : "Removed from favourites.", "success");
    } catch (error) {
      setFavouriteIds(favouriteIds);
      toast(describeApiError(error, "We couldn't update your favourites. Try again."), "error");
    }
  }

  // Category filters (matching landing lineup)
  const FILTERS = [
    { label: "All", match: null as string | null },
    { label: "Biryani", match: "biryani" },
    { label: "Kebabs", match: "kebab" },
    { label: "Curries", match: "curr" },
    { label: "Sides", match: "bread" },
  ];
  const [filterIndex, setFilterIndex] = useState(0);

  useEffect(() => {
    if (menu) revalidate(menu);
  }, [menu, revalidate]);

  // Flatten all items from all categories with category info
  const allItems = useMemo(() => {
    if (!menu) return [];
    return menu.categories.flatMap((category) =>
      category.items.map((item) => ({ ...item, category: category.name.toLowerCase() }))
    );
  }, [menu]);

  // Apply filters
  const filteredItems = useMemo(() => {
    if (!menu) return [];
    const query = search.trim().toLocaleLowerCase();
    const activeFilter = FILTERS[filterIndex];
    return allItems.filter((item) =>
      (!vegOnly || item.is_veg) &&
      (!query || `${item.name} ${item.description}`.toLocaleLowerCase().includes(query)) &&
      (!activeFilter.match || item.category.includes(activeFilter.match))
    );
  }, [allItems, search, vegOnly, filterIndex]);

  const availableItemCount = filteredItems.filter((item) => item.available).length;

  const Root = "div";

  return (
    <Root className="customer-page menu-page">
      {menu && (
        <>
          <div className="hb-checker" aria-hidden="true" />
          <div className="landing-lineup-inner">
            <div className="landing-lineup-header">
              <h2>THE MENU</h2>
              <div className="landing-filters" role="group" aria-label="Filter the menu">
                {FILTERS.map((entry, index) => (
                  <button
                    type="button"
                    key={entry.label}
                    className={`landing-filter${filterIndex === index ? " is-active" : ""}`}
                    aria-pressed={filterIndex === index}
                    onClick={() => setFilterIndex(index)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <MenuSkeleton />
            ) : filteredItems.length > 0 ? (
              <div className="landing-grid">
                {filteredItems.map((item, index) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    categoryAvailable={menu.outlet.is_open}
                    onOpen={setActiveItem}
                    isFavourite={favouriteIds.has(item.id)}
                    onToggleFavourite={() => toggleFavourite(item.id)}
                    priority={index === 0}
                    outletId={outletId}
                    tint={TINTS[index % 4]}
                  />
                ))}
              </div>
            ) : (
              <div className="landing-empty">No dishes match your filters.</div>
            )}
            <div className="landing-menu-cta">
              <p className="landing-gst">All prices incl. 5% GST</p>
            </div>
          </div>
          <div className="hb-checker" aria-hidden="true" />
        </>
      )}
      <ItemSheet
        key={activeItem?.id ?? "closed"}
        item={activeItem}
        outletId={outletId}
        onClose={() => setActiveItem(null)}
        isFavourite={activeItem ? favouriteIds.has(activeItem.id) : false}
        onToggleFavourite={() => { if (activeItem) toggleFavourite(activeItem.id); }}
      />
    </Root>
  );
}