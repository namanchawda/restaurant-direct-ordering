"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { useCart } from "@/components/customer/CartProvider";
import { useSignIn } from "@/components/auth/SignInProvider";
import { useAuth } from "@/lib/auth";
import { cartItemCount } from "@/lib/cart";
import type { DeliveryArea } from "@/lib/customer";

type NavItem = {
  href: string;
  label: string;
  gated?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Menu" },
  { href: "/party", label: "Party orders" },
  { href: "/orders", label: "My orders", gated: true },
  { href: "/profile#favourites", label: "Favourites", gated: true },
  { href: "/rewards", label: "Rewards", gated: true },
];

export type SiteHeaderProps = {
  area?: DeliveryArea;
  onChangeLocation?: () => void;
  onOpenCart?: () => void;
  search?: string;
  onSearch?: (value: string) => void;
};

function SearchField({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  if (!onChange) return null;
  return (
    <label className="site-search">
      <span aria-hidden="true" className="site-search-glyph">⌕</span>
      <span className="sr-only">Search dishes</span>
      <input
        type="search"
        placeholder="Search"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function LocationChip({ area, onChange }: { area?: DeliveryArea; onChange?: () => void }) {
  if (!area || !onChange) return null;
  return (
    <button type="button" className="site-location" onClick={onChange}>
      <span aria-hidden="true" className="site-location-glyph">⌖</span>
      <span className="site-location-text">Delivering to {area.name}, Hyderabad</span>
      <u className="site-location-change">Change</u>
    </button>
  );
}

export function SiteHeader({ area, onChangeLocation, onOpenCart, search, onSearch }: SiteHeaderProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { openSignIn } = useSignIn();
  const { cart } = useCart();
  const [hash, setHash] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function isActive(item: NavItem) {
    const [path, anchor] = item.href.split("#");
    if (anchor) return pathname === path && hash === `#${anchor}`;
    if (path === "/") return pathname === "/" || pathname.startsWith("/outlet");
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  function handleNavClick(event: MouseEvent<HTMLAnchorElement>, item: NavItem) {
    if (item.gated && !user) {
      event.preventDefault();
      setMenuOpen(false);
      openSignIn({ mode: "customer" });
      return;
    }
    setMenuOpen(false);
  }

  const cartCount = cartItemCount(cart.lines);
  const cartLabel = `Open cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`;
  const cartMark = (
    <>
      <span aria-hidden="true">🛒</span>
      <span className="site-cart-count">{cartCount}</span>
    </>
  );

  const navLinks = NAV_ITEMS.map((item) => {
    const active = isActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`site-nav-link${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={(event) => handleNavClick(event, item)}
      >
        {item.label}
      </Link>
    );
  });

  return (
    <header className="site-header">
      <div className="site-header-shell">
        <div className="site-header-bar">
          <Link className="brand-lockup site-brand" href="/">
            <span className="brand-mark" aria-hidden="true">H</span>
            <span>Hyderabad Biryani</span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            {navLinks}
          </nav>

          <div className="site-header-actions">
            <div className="site-menu" ref={menuRef}>
              <button
                type="button"
                className="site-menu-toggle"
                aria-expanded={menuOpen}
                aria-controls="site-nav-panel"
                onClick={() => setMenuOpen((value) => !value)}
              >
                Menu
                <span aria-hidden="true" className={`site-menu-chevron${menuOpen ? " is-open" : ""}`}>⌄</span>
              </button>
              {menuOpen && (
                <nav className="site-nav-panel" id="site-nav-panel" aria-label="Primary">
                  {navLinks}
                </nav>
              )}
            </div>
            <SearchField value={search} onChange={onSearch} />
            <LocationChip area={area} onChange={onChangeLocation} />
            <AccountMenu className="site-account" />
            {onOpenCart ? (
              <button type="button" className="site-cart" onClick={onOpenCart} aria-label={cartLabel}>
                {cartMark}
              </button>
            ) : (
              <Link className="site-cart" href="/cart" aria-label={cartLabel}>
                {cartMark}
              </Link>
            )}
          </div>
        </div>
      </div>

      {(onSearch || (area && onChangeLocation)) && (
        <div className="site-header-row">
          <SearchField value={search} onChange={onSearch} />
          <LocationChip area={area} onChange={onChangeLocation} />
        </div>
      )}
    </header>
  );
}
