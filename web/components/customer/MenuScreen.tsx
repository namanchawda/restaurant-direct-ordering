"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button, Card, Price, Skeleton, VegMark, useToast } from "@/components/ui";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { CartSummary } from "@/components/customer/CartSummary";
import { useCart } from "@/components/customer/CartProvider";
import { FoodImage } from "@/components/customer/FoodImage";
import { api, describeApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  cartItemCount,
  cartLineIdentity,
  cartSubtotal,
  makeCartLine,
} from "@/lib/cart";
import type { CartLine } from "@/lib/cart";
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
  outletId,
  priority = false,
}: {
  item: MenuItem;
  categoryAvailable: boolean;
  onOpen: (item: MenuItem) => void;
  outletId: string;
  priority?: boolean;
}) {
  const { cart, addLine, setQuantity, removeLine } = useCart();
  const simpleItem = item.variants.length === 0 && item.addons.length === 0;
  const directLineId = cartLineIdentity(item.id, null, []);
  const line = cart.lines.find((candidate) => candidate.id === directLineId);
  const available = categoryAvailable && item.available;

  function addDirectly() {
    if (!available) return;
    addLine(outletId, makeCartLine(item, null, [], 1));
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(item);
    }
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
        />
        <span className="menu-item-copy">
          <span className="menu-item-name-row">
            <strong>{item.name}</strong>
            <VegMark isVeg={item.is_veg} />
          </span>
          <span className="menu-item-description">{item.description}</span>
          <span className="menu-item-meta">
            <SpiceLevel level={item.spice_level} />
            {available ? <Price amount={item.price} showGst={false} /> : (
              <span className="unavailable-label">
                {!categoryAvailable ? "Served later" : "Unavailable"}
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="menu-item-action">
        {!available ? (
          <span className="menu-item-disabled-copy">
            {!categoryAvailable ? "Not serving now" : "Not available"}
          </span>
        ) : simpleItem && line ? (
          <QuantityStepper
            quantity={line.quantity}
            label={`Quantity of ${item.name}`}
            onDecrease={() => {
              if (line.quantity <= 1) removeLine(line.id);
              else setQuantity(line.id, line.quantity - 1);
            }}
            onIncrease={() => setQuantity(line.id, line.quantity + 1)}
          />
        ) : (
          <Button
            variant="secondary"
            className="menu-add-button"
            onClick={simpleItem ? addDirectly : () => onOpen(item)}
            aria-label={simpleItem ? `Add ${item.name}` : `Choose ${item.name} options`}
          >
            {simpleItem ? "Add" : "Choose"}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function QuantityStepper({
  quantity,
  label,
  onDecrease,
  onIncrease,
}: {
  quantity: number;
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="quantity-stepper" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} onClick={onDecrease}>
        −
      </button>
      <span aria-live="polite">{quantity}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={onIncrease}
        disabled={quantity >= 20}
      >
        +
      </button>
    </div>
  );
}

function ItemSheet({
  item,
  outletId,
  onClose,
}: {
  item: MenuItem | null;
  outletId: string;
  onClose: () => void;
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

export function MenuScreen({ outletId }: { outletId: string }) {
  const toast = useToast();
  const { cart, hydrated, revalidate } = useCart();
  const { user, ready: authReady } = useAuth();
  const [menu, setMenu] = useState<OutletMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [vegOnly, setVegOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [suggestionResult, setSuggestionResult] = useState<{
    key: string;
    suggestions: OrderSuggestion[];
  } | null>(null);
  const [suggestionFailure, setSuggestionFailure] = useState<{ key: string; message: string } | null>(null);
  const [suggestionRequestVersion, setSuggestionRequestVersion] = useState(0);

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

  return (
    <main className="customer-page menu-page">
      {menu && (
        <>
          <header className="menu-header">
            <div className="menu-header-main">
              <div className="menu-outlet-title">
                <p className="customer-eyebrow">Fresh from the kitchen</p>
                <h1>{menu.outlet.name}</h1>
              </div>
              <div className="menu-header-actions">
                <span className={`outlet-status ${menu.outlet.is_open ? "is-open" : "is-closed"}`}>
                  <span aria-hidden="true" />
                  {menu.outlet.is_open ? "Open now" : "Closed"}
                </span>
                <AccountMenu />
                <Link className="change-link" href="/?change=1">Change</Link>
              </div>
            </div>
            <p className="menu-header-details">
              FSSAI {menu.outlet.fssai_number}
              {menu.outlet.type === "cloud_kitchen" && <span className="cloud-kitchen-label">Cloud kitchen</span>}
            </p>
            <p className="menu-gst-note">All menu prices {menu.price_note}</p>
          </header>

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
          {orderAgainItems.length > 0 && (
            <section className="order-again" aria-labelledby="order-again-heading">
              <div className="order-again-heading">
                <div>
                  <p className="customer-eyebrow">From your order history</p>
                  <h2 id="order-again-heading">Order again</h2>
                </div>
              </div>
              <div className="order-again-list">
                {orderAgainItems.map((item) => (
                  <button
                    className="order-again-item"
                    key={item.id}
                    type="button"
                    onClick={() => openOrderAgainItem(item, setActiveItem)}
                    aria-label={`View ${item.name} details`}
                  >
                    <FoodImage
                      src={item.photo_url}
                      name={item.name}
                      isVeg={item.is_veg}
                      className="order-again-photo"
                    />
                    <span className="order-again-copy">
                      <strong>{item.name}</strong>
                      <span>{formatINR(item.price)}</span>
                    </span>
                    <span className="order-again-action">View</span>
                  </button>
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
      )}

      <div className="menu-layout">
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
                    outletId={outletId}
                    onOpen={setActiveItem}
                    priority={categoryIndex === 0 && item.id === category.items[0]?.id}
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
      />
    </main>
  );
}
