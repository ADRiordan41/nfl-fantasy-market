"use client";

import Link from "next/link";
import { formatNumber } from "@/lib/format";
import type { ForumPostSummary } from "@/lib/types";

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

type CommunityPostsPanelProps = {
  posts: ForumPostSummary[];
  emptyMessage: string;
};

export default function CommunityPostsPanel({ posts, emptyMessage }: CommunityPostsPanelProps) {
  return (
    <section className="table-panel" data-parity-section="community-posts">
      <div className="portfolio-sport-group-head">
        <h3>Community Posts</h3>
        <p className="subtle portfolio-sport-summary">
          {posts.length ? `${formatNumber(posts.length)} recent posts` : "No posts yet."}
        </p>
      </div>
      {posts.length ? (
        <section className="community-feed">
          {posts.map((post) => (
            <article className="community-post-card" key={post.id}>
              <Link href={`/community/${post.id}`} className="community-post-title">
                {post.title}
              </Link>
              <p className="community-post-preview">{post.body_preview}</p>
              <div className="community-card-footer">
                <p className="community-meta">
                  By{" "}
                  <Link href={`/profile/${post.author_username}`} className="community-user-link">
                    {post.author_username}
                  </Link>{" "}
                  | {formatStamp(post.updated_at)} | {formatNumber(post.view_count)} views |{" "}
                  {formatNumber(post.comment_count)} comments
                </p>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <p className="subtle">{emptyMessage}</p>
      )}
    </section>
  );
}
