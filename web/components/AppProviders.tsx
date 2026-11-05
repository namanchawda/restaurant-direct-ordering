"use client";

import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";
import { CartProvider } from "@/components/customer/CartProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <CartProvider>{children}</CartProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
