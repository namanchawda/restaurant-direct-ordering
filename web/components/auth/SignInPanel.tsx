"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Button, Input, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { describeApiError } from "@/lib/api";
import type { User } from "@/lib/api";
import { isValidOtp, isValidPhone, roleHome, roleLabel } from "@/lib/sign-in";
import type { SignInMode } from "@/lib/sign-in";
import type { SignInOptions } from "@/components/auth/SignInProvider";

export function SignInPanel({ options, onClose }: { options: SignInOptions; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const toast = useToast();
  const { user, login, requestOtp, verifyOtp } = useAuth();
  const [mode, setMode] = useState<SignInMode>(options.mode ?? "customer");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const showDevOtp = process.env.NEXT_PUBLIC_SHOW_DEV_OTP === "true";

  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  function switchMode(next: SignInMode) {
    setMode(next);
    setError("");
    setStage("phone");
    setOtp("");
    setPassword("");
  }

  function finish(signedIn: User) {
    toast("You are signed in.", "success");
    options.onSuccess?.();
    const target = options.redirectTo ?? (signedIn.role !== "customer" ? roleHome(signedIn.role) : null);
    onClose();
    if (target) router.push(target);
  }

  async function sendOtp(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    if (!isValidPhone(phone)) {
      setError("Enter a 10-digit phone number.");
      return;
    }
    setBusy(true);
    try {
      await requestOtp(phone.trim());
      setStage("otp");
      setResendIn(30);
    } catch (reason) {
      setError(describeApiError(reason, "We couldn’t send the code. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isValidOtp(otp)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const signedIn = await verifyOtp(phone.trim(), otp.trim(), {
        name: name.trim() || undefined,
        marketingOptIn: optIn ? true : undefined,
      });
      finish(signedIn);
    } catch (reason) {
      setError(describeApiError(reason, "That code didn’t work. Check it and try again."));
    } finally {
      setBusy(false);
    }
  }

  async function staffLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isValidPhone(phone) || !password) {
      setError("Enter your 10-digit phone number and password.");
      return;
    }
    setBusy(true);
    try {
      finish(await login(phone.trim(), password));
    } catch (reason) {
      setError(describeApiError(reason, "We couldn’t sign you in. Check your details and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="signin-dialog"
      aria-labelledby="signin-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="signin-content">
        <header className="signin-header">
          <span className="brand-lockup signin-brand">
            <span className="brand-mark" aria-hidden="true">H</span>
            <span>Hyderabad Biryani</span>
          </span>
          <h2 id="signin-title">Sign in to your account</h2>
          <button type="button" className="signin-close" aria-label="Close sign in" onClick={onClose}>×</button>
        </header>

        <div className="signin-toggle" role="tablist" aria-label="Account type">
          <button type="button" role="tab" id="signin-tab-customer" aria-selected={mode === "customer"} aria-controls="signin-body" onClick={() => switchMode("customer")}>Customer</button>
          <button type="button" role="tab" id="signin-tab-staff" aria-selected={mode === "staff"} aria-controls="signin-body" onClick={() => switchMode("staff")}>Staff</button>
        </div>

        {user && (
          <p className="notice" role="status">
            You are signed in as {roleLabel(user.role)}. Signing in will replace that session.
          </p>
        )}

        <div id="signin-body" role="tabpanel" aria-labelledby={`signin-tab-${mode}`}>
          {mode === "customer" && stage === "phone" && (
            <form className="signin-form" onSubmit={sendOtp}>
              <label className="field">
                <span>Phone number</span>
                <Input inputMode="tel" autoComplete="tel" placeholder="10-digit phone number" value={phone} onChange={(event) => setPhone(event.target.value)} autoFocus />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <Button type="submit" variant="primary" disabled={busy}>{busy ? "Sending…" : "Send code"}</Button>
            </form>
          )}

          {mode === "customer" && stage === "otp" && (
            <form className="signin-form" onSubmit={verify}>
              <p className="signin-hint">We sent a 6-digit code to {phone}. <button type="button" className="checkout-text-link" onClick={() => { setStage("phone"); setOtp(""); setError(""); }}>Change</button></p>
              <label className="field">
                <span>Code</span>
                <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} autoFocus />
              </label>
              {showDevOtp && <p className="signin-hint">Dev OTP: 123456</p>}
              <label className="field">
                <span>Your name (first time only)</span>
                <Input autoComplete="name" placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="signin-check">
                <input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} />
                <span>Send me offers by WhatsApp or SMS. Optional, you can opt out any time.</span>
              </label>
              <p className="signin-hint">We use your details only to process orders. See our <Link href="/privacy" onClick={onClose}>privacy notice</Link>.</p>
              {error && <p className="form-error" role="alert">{error}</p>}
              <Button type="submit" variant="primary" disabled={busy}>{busy ? "Checking…" : "Verify and continue"}</Button>
              <Button type="button" variant="quiet" disabled={resendIn > 0 || busy} onClick={() => void sendOtp()}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
            </form>
          )}

          {mode === "staff" && (
            <form className="signin-form" onSubmit={staffLogin}>
              <label className="field">
                <span>Phone number</span>
                <Input inputMode="tel" autoComplete="username" placeholder="10-digit phone number" value={phone} onChange={(event) => setPhone(event.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Password</span>
                <Input type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <Button type="submit" variant="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
              <p className="signin-hint">For authorised kitchen, admin and catering staff.</p>
            </form>
          )}
        </div>
      </div>
    </dialog>
  );
}
