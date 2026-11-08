"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  header,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  header?: (titleId: string) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = `dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === ref.current) onOpenChange(false);
      }}
    >
      <div className="dialog-content">
        {header ? (
          header(titleId)
        ) : (
          <header className="dialog-header">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            <Button
              variant="quiet"
              className="dialog-close"
              aria-label="Close dialog"
              onClick={() => onOpenChange(false)}
            >
              ×
            </Button>
          </header>
        )}
        {children}
      </div>
    </dialog>
  );
}
