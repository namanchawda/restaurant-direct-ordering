import { RoleGuard } from "@/components/auth/RoleGuard";

export default function CateringLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role={["catering", "admin"]}>
      {children}
    </RoleGuard>
  );
}
