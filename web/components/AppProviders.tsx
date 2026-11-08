"use client";

import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";
import { CartProvider } from "@/components/customer/CartProvider";
import { SignInProvider } from "@/components/auth/SignInProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <SignInProvider>
          <CartProvider>{children}</CartProvider>
        </SignInProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
