import { RoleGuard } from "@/components/auth/RoleGuard";
import { KitchenChrome } from "@/components/kitchen/KitchenChrome";
import "./kitchen.css";

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="kitchen">
      <KitchenChrome>{children}</KitchenChrome>
    </RoleGuard>
  );
}
