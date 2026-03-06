"use client";

import Link from "next/link";

type EmptyStateKind = "market" | "portfolio" | "live" | "community" | "inbox" | "comments";

type EmptyStatePanelProps = {
  kind: EmptyStateKind;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};

function EmptyStateIcon({ kind }: { kind: EmptyStateKind }) {
  if (kind === "market") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="empty-state-icon">
        <path d="M4 20V10" />
        <path d="M9 20V6" />
        <path d="M14 20v-4" />
        <path d="M19 20V8" />
        <path d="M3.5 14.5L8.5 11l4 2 7-6" />
      </svg>
    );
  }
  if (kind === "portfolio") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="empty-state-icon">
        <path d="M12 3v9h9" />
        <path d="M12 3a9 9 0 1 0 9 9" />
        <path d="M12 12 5.8 18.2" />
      </svg>
    );
  }
  if (kind === "live") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="empty-state-icon">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
        <path d="M7 16.5h2.6" />
        <path d="M7 12.8h4.2" />
        <path d="m15.3 13.2 1.2 1.4 2-2.5" />
        <circle cx="16.8" cy="10" r="2.8" />
      </svg>
    );
  }
  if (kind === "inbox") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="empty-state-icon">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.4" />
        <path d="m4.5 7.5 7.5 6 7.5-6" />
        <path d="M9.5 12.6 4.8 17.4" />
        <path d="m19.2 17.4-4.7-4.8" />
      </svg>
    );
  }
  if (kind === "comments") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="empty-state-icon">
        <path d="M5 6.5h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-6l-3.6 3V17H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
        <path d="M8 10h8" />
        <path d="M8 13h5.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="empty-state-icon">
      <path d="M5 6.5h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-6l-3.6 3V17H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
      <path d="M8 10h8" />
      <path d="M8 13h5.5" />
    </svg>
  );
}

export default function EmptyStatePanel({
  kind,
  title,
  description,
  actionHref,
  actionLabel,
}: EmptyStatePanelProps) {
  return (
    <section className="empty-panel polished-empty">
      <div className="empty-state-head">
        <span className="empty-state-icon-wrap">
          <EmptyStateIcon kind={kind} />
        </span>
        <h3>{title}</h3>
      </div>
      <p className="subtle">{description}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="ghost-link">
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}
