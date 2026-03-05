"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import type { UserAccount } from "@/lib/types";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function InboxPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await apiGet<UserAccount>("/auth/me");
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1>Direct Messages</h1>
          <p className="subtle">Your conversations will appear here.</p>
        </div>
      </section>

      {error && <p className="error-box" role="alert">{error}</p>}

      {loading ? (
        <section className="table-panel" aria-busy="true">
          <div className="skeleton-stack">
            <div className="skeleton-line lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </section>
      ) : (
        <section className="empty-panel">
          <h3>No conversations yet</h3>
          <p className="subtle">
            Start by visiting a user profile or community and opening a direct message thread.
          </p>
          <Link href="/community" className="ghost-link">
            Go to Community
          </Link>
        </section>
      )}
    </main>
  );
}
