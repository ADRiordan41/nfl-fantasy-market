"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, clearAuthToken, isUnauthorizedError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { ForumComment, ForumPostDetail } from "@/lib/types";

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

export default function CommunityPostPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const postId = Number(params?.id);
  const validId = Number.isFinite(postId) && postId > 0;

  const [post, setPost] = useState<ForumPostDetail | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const [error, setError] = useState("");

  const loadPost = useCallback(async () => {
    if (!validId) return;
    setLoading(true);
    try {
      const nextPost = await apiGet<ForumPostDetail>(`/forum/posts/${postId}`);
      setPost(nextPost);
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
  }, [postId, router, validId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPost();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPost]);

  async function postComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validId) return;

    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setError("Comment text is required.");
      return;
    }

    setCommenting(true);
    setError("");
    try {
      const created = await apiPost<ForumComment>(`/forum/posts/${postId}/comments`, {
        body: trimmedBody,
      });
      setPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          updated_at: created.created_at,
          comment_count: prev.comment_count + 1,
          comments: [...prev.comments, created],
        };
      });
      setBody("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setCommenting(false);
    }
  }

  if (!validId) {
    return (
      <main className="page-shell">
        <section className="empty-panel">
          <h2>Invalid post id</h2>
          <p className="subtle">The selected post route is not valid.</p>
          <Link href="/community" className="ghost-link">
            Back to Community
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Community</p>
          <h1>{post ? post.title : "Loading post..."}</h1>
          <p className="subtle">
            {post
              ? "By "
              : "Fetching latest discussion..."}
            {post ? (
              <>
                <Link href={`/profile/${post.author_username}`} className="community-user-link">
                  {post.author_username}
                </Link>{" "}
                | Last activity {formatStamp(post.updated_at)}
              </>
            ) : null}
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/community" className="ghost-link">
            Back to Forum
          </Link>
          <button type="button" onClick={() => void loadPost()} disabled={loading}>
            Refresh
          </button>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      {post && (
        <>
          <section className="metrics-grid">
            <article className="kpi-card">
              <span>Author</span>
              <strong>
                <Link href={`/profile/${post.author_username}`} className="community-user-link">
                  {post.author_username}
                </Link>
              </strong>
            </article>
            <article className="kpi-card">
              <span>Comments</span>
              <strong>{formatNumber(post.comment_count)}</strong>
            </article>
            <article className="kpi-card">
              <span>Views</span>
              <strong>{formatNumber(post.view_count)}</strong>
            </article>
            <article className="kpi-card">
              <span>Created</span>
              <strong>{formatStamp(post.created_at)}</strong>
            </article>
          </section>

          <section className="table-panel community-post-detail">
            <h3>{post.title}</h3>
            <p className="community-post-body">{post.body}</p>
          </section>

          <section className="table-panel community-compose">
            <h3>Add Comment</h3>
            <form className="community-form" onSubmit={(event) => void postComment(event)}>
              <label className="field-label" htmlFor="comment-body">
                Comment
              </label>
              <textarea
                id="comment-body"
                className="community-textarea"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Share your take..."
                maxLength={5000}
                disabled={commenting}
              />
              <div className="community-actions">
                <button type="submit" className="primary-btn" disabled={commenting}>
                  {commenting ? "Posting..." : "Post Comment"}
                </button>
              </div>
            </form>
          </section>

          <section className="community-feed">
            {post.comments.length === 0 ? (
              <section className="empty-panel">
                <h3>No comments yet</h3>
                <p className="subtle">Start the thread with the first reply.</p>
              </section>
            ) : (
              post.comments.map((comment) => (
                <article className="community-comment-card" key={comment.id}>
                  <p className="community-meta">
                    <Link href={`/profile/${comment.author_username}`} className="community-user-link">
                      {comment.author_username}
                    </Link>{" "}
                    | {formatStamp(comment.created_at)}
                  </p>
                  <p className="community-comment-body">{comment.body}</p>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
