"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPatch, apiPost, clearAuthToken, isUnauthorizedError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { UserAccount, UserProfile } from "@/lib/types";

type AuthPasswordUpdateResponse = {
  ok: boolean;
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function SettingsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [bio, setBio] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const loadCurrentUser = useCallback(async () => {
    setLoading(true);
    try {
      const [me, profile] = await Promise.all([
        apiGet<UserAccount>("/auth/me"),
        apiGet<UserProfile>("/users/me/profile"),
      ]);
      setCurrentUser(me);
      setCurrentProfile(profile);
      setProfileImageUrl(profile.profile_image_url ?? "");
      setBio(profile.bio ?? "");
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
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCurrentUser();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCurrentUser]);

  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      await apiPost("/auth/logout", {});
    } catch (err: unknown) {
      if (!isUnauthorizedError(err)) {
        setError(toMessage(err));
      }
    } finally {
      clearAuthToken();
      router.replace("/auth");
    }
  }

  async function handleProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (profileImageUrl.length > 512) {
      setError("Profile image URL must be 512 characters or fewer.");
      return;
    }
    if (bio.length > 1000) {
      setError("Bio must be 1,000 characters or fewer.");
      return;
    }

    setSavingProfile(true);
    try {
      const updated = await apiPatch<UserProfile>("/users/me/profile", {
        profile_image_url: profileImageUrl.trim() || null,
        bio: bio.trim() || null,
      });
      setCurrentProfile(updated);
      setProfileImageUrl(updated.profile_image_url ?? "");
      setBio(updated.bio ?? "");
      setSuccess("Profile updated.");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!currentPassword.trim()) {
      setError("Current password is required.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation must match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("New password must be different from current password.");
      return;
    }

    setSavingPassword(true);
    try {
      await apiPost<AuthPasswordUpdateResponse>("/auth/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password updated.");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Account</p>
          <h1>User Settings</h1>
          <p className="subtle">Manage your account profile, password, and session access.</p>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}
      {success && <p className="success-box">{success}</p>}

      {currentUser ? (
        <>
          <section className="metrics-grid">
            <article className="kpi-card">
              <span>Username</span>
              <strong>{currentUser.username}</strong>
            </article>
            <article className="kpi-card">
              <span>User ID</span>
              <strong>{currentUser.id}</strong>
            </article>
            <article className="kpi-card">
              <span>Cash Balance</span>
              <strong>{formatCurrency(currentProfile?.cash_balance ?? currentUser.cash_balance)}</strong>
            </article>
          </section>

          <section className="table-panel settings-panel">
            <h3>Profile</h3>
            <p className="subtle">Set your profile image and bio for community posts and profile pages.</p>
            <form className="settings-form" onSubmit={(event) => void handleProfileUpdate(event)}>
              <label className="field-label" htmlFor="profile-image-url">
                Profile image URL
              </label>
              <input
                id="profile-image-url"
                type="url"
                value={profileImageUrl}
                onChange={(event) => setProfileImageUrl(event.target.value)}
                placeholder="https://example.com/avatar.jpg"
                disabled={savingProfile}
              />

              <label className="field-label" htmlFor="profile-bio">
                Short bio
              </label>
              <textarea
                id="profile-bio"
                className="settings-textarea"
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                placeholder="Tell the community about your strategy."
                maxLength={1000}
                disabled={savingProfile}
              />

              <div className="settings-actions">
                <button type="submit" className="primary-btn" disabled={savingProfile}>
                  {savingProfile ? "Saving..." : "Update Profile"}
                </button>
                <Link href={`/profile/${currentUser.username}`} className="ghost-link">
                  View Public Profile
                </Link>
              </div>
            </form>
          </section>

          <section className="table-panel settings-panel">
            <h3>Security</h3>
            <p className="subtle">Change your account password.</p>
            <form className="settings-form" onSubmit={(event) => void handlePasswordUpdate(event)}>
              <label className="field-label" htmlFor="current-password">
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={savingPassword}
              />

              <label className="field-label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={savingPassword}
              />

              <label className="field-label" htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={savingPassword}
              />

              <div className="settings-actions">
                <button type="submit" className="primary-btn" disabled={savingPassword}>
                  {savingPassword ? "Saving..." : "Update Password"}
                </button>
              </div>
            </form>
          </section>

          <section className="table-panel settings-panel">
            <h3>Session</h3>
            <p className="subtle">Sign out from this device.</p>
            <div className="settings-actions">
              <button type="button" className="danger-btn" onClick={() => void logout()} disabled={loggingOut}>
                {loggingOut ? "Signing out..." : "Log out"}
              </button>
            </div>
          </section>
        </>
      ) : (
        <p className="subtle">{loading ? "Loading account..." : "Unable to load account."}</p>
      )}
    </main>
  );
}
