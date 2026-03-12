"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import EmptyStatePanel from "@/components/empty-state-panel";
import { apiGet, apiPost, clearAuthToken, isUnauthorizedError } from "@/lib/api";
import type { DirectMessage, DirectThreadDetail, DirectThreadSummary, UserAccount } from "@/lib/types";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
}

function avatarLetter(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized[0].toUpperCase() : "?";
}

function InboxPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedThreadId = useMemo(() => {
    const raw = searchParams.get("thread");
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [threads, setThreads] = useState<DirectThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<DirectThreadDetail | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [openingThread, setOpeningThread] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [error, setError] = useState("");
  const [newThreadUsername, setNewThreadUsername] = useState("");
  const [draftMessage, setDraftMessage] = useState("");

  const handleApiError = useCallback(
    (err: unknown) => {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    },
    [router],
  );

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const [me, nextThreads] = await Promise.all([
        apiGet<UserAccount>("/auth/me"),
        apiGet<DirectThreadSummary[]>("/inbox/threads?limit=200"),
      ]);
      setCurrentUser(me);
      setThreads(nextThreads);
      setError("");
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setLoadingInbox(false);
    }
  }, [handleApiError]);

  const loadThread = useCallback(
    async (threadId: number | null) => {
      if (!threadId) {
        setSelectedThread(null);
        setDraftMessage("");
        return;
      }
      setLoadingThread(true);
      try {
        const detail = await apiGet<DirectThreadDetail>(`/inbox/threads/${threadId}`);
        setSelectedThread(detail);
        setError("");
      } catch (err: unknown) {
        handleApiError(err);
      } finally {
        setLoadingThread(false);
      }
    },
    [handleApiError],
  );

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (loadingInbox) return;
    const nextSelected =
      requestedThreadId && threads.some((thread) => thread.id === requestedThreadId)
        ? requestedThreadId
        : threads[0]?.id ?? null;
    setSelectedThreadId((previous) => (previous === nextSelected ? previous : nextSelected));
  }, [loadingInbox, requestedThreadId, threads]);

  useEffect(() => {
    if (!selectedThreadId) {
      router.replace("/inbox");
      void loadThread(null);
      return;
    }
    router.replace(`/inbox?thread=${selectedThreadId}`);
    void loadThread(selectedThreadId);
  }, [loadThread, router, selectedThreadId]);

  async function handleOpenThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = newThreadUsername.trim();
    if (!username) {
      setError("Enter a username to open a direct thread.");
      return;
    }
    setOpeningThread(true);
    setError("");
    try {
      const opened = await apiPost<DirectThreadSummary>("/inbox/threads", { username });
      setNewThreadUsername("");
      await loadInbox();
      router.replace(`/inbox?thread=${opened.id}`);
      setSelectedThreadId(opened.id);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setOpeningThread(false);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedThreadId) return;
    const body = draftMessage.trim();
    if (!body) {
      setError("Enter a message before sending.");
      return;
    }
    setSendingMessage(true);
    setError("");
    try {
      const sent = await apiPost<DirectMessage>(`/inbox/threads/${selectedThreadId}/messages`, { body });
      setDraftMessage("");
      setSelectedThread((previous) =>
        previous
          ? {
              ...previous,
              last_message_at: sent.created_at,
              last_message_preview: sent.body,
              last_message_sender_username: sent.sender_username,
              message_count: previous.message_count + 1,
              unread_count: 0,
              messages: [...previous.messages, sent],
            }
          : previous,
      );
      await loadInbox();
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setSendingMessage(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1>Direct Messages</h1>
          <p className="subtle">Open threads, reply from the inbox, and keep private conversations in one place.</p>
        </div>
      </section>

      {error && <p className="error-box" role="alert">{error}</p>}

      {loadingInbox ? (
        <section className="table-panel" aria-busy="true">
          <div className="skeleton-stack">
            <div className="skeleton-line lg" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </section>
      ) : (
        <section className="inbox-layout">
          <aside className="table-panel inbox-sidebar">
            <div className="inbox-sidebar-head">
              <div>
                <h3>Threads</h3>
                <p className="subtle">
                  {currentUser ? `Signed in as ${currentUser.username}.` : "Loading account..."}
                </p>
              </div>
              <button type="button" onClick={() => void loadInbox()} disabled={loadingInbox}>
                Refresh
              </button>
            </div>

            <form className="inbox-compose-form" onSubmit={(event) => void handleOpenThread(event)}>
              <label className="field-label" htmlFor="inbox-username">
                Start or open a thread
              </label>
              <div className="inbox-compose-row">
                <input
                  id="inbox-username"
                  value={newThreadUsername}
                  onChange={(event) => setNewThreadUsername(event.target.value)}
                  placeholder="Username"
                  disabled={openingThread}
                />
                <button type="submit" className="primary-btn" disabled={openingThread}>
                  {openingThread ? "Opening..." : "Open"}
                </button>
              </div>
            </form>

            {!threads.length ? (
              <EmptyStatePanel
                kind="inbox"
                title="No conversations yet"
                description="Open a user profile or type a username above to start a direct thread."
                actionHref="/community"
                actionLabel="Go to Community"
              />
            ) : (
              <div className="inbox-thread-list">
                {threads.map((thread) => {
                  const active = thread.id === selectedThreadId;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      className={`inbox-thread-button${active ? " is-active" : ""}`}
                      onClick={() => setSelectedThreadId(thread.id)}
                    >
                      <div className="inbox-thread-topline">
                        <span className="inbox-thread-user">{thread.counterpart_username}</span>
                        <span className="inbox-thread-time">{formatTimestamp(thread.last_message_at)}</span>
                      </div>
                      <div className="inbox-thread-preview">
                        {thread.last_message_preview ?? "Thread opened. Send the first message."}
                      </div>
                      <div className="inbox-thread-meta">
                        <span>{thread.message_count} messages</span>
                        {thread.unread_count > 0 ? (
                          <span className="inbox-unread-badge">{thread.unread_count} new</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <section className="table-panel inbox-thread-panel">
            {!selectedThreadId ? (
              <EmptyStatePanel
                kind="inbox"
                title="Select a thread"
                description="Choose an existing conversation or open a new thread by username."
              />
            ) : loadingThread || !selectedThread ? (
              <div className="skeleton-stack" aria-busy="true">
                <div className="skeleton-line lg" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
              </div>
            ) : (
              <>
                <div className="inbox-thread-header">
                  <div className="inbox-thread-identity">
                    {selectedThread.counterpart_profile_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedThread.counterpart_profile_image_url}
                        alt={`${selectedThread.counterpart_username} avatar`}
                        className="inbox-thread-avatar"
                      />
                    ) : (
                      <div className="inbox-thread-avatar fallback">
                        {avatarLetter(selectedThread.counterpart_username)}
                      </div>
                    )}
                    <div>
                      <h3>{selectedThread.counterpart_username}</h3>
                      <p className="subtle">
                        Last activity {formatTimestamp(selectedThread.last_message_at || selectedThread.updated_at)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="inbox-message-list">
                  {!selectedThread.messages.length ? (
                    <div className="empty-panel compact">
                      <h3>No messages yet</h3>
                      <p className="subtle">Send the first message to start the conversation.</p>
                    </div>
                  ) : (
                    selectedThread.messages.map((message) => (
                      <article
                        key={message.id}
                        className={`inbox-message-row${message.own_message ? " own" : ""}`}
                      >
                        <div className={`inbox-message-bubble${message.own_message ? " own" : ""}`}>
                          <div className="inbox-message-meta">
                            <strong>{message.own_message ? "You" : message.sender_username}</strong>
                            <span>{formatTimestamp(message.created_at)}</span>
                          </div>
                          <p>{message.body}</p>
                        </div>
                      </article>
                    ))
                  )}
                </div>

                <form className="inbox-send-form" onSubmit={(event) => void handleSendMessage(event)}>
                  <label className="field-label" htmlFor="inbox-message">
                    Reply
                  </label>
                  <textarea
                    id="inbox-message"
                    className="settings-textarea inbox-textarea"
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    placeholder={`Message ${selectedThread.counterpart_username}`}
                    maxLength={5000}
                    disabled={sendingMessage}
                  />
                  <div className="inbox-send-actions">
                    <button type="submit" className="primary-btn" disabled={sendingMessage}>
                      {sendingMessage ? "Sending..." : "Send Message"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </section>
      )}
    </main>
  );
}

export default function InboxPage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <section className="hero-panel">
            <div>
              <p className="eyebrow">Inbox</p>
              <h1>Direct Messages</h1>
              <p className="subtle">Loading conversations.</p>
            </div>
          </section>
        </main>
      }
    >
      <InboxPageContent />
    </Suspense>
  );
}
