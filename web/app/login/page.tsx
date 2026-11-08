"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useSignIn } from "@/components/auth/SignInProvider";
import { roleHome, safeNext } from "@/lib/sign-in";
import type { SignInMode } from "@/lib/sign-in";

function LoginEntry() {
  const { logout, user, ready } = useAuth();
  const { openSignIn } = useSignIn();
  const router = useRouter();
  const searchParams = useSearchParams();
  const opened = useRef(false);
  const mode: SignInMode = searchParams.get("mode") === "customer" ? "customer" : "staff";
  const next = safeNext(searchParams.get("next"));
  const roleMismatch = searchParams.get("message")?.startsWith("role-") ?? false;
  const notice = useMemo(() => {
    switch (searchParams.get("message")) {
      case "role-admin-required": return "This page is for admin accounts. Sign in with an admin phone and password.";
      case "role-kitchen-required": return "This page is for kitchen accounts. Sign in with a kitchen phone and password.";
      case "role-catering-required": return "This page is for catering managers. Sign in with a catering account.";
      case "role-customer-required": return "This page is for customers. Sign in with your phone and a code.";
      case "session-expired": return "Your session expired. Sign in again to continue.";
      case "sign-in-required": return "Sign in to continue.";
      default: return "";
    }
  }, [searchParams]);

  useEffect(() => {
    if (!ready || roleMismatch) return;
    if (user && user.role !== "customer") router.replace(next ?? roleHome(user.role));
    else if (user && user.role === "customer" && mode === "customer") router.replace(next ?? "/");
  }, [ready, roleMismatch, user, router, next, mode]);

  useEffect(() => {
    if (!ready || opened.current) return;
    if (user && !roleMismatch) return;
    opened.current = true;
    openSignIn({ mode, redirectTo: next ?? undefined });
  }, [ready, user, roleMismatch, mode, next, openSignIn]);

  return (
    <main className="login-shell">
      <section className="login-card">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        <div className="login-heading">
          <h1>Welcome back</h1>
          <p>Sign in as a customer or as staff.</p>
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
        {user && roleMismatch && (
          <Button type="button" variant="secondary" onClick={() => { logout(); router.replace(`/login?mode=${mode}`); }}>
            Sign out and switch account
          </Button>
        )}
        <Button variant="primary" onClick={() => openSignIn({ mode, redirectTo: next ?? undefined })}>Sign in</Button>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="login-shell" aria-label="Loading sign-in" />}>
      <LoginEntry />
    </Suspense>
  );
}
