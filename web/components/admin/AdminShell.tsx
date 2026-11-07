"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="admin-frame">
      <header className="admin-topbar">
        <Link className="brand-lockup" href="/admin/menu">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        <div className="topbar-right">
          <Link href="/admin/dashboard">Dashboard</Link>
          <Link href="/admin/coupons">Coupons</Link>
          <Link href="/catering">Catering</Link>
          <span className="user-chip"><span className="user-avatar">A</span>{user?.name || "Admin"}</span>
          <button className="text-button" type="button" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
