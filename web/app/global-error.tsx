"use client";

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main className="customer-page">
          <article className="error-panel" role="alert">
            <div>
              <h2>Something went wrong</h2>
              <p>
                This screen didn&apos;t load. Check your connection and try
                again.
              </p>
            </div>
            <button
              type="button"
              className="button button-primary"
              onClick={retry}
            >
              Try again
            </button>
          </article>
        </main>
      </body>
    </html>
  );
}
