"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="customer-page">
      <article className="error-panel" role="alert">
        <div>
          <h2>Something went wrong</h2>
          <p>
            This screen didn&apos;t load. Check your connection and try again.
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button button-secondary" href="/">
            Back to ordering
          </Link>
          <button type="button" className="button button-primary" onClick={retry}>
            Try again
          </button>
        </div>
      </article>
    </main>
  );
}
