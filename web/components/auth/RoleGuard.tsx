"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Skeleton } from "@/components/ui";

export function RoleGuard({
  role,
  children,
}: {
  role: "admin" | "kitchen";
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user || user.role !== role) {
      const message = !user ? "sign-in-required" : `role-${role}-required`;
      router.replace(`/login?message=${message}&next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, user, role, pathname, router]);

  if (!ready || !user || user.role !== role) {
    return (
      <main className="guard-loading" aria-label="Checking access">
        <Skeleton className="guard-skeleton" />
      </main>
    );
  }
  return children;
}
