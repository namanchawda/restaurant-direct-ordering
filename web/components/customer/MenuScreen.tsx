"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Button, Card, Price, Skeleton, VegMark, useToast } from "@/components/ui";
import { CartSummary } from "@/components/customer/CartSummary";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import { SiteHeader } from "@/components/customer/SiteHeader";
import { useCart } from "@/components/customer/CartProvider";
import { FoodImage } from "@/components/customer/FoodImage";
import { HeartToggle } from "@/components/customer/HeartToggle";
import { api, describeApiError, addFavourite, listFavourites, removeFavourite } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  cartItemCount,
  cartLineIdentity,
  cartSubtotal,
  makeCartLine,
} from "@/lib/cart";
import type { CartLine } from "@/lib/cart";
import { FREE_DELIVERY_THRESHOLD_INR } from "@/lib/checkout";
import { formatINR, servedWindow } from "@/lib/customer";
import type { MenuItem, OutletMenu } from "@/lib/customer";
import { openOrderAgainItem } from "@/lib/order-suggestions";

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

function SpiceLevel({ level }: { level: number }) {
  const label = ["No heat", "Mild", "Medium", "Hot"][Math.max(0, Math.min(3, level))];
  return (
    <span className="spice-level" aria-label={`Spice level: ${label}`}>
      <span aria-hidden="true">{Array.from({ length: 3 }, (_, index) => index < level ? "🌶" : "·").join("")}</span>
      <span>{label}</span>
    </span>
  );
}

function ItemCard({
  item,
  categoryAvailable,
  onOpen,
  isFavourite,
  onToggleFavourite,
  priority = false,
  outletId,
}: {
  item: MenuItem;
  categoryAvailable: boolean;
  onOpen: (item: MenuItem) => void;
  isFavourite: boolean;
  onToggleFavourite: () => void;
  priority?: boolean;
  outletId: string;
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

  function handleAdd() {
    addLine(outletId, makeCartLine(item, defaultVariantId, [], 1));
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
    <Card className={`menu-item-card${!available ? " menu-item-unavailable" : ""}`}>
      <button
        type="button"
        className="menu-item-main"
        onClick={() => onOpen(item)}
        onKeyDown={handleCardKeyDown}
        aria-label={`View ${item.name} details`}
      >
        <FoodImage
          src={item.photo_url}
          name={item.name}
          isVeg={item.is_veg}
          className="menu-item-photo"
          priority={priority}
          sizes="(max-width: 680px) 46vw, 230px"
        />
        <span className="menu-item-name-row">
          <strong>{item.name}</strong>
          <VegMark isVeg={item.is_veg} />
        </span>
      </button>
      <div className="menu-item-heart">
        <HeartToggle itemId={item.id} isFavourite={isFavourite} onToggle={onToggleFavourite} />
      </div>
      <p className="menu-item-description">{item.description}</p>
      <div className="menu-item-meta">
        <SpiceLevel level={item.spice_level} />
        {available ? (
          <Price amount={item.price} showGst={false} />
        ) : (
          <span className="unavailable-label">
            {!categoryAvailable ? "Served later" : "Unavailable"}
          </span>
        )}
      </div>
      {available && (
        <div className="menu-item-action">
          {quantity > 0 ? (
            <QuantityStepper
              quantity={quantity}
              label={`Quantity of ${item.name}`}
              onDecrease={handleDecrease}
              onIncrease={handleIncrease}
            />
          ) : (
            <Button variant="primary" className="menu-add-button" onClick={handleAdd}>
              Add to Cart +
            </Button>
          )}
        </div>
      )}
    </Card>
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
          </div>
          <div className="item-sheet-body">
            <div className="item-sheet-title">
              <div>
                <div className="menu-item-name-row">
                  <h2>{item.name}</h2>
                  <VegMark isVeg={item.is_veg} />
                  <HeartToggle itemId={item.id} isFavourite={isFavourite} onToggle={onToggleFavourite} />
                </div>
                <p>{item.description}</p>
              </div>
              <SpiceLevel level={item.spice_level} />
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
                  <label className="choice-row" key={variant.id}>
                    <span>
                      <input
                        type="radio"
                        name="portion"
                        value={variant.id}
                        checked={variantId === variant.id}
                        onChange={() => setVariantId(variant.id)}
                      />
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
                  <label className="choice-row" key={addon.id}>
                    <span>
                      <input
                        type="checkbox"
                        checked={addonIds.includes(addon.id)}
                        onChange={() => toggleAddon(addon.id)}
                      />
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
                Add to cart — {formatINR(total * quantity)}
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
        <div className="menu-skeleton" role="status" aria-label="Loading menu">
      {[0, 1, 2, 3].map((key) => (
        <Card className="menu-skeleton-card" key={key}>
          <Skeleton className="menu-skeleton-photo" />
          <div className="menu-skeleton-copy">
            <Skeleton className="skeleton-line skeleton-title" />
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line skeleton-short" />
          </div>
        </Card>
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
  const [activeCategory, setActiveCategory] = useState("");
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
        setActiveCategory(result.categories[0]?.id ?? "");
        setError(null);
      } catch (requestError) {
        if (!active) return;
        setMenu(null);
        setError(describeApiError(requestError, "We couldn’t load this menu."));
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
            message: describeApiError(error, "Saved dishes couldn’t load."),
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

  useEffect(() => {
    if (menu) revalidate(menu);
  }, [menu, revalidate]);

  const visibleCategories = useMemo(() => {
    if (!menu) return [];
    const query = search.trim().toLocaleLowerCase();
    return menu.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) =>
          (!vegOnly || item.is_veg) &&
          (!query || `${item.name} ${item.description}`.toLocaleLowerCase().includes(query)),
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [menu, search, vegOnly]);

  useEffect(() => {
    if (!visibleCategories.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
        if (visible) setActiveCategory(visible.target.id.replace("category-", ""));
      },
      { rootMargin: "-170px 0px -65% 0px", threshold: 0 },
    );
    visibleCategories.forEach((category) => {
      const section = document.getElementById(`category-${category.id}`);
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, [visibleCategories]);

  useEffect(() => {
    if (cart.outletId && cart.outletId !== outletId && cart.lines.length > 0) {
      toast("This cart belongs to another kitchen. Change back to that kitchen to continue.", "error");
    }
  }, [cart.lines.length, cart.outletId, outletId, toast]);

  function jumpToCategory(categoryId: string) {
    setActiveCategory(categoryId);
    document.getElementById(`category-${categoryId}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

  function scrollToMenu() {
    document.getElementById("menu-section")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

  const availableItemCount = menu?.categories.reduce(
    (count, category) =>
      count + (category.available_now ? category.items.filter((item) => item.available).length : 0),
    0,
  ) ?? 0;
  const total = cartSubtotal(cart.lines);
  const menuItems = menu?.categories.flatMap((category) => category.items) ?? [];
  const suggestions = suggestionResult?.key === suggestionKey
    ? suggestionResult.suggestions
    : [];
  const suggestionError = suggestionFailure?.key === suggestionKey
    ? suggestionFailure.message
    : "";
  const orderAgainItems = suggestions
    .map((suggestion) => menuItems.find((item) => item.id === suggestion.item_id))
    .filter((item): item is MenuItem => Boolean(item?.available));

  const orderAgainBlock = (
    <>
      {orderAgainItems.length > 0 && (
        <section className="order-again" aria-labelledby="order-again-heading">
          <div className="home-row-heading">
            <p className="customer-eyebrow">From your order history</p>
            <h2 id="order-again-heading">Order again</h2>
          </div>
          <div className="order-again-list">
            {orderAgainItems.map((item) => (
              <article className="dish-row-card" key={item.id}>
                <button
                  type="button"
                  className="dish-row-main"
                  onClick={() => openOrderAgainItem(item, setActiveItem)}
                  aria-label={`View ${item.name} details`}
                >
                  <FoodImage
                    src={item.photo_url}
                    name={item.name}
                    isVeg={item.is_veg}
                    className="dish-row-photo"
                    sizes="72px"
                  />
                  <span className="dish-row-copy">
                    <strong>{item.name}</strong>
                    <span>{formatINR(item.price)}</span>
                  </span>
                </button>
                <HeartToggle
                  itemId={item.id}
                  isFavourite={favouriteIds.has(item.id)}
                  onToggle={() => toggleFavourite(item.id)}
                />
              </article>
            ))}
          </div>
        </section>
      )}
      {suggestionError && (
        <div className="order-again-error" role="alert">
          <span>{suggestionError}</span>
          <button
            type="button"
            onClick={() => setSuggestionRequestVersion((version) => version + 1)}
          >
            Try again
          </button>
        </div>
      )}
    </>
  );

  return (
    <main className="customer-page menu-page">
      {menu && (
        <>
          {!browseFirst && (
            <SiteHeader onOpenCart={onOpenCart} search={search} onSearch={setSearch} />
          )}
          <div className="menu-header">
            {!browseFirst && (
              <>
                <div className="menu-header-main">
                  <div className="menu-outlet-title"><p className="customer-eyebrow">Fresh from the kitchen</p><h1>{menu.outlet.name}</h1></div>
                  <div className="menu-header-actions">
                    <span className={`outlet-status ${menu.outlet.is_open ? "is-open" : "is-closed"}`}>
                      <span aria-hidden="true" />
                      {menu.outlet.is_open ? "Open now" : "Closed"}
                    </span>
                    <Link className="change-link" href="/?change=1">Change</Link>
                  </div>
                </div>
                <p className="menu-header-details">
                  FSSAI {menu.outlet.fssai_number}
                  {menu.outlet.type === "cloud_kitchen" && <span className="cloud-kitchen-label">Cloud kitchen</span>}
                </p>
              </>
            )}
            <p className="menu-gst-note">All menu prices {menu.price_note}</p>
          </div>

          {browseFirst && (
            <section className="home-hero" aria-labelledby="home-hero-title">
              <div className="home-hero-visual pattern-bg">
                <div className="home-hero-photo-main">
                  <FoodImage
                    src={menuItems[0]?.photo_url ?? ""}
                    name={menuItems[0]?.name ?? "Hyderabadi food"}
                    isVeg={menuItems[0]?.is_veg ?? false}
                    className="home-hero-photo"
                    priority
                    sizes="(max-width: 860px) 60vw, 30vw"
                  />
                  {menuItems[1] && (
                    <div className="home-hero-photo-thumb">
                      <FoodImage
                        src={menuItems[1].photo_url}
                        name={menuItems[1].name}
                        isVeg={menuItems[1].is_veg}
                        className="home-hero-thumb-photo"
                        sizes="120px"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="home-hero-copy">
                <p className="customer-eyebrow">Fresh from {menu.outlet.name}</p>
                <h1 id="home-hero-title">
                  <span className="script">Signature</span>
                  <span className="home-hero-title-line">Hyderabadi Biryani</span>
                </h1>
                <p>Fragrant basmati rice, marinated meat and authentic spices, dum-cooked to perfection.</p>
                <div className="home-hero-actions">
                  <Button variant="primary" className="home-hero-order" onClick={scrollToMenu}>
                    Order now <span aria-hidden="true">→</span>
                  </Button>
                  <span className={`hero-delivery ${menu.outlet.is_open ? "is-open" : "is-closed"}`}>
                    <span aria-hidden="true">●</span> {menu.outlet.is_open ? "Open now · Delivery in about 35 min" : "Closed now · Order when we open"}
                  </span>
                </div>
              </div>
              <span className="home-hero-edge" aria-hidden="true" />
            </section>
          )}

          {browseFirst && (
            <section className="home-discovery" aria-label="Discover the menu">
              <nav className="home-chips" aria-label="Categories">
                {menu.categories.map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    className={activeCategory === category.id ? "home-chip is-active" : "home-chip"}
                    onClick={() => jumpToCategory(category.id)}
                    aria-current={activeCategory === category.id ? "location" : undefined}
                  >
                    {category.name}
                  </button>
                ))}
              </nav>
              <div className="home-promo-strip">
                <div className="home-promo-card home-promo-party">
                  <div className="home-promo-party-copy">
                    <p className="customer-eyebrow">Gather well</p>
                    <h2>Planning a party?</h2>
                    <p>Order for 10 or more and let a catering manager confirm the details.</p>
                  </div>
                  <Link className="button button-primary" href="/party">Plan a party</Link>
                </div>
                <div className="home-promo-card home-promo-perks">
                  <div className="home-promo-perks-copy">
                    <span className="home-promo-pill">Since 2023</span>
                    <p>Free delivery over Rs {FREE_DELIVERY_THRESHOLD_INR} · Earn points on every direct order · Coupons at checkout</p>
                  </div>
                  <button type="button" className="home-promo-order" onClick={scrollToMenu}>
                    Order now
                  </button>
                </div>
              </div>
              {favouritesSection}
              {orderAgainBlock}
            </section>
          )}

          <div className="menu-tools">
            <label className="menu-search">
              <span className="search-glyph" aria-hidden="true">⌕</span>
              <span className="sr-only">Search menu</span>
              <input
                type="search"
                placeholder="Search the menu"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="veg-filter">
              <input
                type="checkbox"
                checked={vegOnly}
                onChange={(event) => setVegOnly(event.target.checked)}
              />
              <VegMark isVeg />
              <span>Veg only</span>
            </label>
          </div>

          {visibleCategories.length > 0 && (
            <nav className="category-tabs" aria-label="Menu categories">
              {visibleCategories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  className={activeCategory === category.id ? "category-tab active" : "category-tab"}
                  onClick={() => jumpToCategory(category.id)}
                  aria-current={activeCategory === category.id ? "location" : undefined}
                >
                  {category.name}
                  {!category.available_now && <span className="category-tab-closed">Later</span>}
                </button>
              ))}
            </nav>
          )}
          {!browseFirst && orderAgainBlock}
        </>
      )}

      <div className="menu-layout" id={browseFirst ? "menu-section" : undefined}>
        <div className="menu-content">
          {loading && <MenuSkeleton />}
          {error && (
            <div className="customer-error menu-error" role="alert">
              <h2>Menu unavailable</h2>
              <p>{error}</p>
              <Button
                variant="primary"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  setRequestVersion((version) => version + 1);
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {!loading && !error && menu && availableItemCount === 0 && (
            <div className="customer-empty menu-empty">
              <h2>This kitchen has no available items right now</h2>
              <p>Check back soon or choose another nearby kitchen.</p>
              <Link className="button button-secondary" href="/?change=1">Change kitchen</Link>
            </div>
          )}
          {!loading && !error && menu && availableItemCount > 0 && visibleCategories.length === 0 && (
            <div className="customer-empty menu-empty">
              <h2>No dishes match</h2>
              <p>Try a different search or turn off the veg-only filter.</p>
            </div>
          )}
          {!loading && !error && menu && visibleCategories.map((category, categoryIndex) => (
            <section
              className={`menu-category${!category.available_now ? " menu-category-closed" : ""}`}
              id={`category-${category.id}`}
              key={category.id}
              aria-labelledby={`category-title-${category.id}`}
            >
              <header className="menu-category-header">
                <div>
                  <h2 id={`category-title-${category.id}`}>{category.name}</h2>
                  <p>
                    {category.available_now
                      ? `${category.items.length} ${category.items.length === 1 ? "dish" : "dishes"}`
                      : servedWindow(category.window_text) ?? "Not serving now"}
                  </p>
                </div>
                {!category.available_now && <span className="category-unavailable">Not serving now</span>}
              </header>
              <div className="menu-item-list">
                {category.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    categoryAvailable={category.available_now && menu.outlet.is_open}
                    onOpen={setActiveItem}
                    isFavourite={favouriteIds.has(item.id)}
                    onToggleFavourite={() => toggleFavourite(item.id)}
                    priority={categoryIndex === 0 && item.id === category.items[0]?.id}
                    outletId={outletId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="menu-cart-aside" aria-label="Cart summary">
          <CartSummary />
        </aside>
      </div>

      {hydrated && cart.lines.length > 0 && (
        <Link className="mobile-cart-bar" href="/cart">
          <span>{cartItemCount(cart.lines)} items</span>
          <strong>{formatINR(total)}</strong>
          <span className="mobile-cart-action">View cart <span aria-hidden="true">→</span></span>
        </Link>
      )}
      <ItemSheet
        key={activeItem?.id ?? "closed"}
        item={activeItem}
        outletId={outletId}
        onClose={() => setActiveItem(null)}
        isFavourite={activeItem ? favouriteIds.has(activeItem.id) : false}
        onToggleFavourite={() => { if (activeItem) toggleFavourite(activeItem.id); }}
      />
      {menu && <footer className="customer-footer">
        <div><strong>Hyderabad Biryani</strong><span>FSSAI {menu.outlet.fssai_number}</span></div>
        <div><span>Prices include 5% GST</span><Link href="/privacy">Privacy</Link></div>
        <span>Outlet: {menu.outlet.name}{menu.outlet.address ? ` · ${menu.outlet.address}` : ""}</span>
      </footer>}
    </main>
  );
}
