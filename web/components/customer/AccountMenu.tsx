"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useSignIn } from "@/components/auth/SignInProvider";
import { roleHome } from "@/lib/sign-in";

export function AccountMenu({ className }: { className?: string }) {
  const { user, ready, logout } = useAuth();
  const { openSignIn } = useSignIn();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootClass = className ? ` ${className}` : "";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!ready) return null;

  if (!user) {
    return <button type="button" className={`account-sign-in${rootClass}`} onClick={() => openSignIn({ mode: "customer" })}>Sign in</button>;
  }
  if (user.role !== "customer") {
    return (
      <div className={`account-staff-links${rootClass}`}>
        <Link className="account-sign-in" href={roleHome(user.role)}>{user.role === "kitchen" ? "Kitchen" : user.role === "admin" ? "Admin" : "Catering"}</Link>
        <button type="button" className="account-sign-in" onClick={() => { logout(); router.push("/"); }}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="account-menu" ref={menuRef}>
      <button
        type="button"
        className="account-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        Account
        <span aria-hidden="true" className={`account-menu-chevron${open ? " is-open" : ""}`}>⌄</span>
      </button>
      {open && (
        <div className="account-menu-panel" role="menu" aria-label="Your account">
          <p className="account-menu-name">{user.name ?? user.phone}</p>
          <Link role="menuitem" href="/orders" onClick={() => setOpen(false)}>
            Your orders
          </Link>
          <Link role="menuitem" href="/profile" onClick={() => setOpen(false)}>
            Profile
          </Link>
          <Link role="menuitem" href="/rewards" onClick={() => setOpen(false)}>
            Rewards
          </Link>
          <Link role="menuitem" href="/party/mine" onClick={() => setOpen(false)}>
            Party orders
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
              router.push("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
