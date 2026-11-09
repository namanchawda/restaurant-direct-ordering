"use client";

import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { LandingFooter } from "./LandingFooter";

export type PageShellProps = {
  title: string;
  subtitle?: string;
  headerProps?: React.ComponentProps<typeof SiteHeader>;
  children: ReactNode;
  tone?: "cream" | "tan";
};

export function PageShell({
  title,
  subtitle,
  headerProps,
  children,
  tone = "cream",
}: PageShellProps) {
  return (
    <main className={`customer-page hb-themed hb-inner page-tone-${tone}`}>
      <SiteHeader {...headerProps} />
      <div className="page-band">
        <div className="page-band-inner">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="hb-checker" aria-hidden="true" />
      <div className="page-body">
        {children}
      </div>
      <LandingFooter />
    </main>
  );
}