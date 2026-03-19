"use client";
import { useCallback, useState } from "react";
import EmptyStatePanel from "@/components/empty-state-panel";
import { apiGet, apiPost, isUnauthorizedError } from "@/lib/api";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { AppNotification, NotificationList } from "@/lib/types";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatStamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const [payload, setPayload] = useState<NotificationList | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiGet<NotificationList>("/notifications?limit=100");
      setPayload(next);
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        window.location.href = "/auth";
        return;
      }
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useAdaptivePolling(load, { activeMs: 45_000, hiddenMs: 180_000 });

  async function markAllRead() {
    setMarkingAll(true);
    setError("");
    try {
      const next = await apiPost<NotificationList>("/notifications/read-all", {});
      setPayload(next);
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleOpen(notification: AppNotification) {
    if (notification.read_at == null) {
      try {
        const next = await apiPost<NotificationList>("/notifications/read", { ids: [notification.id] });
        setPayload(next);
      } catch {
        // Best effort before navigation.
      }
    }
    window.location.href = notification.href || "/notifications";
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1>Notifications</h1>
          <p className="subtle">Replies, direct messages, and friend activity appear here.</p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={() => void markAllRead()} disabled={markingAll || !payload?.unread_count}>
            {markingAll ? "Saving..." : "Mark All Read"}
          </button>
        </div>
      </section>

      {error && <p className="error-box" role="alert">{error}</p>}

      {loading && !payload ? (
        <section className="table-panel" aria-busy="true">
          <div className="skeleton-stack">
            <div className="skeleton-line lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </section>
      ) : !payload || payload.items.length === 0 ? (
        <EmptyStatePanel
          kind="inbox"
          title="No notifications yet"
          description="New replies, messages, and friend activity will appear here."
          actionHref="/community"
          actionLabel="Open Community"
        />
      ) : (
        <section className="table-panel notification-list-panel">
          <p className="subtle">Unread: {payload.unread_count}</p>
          <div className="notification-list">
            {payload.items.map((notification) => (
              <button
                key={notification.id}
                type="button"
                className={`notification-row${notification.read_at ? "" : " unread"}`}
                onClick={() => void handleOpen(notification)}
              >
                <div>
                  <strong>{notification.message}</strong>
                  <p className="subtle">{notification.actor_username ?? "System"} | {formatStamp(notification.created_at)}</p>
                </div>
                <span className="subtle">{notification.read_at ? "Read" : "New"}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
