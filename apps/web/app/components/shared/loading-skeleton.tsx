"use client";

export interface LoadingSkeletonProps {
  message?: string;
}

export function LoadingSkeleton({ message = "Loading..." }: LoadingSkeletonProps) {
  return (
    <main className="page-shell">
      <section className="hero">
        {/* Header skeleton */}
        <div className="panel">
          <div className="skeleton-container">
            <div className="skeleton skeleton-eyebrow animate-pulse" />
            <div className="skeleton skeleton-title animate-pulse" />
            <div className="skeleton skeleton-text animate-pulse" />
            <div className="skeleton skeleton-text-short animate-pulse" />
          </div>
        </div>

        {/* Stats skeleton */}
        <div className="panel">
          <div className="skeleton-container">
            <div className="skeleton skeleton-eyebrow animate-pulse" />
            <div className="stats">
              <div className="stat">
                <div className="skeleton skeleton-stat-label animate-pulse" />
                <div className="skeleton skeleton-stat-value animate-pulse" />
              </div>
              <div className="stat">
                <div className="skeleton skeleton-stat-label animate-pulse" />
                <div className="skeleton skeleton-stat-value animate-pulse" />
              </div>
              <div className="stat">
                <div className="skeleton skeleton-stat-label animate-pulse" />
                <div className="skeleton skeleton-stat-value animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        {/* Left column skeleton */}
        <div className="stack">
          <div className="panel">
            <div className="skeleton-container">
              <div className="skeleton skeleton-eyebrow animate-pulse" />
              <div className="list">
                {[1, 2, 3].map((i) => (
                  <article className="item" key={i}>
                    <div className="skeleton skeleton-pill animate-pulse" />
                    <div className="skeleton skeleton-heading animate-pulse" />
                    <div className="skeleton skeleton-text animate-pulse" />
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right column skeleton */}
        <div className="stack">
          <div className="panel">
            <div className="skeleton-container">
              <div className="skeleton skeleton-eyebrow animate-pulse" />
              <div className="list">
                {[1, 2, 3].map((i) => (
                  <article className="item" key={i}>
                    <div className="skeleton skeleton-pill animate-pulse" />
                    <div className="skeleton skeleton-heading animate-pulse" />
                    <div className="skeleton skeleton-text animate-pulse" />
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Loading message overlay */}
      <div className="loading-overlay">
        <div className="loading-spinner" />
        <p className="muted">{message}</p>
      </div>

      <style jsx>{`
        .skeleton-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .skeleton {
          background: linear-gradient(
            90deg,
            rgba(200, 200, 200, 0.2) 25%,
            rgba(200, 200, 200, 0.4) 50%,
            rgba(200, 200, 200, 0.2) 75%
          );
          background-size: 200% 100%;
          border-radius: 4px;
        }

        .animate-pulse {
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% {
            background-position: 200% 0;
          }
          50% {
            background-position: -200% 0;
          }
        }

        .skeleton-eyebrow {
          height: 0.75rem;
          width: 6rem;
        }

        .skeleton-title {
          height: 2rem;
          width: 80%;
        }

        .skeleton-text {
          height: 1rem;
          width: 100%;
        }

        .skeleton-text-short {
          height: 1rem;
          width: 60%;
        }

        .skeleton-stat-label {
          height: 0.75rem;
          width: 4rem;
        }

        .skeleton-stat-value {
          height: 1.5rem;
          width: 2rem;
        }

        .skeleton-pill {
          height: 1.25rem;
          width: 4rem;
          border-radius: 9999px;
        }

        .skeleton-heading {
          height: 1.25rem;
          width: 70%;
        }

        .loading-overlay {
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          background: rgba(0, 0, 0, 0.8);
          border-radius: 8px;
          z-index: 1000;
        }

        .loading-spinner {
          width: 1.25rem;
          height: 1.25rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </main>
  );
}
