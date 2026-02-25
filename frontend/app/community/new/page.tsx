"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiPost, clearAuthToken, isUnauthorizedError } from "@/lib/api";
import type { ForumPostSummary } from "@/lib/types";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function CommunityNewPostPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function createPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!trimmedBody) {
      setError("Post body is required.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiPost<ForumPostSummary>("/forum/posts", {
        title: trimmedTitle,
        body: trimmedBody,
      });
      router.push(`/community/${created.id}`);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <h1>New Forum Post</h1>
          <p className="subtle">Create a new discussion thread for the community.</p>
        </div>
        <div className="hero-actions">
          <Link href="/community" className="ghost-link">
            Back to Forum
          </Link>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      <section className="table-panel community-compose">
        <h3>Start a New Post</h3>
        <form className="community-form" onSubmit={(event) => void createPost(event)}>
          <label className="field-label" htmlFor="post-title">
            Title
          </label>
          <input
            id="post-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What do you want to discuss?"
            maxLength={160}
            disabled={submitting}
          />

          <label className="field-label" htmlFor="post-body">
            Post
          </label>
          <textarea
            id="post-body"
            className="community-textarea"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write your post..."
            maxLength={10000}
            disabled={submitting}
          />

          <div className="community-actions">
            <button type="submit" className="primary-btn" disabled={submitting}>
              {submitting ? "Posting..." : "Publish Post"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
