"use client";

import { useMemo, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Skeleton } from "@/components/ui";

export function RoleGuard({
  role,
  children,
}: {
  role: string | string[];
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const roles = useMemo(() => (Array.isArray(role) ? role : [role]), [role]);

  useEffect(() => {
    if (!ready) return;
    if (!user || !roles.includes(user.role)) {
      const message = !user ? "sign-in-required" : `role-${roles[0]}-required`;
      const mode = roles.includes("customer") ? "customer" : "staff";
      router.replace(`/login?mode=${mode}&message=${message}&next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, user, roles, pathname, router]);

  if (!ready || !user || !roles.includes(user.role)) {
    return (
      <main className="guard-loading" aria-label="Checking access">
        <Skeleton className="guard-skeleton" />
      </main>
    );
  }
  return children;
}
