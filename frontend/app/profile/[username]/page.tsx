"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, clearAuthToken, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { DirectThreadSummary, FriendshipStatus, UserAccount, UserProfile } from "@/lib/types";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function initialLetter(value: string): string {
  const normalized = (value || "").trim();
  if (!normalized) return "?";
  return normalized[0].toUpperCase();
}

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const username = (params?.username || "").trim().toLowerCase();
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingThread, setOpeningThread] = useState(false);
  const [friendActionBusy, setFriendActionBusy] = useState(false);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const [me, nextProfile] = await Promise.all([
        apiGet<UserAccount>("/auth/me"),
        apiGet<UserProfile>(`/users/${encodeURIComponent(username)}/profile`),
      ]);
      setCurrentUser(me);
      setProfile(nextProfile);
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
  }, [router, username]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  const friendship = profile?.friendship;
  const isOwnProfile = useMemo(() => {
    if (!currentUser || !profile) return false;
    return currentUser.username.trim().toLowerCase() === profile.username.trim().toLowerCase();
  }, [currentUser, profile]);

  function applyFriendship(nextFriendship: FriendshipStatus) {
    setProfile((previous) => (previous ? { ...previous, friendship: nextFriendship } : previous));
  }

  async function sendFriendRequest() {
    if (!profile || isOwnProfile) return;
    setFriendActionBusy(true);
    setError("");
    try {
      const nextFriendship = await apiPost<FriendshipStatus>("/friends/requests", {
        username: profile.username,
      });
      applyFriendship(nextFriendship);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setFriendActionBusy(false);
    }
  }

  async function respondToFriendRequest(action: "accept" | "decline") {
    if (!profile?.friendship.friendship_id) return;
    setFriendActionBusy(true);
    setError("");
    try {
      const nextFriendship = await apiPost<FriendshipStatus>(
        `/friends/requests/${profile.friendship.friendship_id}/${action}`,
        {},
      );
      applyFriendship(nextFriendship);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setFriendActionBusy(false);
    }
  }

  async function openThread() {
    if (!profile || isOwnProfile || !profile.friendship.can_message) return;
    setOpeningThread(true);
    setError("");
    try {
      const thread = await apiPost<DirectThreadSummary>("/inbox/threads", {
        username: profile.username,
      });
      router.push(`/inbox?thread=${thread.id}`);
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setOpeningThread(false);
    }
  }

  if (!username) {
    return (
      <main className="page-shell">
        <section className="empty-panel">
          <h2>Invalid username</h2>
          <p className="subtle">This profile route is invalid.</p>
          <Link href="/community" className="ghost-link">
            Back to Community
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero-panel profile-hero">
        <div className="profile-avatar-wrap">
          {profile?.profile_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.profile_image_url} alt={`${profile.username} profile`} className="profile-avatar-img" />
          ) : (
            <div className="profile-avatar-fallback">{initialLetter(profile?.username ?? username)}</div>
          )}
        </div>
        <div>
          <p className="eyebrow">User Profile</p>
          <h1>{profile?.username ?? username}</h1>
          <p className="subtle profile-bio-text">{profile?.bio || "This user has not added a bio yet."}</p>
        </div>
        <div className="hero-actions">
          <Link href="/community" className="ghost-link">
            Back to Community
          </Link>
          {!isOwnProfile && friendship?.status === "NONE" ? (
            <button type="button" className="primary-btn" onClick={() => void sendFriendRequest()} disabled={friendActionBusy}>
              {friendActionBusy ? "Sending..." : "Add Friend"}
            </button>
          ) : null}
          {!isOwnProfile && friendship?.status === "PENDING_INCOMING" ? (
            <>
              <button type="button" className="primary-btn" onClick={() => void respondToFriendRequest("accept")} disabled={friendActionBusy}>
                {friendActionBusy ? "Saving..." : "Accept Request"}
              </button>
              <button type="button" className="ghost-link" onClick={() => void respondToFriendRequest("decline")} disabled={friendActionBusy}>
                Decline
              </button>
            </>
          ) : null}
          {!isOwnProfile && friendship?.can_message ? (
            <button type="button" className="primary-btn" onClick={() => void openThread()} disabled={openingThread}>
              {openingThread ? "Opening..." : "Message User"}
            </button>
          ) : null}
          {!isOwnProfile && friendship?.status === "PENDING_OUTGOING" ? (
            <span className="chip muted-chip">Friend Request Sent</span>
          ) : null}
          {!isOwnProfile && friendship?.status === "FRIENDS" ? (
            <span className="chip">Friends</span>
          ) : null}
          <button type="button" onClick={() => void loadProfile()} disabled={loading}>
            Refresh
          </button>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      {!profile ? (
        <section className="empty-panel">
          <h3>{loading ? "Loading profile..." : "Profile not found"}</h3>
        </section>
      ) : (
        <>
          <section className="metrics-grid">
            <article className="kpi-card">
              <span>Cash</span>
              <strong>{formatCurrency(profile.cash_balance)}</strong>
            </article>
            <article className="kpi-card">
              <span>Holdings</span>
              <strong>{formatCurrency(profile.holdings_value)}</strong>
            </article>
            <article className="kpi-card">
              <span>Equity</span>
              <strong>{formatCurrency(profile.equity)}</strong>
            </article>
            <article className="kpi-card">
              <span>Return</span>
              <strong className={profile.return_pct >= 0 ? "up" : "down"}>{formatNumber(profile.return_pct, 2)}%</strong>
            </article>
            <article className="kpi-card">
              <span>Leaderboard</span>
              <strong>{profile.leaderboard_rank ? `#${formatNumber(profile.leaderboard_rank, 0)}` : "--"}</strong>
            </article>
          </section>

          <section className="table-panel">
            <h3>Holdings</h3>
            {profile.holdings.length === 0 ? (
              <p className="subtle">No open holdings.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Sport</th>
                      <th>Team</th>
                      <th>Pos</th>
                      <th>Shares</th>
                      <th>Current Price</th>
                      <th>Market Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.holdings.map((holding) => (
                      <tr key={holding.player_id}>
                        <td>
                          <Link href={`/player/${holding.player_id}`} className="card-title">
                            {holding.player_name}
                          </Link>
                        </td>
                        <td>{holding.sport}</td>
                        <td>{holding.team}</td>
                        <td>{holding.position}</td>
                        <td>{formatNumber(holding.shares_owned, 0)}</td>
                        <td>{formatCurrency(holding.spot_price)}</td>
                        <td>{formatCurrency(holding.market_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
