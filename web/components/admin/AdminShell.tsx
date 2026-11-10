"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="admin-frame">
      <header className="admin-topbar topbar">
        <Link className="brand-lockup" href="/admin/menu">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        <div className="topbar-right" ref={menuRef}>
          <Link href="/admin/dashboard">Dashboard</Link>
          <Link href="/admin/coupons">Coupons</Link>
          <Link href="/catering">Catering</Link>
          <span className="user-chip"><span className="user-avatar">A</span>{user?.name || "Admin"}</span>
          <button className="text-button" type="button" onClick={logout}>Sign out</button>
          <button
            className="topbar-menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="topbar-menu-panel"
            onClick={() => setMenuOpen((value) => !value)}
          >
            Menu
          </button>
          {menuOpen && (
            <nav className="topbar-menu-panel" id="topbar-menu-panel" aria-label="Admin">
              <Link href="/admin/dashboard" onClick={() => setMenuOpen(false)}>Dashboard</Link>
              <Link href="/admin/coupons" onClick={() => setMenuOpen(false)}>Coupons</Link>
              <Link href="/catering" onClick={() => setMenuOpen(false)}>Catering</Link>
              <span className="user-chip"><span className="user-avatar">A</span>{user?.name || "Admin"}</span>
              <button className="text-button" type="button" onClick={logout}>Sign out</button>
            </nav>
          )}
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
