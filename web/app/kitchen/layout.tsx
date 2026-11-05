import { RoleGuard } from "@/components/auth/RoleGuard";

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard role="kitchen">{children}</RoleGuard>;
}
