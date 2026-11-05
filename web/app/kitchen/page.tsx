"use client";

import { useAuth } from "@/lib/auth";
import { Button, Card } from "@/components/ui";

export default function KitchenPlaceholder() {
  const { user, logout } = useAuth();
  return (
    <main className="kitchen-placeholder">
      <header className="kitchen-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Kitchen</span>
        </div>
        <Button variant="quiet" onClick={logout}>Sign out</Button>
      </header>
      <Card className="kitchen-card">
        <p className="eyebrow">Kitchen workspace</p>
        <h1>{user?.name || "Kitchen team"}</h1>
        <p>The kitchen display is coming next. Your staff sign-in is ready.</p>
      </Card>
    </main>
  );
}
