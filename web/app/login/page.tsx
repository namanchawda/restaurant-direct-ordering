"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

function LoginForm() {
  const { login, user, ready } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const roleMismatch = searchParams.get("message")?.startsWith("role-") ?? false;
  const notice = useMemo(() => {
    switch (searchParams.get("message")) {
      case "role-admin-required":
        return "This page is for admin accounts. Sign in with an admin phone and password.";
      case "role-kitchen-required":
        return "This page is for kitchen accounts. Sign in with a kitchen phone and password.";
      case "session-expired":
        return "Your session expired. Sign in again to continue.";
      case "sign-in-required":
        return "Sign in to continue.";
      default:
        return "";
    }
  }, [searchParams]);

  useEffect(() => {
    if (roleMismatch) return;
    if (user?.role === "admin") router.replace("/admin/menu");
    if (user?.role === "kitchen") router.replace("/kitchen");
  }, [roleMismatch, router, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const signedInUser = await login(phone.trim(), password);
      router.replace(signedInUser.role === "admin" ? "/admin/menu" : "/kitchen");
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : "We couldn’t connect to the service. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <main className="login-shell" aria-label="Loading sign-in" />;

  return (
    <main className="login-shell">
      <section className="login-card">
        <Link className="brand-lockup" href="/" aria-label="Hyderabad Biryani home">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hyderabad Biryani</span>
        </Link>
        <div className="login-heading">
          <p className="eyebrow">Staff access</p>
          <h1>Welcome back</h1>
          <p>Sign in to manage your menu or kitchen.</p>
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Phone number</span>
            <Input
              autoComplete="username"
              inputMode="tel"
              name="phone"
              placeholder="10-digit phone number"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <Input
              autoComplete="current-password"
              name="password"
              placeholder="Enter your password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button className="login-submit" variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="login-footnote">For authorised kitchen and admin staff.</p>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="login-shell" aria-label="Loading sign-in" />}>
      <LoginForm />
    </Suspense>
  );
}
