"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to monitoring service in production
    console.error("Application error:", error);
  }, [error]);

  return (
    <main className="page-shell">
      <div className="panel">
        <div className="eyebrow">Error</div>
        <h1 className="hero-title">Something went wrong</h1>
        <p className="muted">
          An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
        <div className="toolbar">
          <button className="button" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
