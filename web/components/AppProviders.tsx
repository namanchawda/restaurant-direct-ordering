"use client";

import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>{children}</ToastProvider>
    </AuthProvider>
  );
}
