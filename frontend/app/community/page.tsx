"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, clearAuthToken, isUnauthorizedError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { ForumPostSummary } from "@/lib/types";

type SortMode = "new" | "popular";
type PopularWindow = "hour" | "day" | "week";

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

export default function CommunityPage() {
  const router = useRouter();
  const popularWindowMenuRef = useRef<HTMLDivElement | null>(null);
  const [posts, setPosts] = useState<ForumPostSummary[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("new");
  const [popularWindow, setPopularWindow] = useState<PopularWindow>("day");
  const [popularMenuOpen, setPopularMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint =
        sortMode === "popular"
          ? `/forum/posts?limit=100&sort=popular&popular_window=${popularWindow}`
          : "/forum/posts?limit=100&sort=new";
      const feed = await apiGet<ForumPostSummary[]>(endpoint);
      setPosts(feed);
      setError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [popularWindow, router, sortMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPosts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPosts]);

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      if (!popularWindowMenuRef.current) return;
      if (popularWindowMenuRef.current.contains(event.target as Node)) return;
      setPopularMenuOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, []);

  function setSort(nextMode: SortMode) {
    if (nextMode === "new") {
      setSortMode("new");
      setPopularMenuOpen(false);
      return;
    }
    if (sortMode === "popular") {
      setPopularMenuOpen((prev) => !prev);
      return;
    }
    setSortMode("popular");
    setPopularMenuOpen(true);
  }

  function choosePopularWindow(nextWindow: PopularWindow) {
    setPopularWindow(nextWindow);
    setPopularMenuOpen(false);
  }

  return (
    <main className="page-shell">
      <section className="hero-panel community-hero">
        <div>
          <p className="eyebrow">Community</p>
          <h1>Forum</h1>
          <p className="subtle">Share ideas, discuss player moves, and debate market trends.</p>
        </div>
        <div className="community-hero-controls">
          <Link href="/community/new" className="primary-btn ghost-link community-create-btn">
            Create a New Post
          </Link>
          <div className="table-panel community-sort-panel">
            <div className="community-sort-stack">
              <div className="community-sort-toggle">
                <button
                  type="button"
                  className={sortMode === "new" ? "segment active" : "segment"}
                  onClick={() => setSort("new")}
                >
                  New
                </button>
                <button
                  type="button"
                  className={sortMode === "popular" ? "segment active" : "segment"}
                  onClick={() => setSort("popular")}
                >
                  Popular
                </button>
              </div>
              {sortMode === "popular" && popularMenuOpen && (
                <div className="community-window-menu" role="menu" aria-label="Popular window" ref={popularWindowMenuRef}>
                  <button type="button" className="community-window-option" onClick={() => choosePopularWindow("hour")}>
                    Last Hour
                  </button>
                  <button type="button" className="community-window-option" onClick={() => choosePopularWindow("day")}>
                    Last Day
                  </button>
                  <button type="button" className="community-window-option" onClick={() => choosePopularWindow("week")}>
                    Last Week
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      <section className="community-feed">
        {loading ? (
          <section className="empty-panel">
            <h3>Loading posts...</h3>
          </section>
        ) : posts.length === 0 ? (
          <section className="empty-panel">
            <h3>No posts yet</h3>
            <p className="subtle">Be the first to start the conversation.</p>
          </section>
        ) : (
          posts.map((post) => (
            <article className="community-post-card" key={post.id}>
              <Link href={`/community/${post.id}`} className="community-post-title">
                {post.title}
              </Link>
              <p className="community-post-preview">{post.body_preview}</p>
              <p className="community-meta">
                By{" "}
                <Link href={`/profile/${post.author_username}`} className="community-user-link">
                  {post.author_username}
                </Link>{" "}
                | {formatStamp(post.updated_at)} | {formatNumber(post.view_count)} views |{" "}
                {formatNumber(post.comment_count)} comments
              </p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
