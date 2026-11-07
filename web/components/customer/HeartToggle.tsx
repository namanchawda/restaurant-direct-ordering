"use client";

import { useState } from "react";
import { useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export function HeartToggle({
  itemId,
  isFavourite,
  onToggle,
}: {
  itemId: string;
  isFavourite: boolean;
  onToggle: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  function handleClick() {
    if (!user || user.role !== "customer") {
      toast("Sign in at checkout to save favourites.", "info");
      return;
    }
    if (busy) return;
    setBusy(true);
    onToggle();
    setBusy(false);
  }

  return (
    <button
      type="button"
      className={`heart-toggle${isFavourite ? " heart-toggle-on" : ""}${busy ? " heart-toggle-busy" : ""}`}
      aria-pressed={isFavourite}
      aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
      data-item-id={itemId}
      disabled={busy}
      onClick={handleClick}
    >
      <span aria-hidden="true">{isFavourite ? "♥" : "♡"}</span>
    </button>
  );
}
