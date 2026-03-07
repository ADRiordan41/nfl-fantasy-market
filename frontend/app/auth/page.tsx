"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import {
  ApiHttpError,
  apiGet,
  apiPost,
  clearAuthToken,
  getAuthToken,
  isUnauthorizedError,
  setAuthToken,
} from "@/lib/api";
import type { AuthSession, UserAccount } from "@/lib/types";

type AuthMode = "login" | "register" | "reset-request" | "reset-confirm";

type PasswordResetRequestResponse = {
  ok: boolean;
  expires_at: string | null;
  preview_token: string | null;
  preview_url: string | null;
};

type PasswordResetConfirmResponse = {
  ok: boolean;
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function authErrorMessage(err: unknown, mode: AuthMode): string {
  if (err instanceof ApiHttpError) {
    if (mode === "login") {
      if (err.status === 401) return "Invalid username/email or password.";
      if (err.status === 404) return "Sign-in endpoint not found. Check frontend API base URL config.";
    }
    if (mode === "register") {
      if (err.status === 409) return "That username or email is already in use.";
      if (err.status === 400) return "Unable to complete registration. Please try again.";
    }
    if (mode === "reset-request") {
      if (err.status === 400) return "Enter a valid account email.";
      if (err.status === 429) return "Too many reset attempts. Please wait and try again.";
    }
    if (mode === "reset-confirm") {
      if (err.status === 400) return "That reset token is invalid or expired.";
      if (err.status === 429) return "Too many attempts. Please wait and try again.";
    }
    if (err.status === 422) {
      return mode === "register"
        ? "Invalid registration input. Use a valid username, email, and a password with at least 8 characters."
        : mode === "reset-confirm"
          ? "Invalid reset input. Use a valid reset token and a password with at least 8 characters."
          : "Invalid input.";
    }
    if (err.status >= 500) return "Server error. Please try again.";
  }
  const message = toMessage(err);
  if (/Failed to fetch/i.test(message)) {
    return "Unable to reach the backend service. Verify deployment and NEXT_PUBLIC_API_BASE_URL.";
  }
  return message;
}

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registerStartedAtMs, setRegisterStartedAtMs] = useState(() => Date.now());
  const [contactEmail, setContactEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [previewResetUrl, setPreviewResetUrl] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const resetTokenFromUrl = useMemo(() => searchParams.get("reset_token")?.trim() || "", [searchParams]);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setChecking(false);
      return;
    }

    void (async () => {
      try {
        await apiGet<UserAccount>("/auth/me");
        router.replace("/");
      } catch (err: unknown) {
        if (isUnauthorizedError(err)) {
          clearAuthToken();
        }
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (resetTokenFromUrl) {
      setMode("reset-confirm");
      setResetToken(resetTokenFromUrl);
      setError("");
      setSuccess("Enter a new password to finish resetting your account.");
    }
  }, [resetTokenFromUrl]);

  useEffect(() => {
    if (mode !== "register") return;
    setRegisterStartedAtMs(Date.now());
    setContactEmail("");
  }, [mode]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setSuccess("");
    setPreviewResetUrl(null);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (!normalizedIdentifier) {
      setError(mode === "login" ? "Username or email is required." : "Username is required.");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (mode === "register" && !normalizedEmail) {
      setError("Email is required.");
      return;
    }
    if (!password.trim()) {
      setError("Password is required.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Password must be at least 8 characters for registration.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const session = await apiPost<AuthSession>(
        mode === "register" ? "/auth/register" : "/auth/login",
        mode === "register"
          ? {
              contact_email: contactEmail,
              email: normalizedEmail,
              form_started_at_ms: registerStartedAtMs,
              username: normalizedIdentifier,
              password,
            }
          : {
              username: normalizedIdentifier,
              password,
            },
      );
      setAuthToken(session.access_token);
      router.replace("/");
    } catch (err: unknown) {
      setError(authErrorMessage(err, mode));
    } finally {
      setBusy(false);
    }
  }

  async function submitResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = resetEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");
    setPreviewResetUrl(null);
    try {
      const response = await apiPost<PasswordResetRequestResponse>("/auth/password-reset/request", {
        email: normalizedEmail,
      });
      setSuccess(
        response.preview_url
          ? "Reset token created. Use the preview link below to complete the flow while email delivery is not configured."
          : "If an account exists for that email, reset instructions will be sent when email delivery is configured.",
      );
      setPreviewResetUrl(response.preview_url || null);
      if (response.preview_token) {
        setResetToken(response.preview_token);
        setMode("reset-confirm");
      }
    } catch (err: unknown) {
      setError(authErrorMessage(err, "reset-request"));
    } finally {
      setBusy(false);
    }
  }

  async function submitResetConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedToken = resetToken.trim();
    if (!normalizedToken) {
      setError("Reset token is required.");
      return;
    }
    if (resetPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setError("New password and confirmation must match.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await apiPost<PasswordResetConfirmResponse>("/auth/password-reset/confirm", {
        token: normalizedToken,
        new_password: resetPassword,
      });
      setResetPassword("");
      setResetPasswordConfirm("");
      setPreviewResetUrl(null);
      setSuccess("Password reset complete. You can sign in with your new password now.");
      setMode("login");
    } catch (err: unknown) {
      setError(authErrorMessage(err, "reset-confirm"));
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="page-shell auth-page">
        <section className="empty-panel auth-card">
          <h2>Checking session...</h2>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell auth-page">
      <section className="auth-card">
        <p className="eyebrow">Account</p>
        <h1>
          {mode === "login"
            ? "Sign In"
            : mode === "register"
              ? "Create Account"
              : mode === "reset-request"
                ? "Reset Password"
                : "Choose a New Password"}
        </h1>
        <p className="subtle">
          {mode === "login"
            ? "Access your portfolio and continue trading with your username or email."
            : mode === "register"
              ? "Create a new account with its own isolated portfolio and recovery email."
              : mode === "reset-request"
                ? "Enter your account email and we will prepare a reset link."
                : "Paste your reset token or open the emailed link, then choose a new password."}
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "auth-tab active" : "auth-tab"}
            onClick={() => switchMode("login")}
            disabled={busy}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "register" ? "auth-tab active" : "auth-tab"}
            onClick={() => switchMode("register")}
            disabled={busy}
          >
            Register
          </button>
        </div>

        {(mode === "login" || mode === "register") && (
          <form className="auth-form" onSubmit={submitAuth}>
            {mode === "register" && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "-9999px",
                  width: "1px",
                  height: "1px",
                  overflow: "hidden",
                }}
              >
                <label htmlFor="auth-contact-email">Contact email</label>
                <input
                  id="auth-contact-email"
                  tabIndex={-1}
                  autoComplete="off"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  disabled={busy}
                />
              </div>
            )}

            <label className="field-label" htmlFor="auth-identifier">
              {mode === "login" ? "Username or Email" : "Username"}
            </label>
            <input
              id="auth-identifier"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={mode === "login" ? "username or email" : "lowercase username"}
              autoComplete="username"
              autoFocus
              disabled={busy}
            />

            {mode === "register" && (
              <>
                <label className="field-label" htmlFor="auth-email">
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={busy}
                />
              </>
            )}

            <label className="field-label" htmlFor="auth-password">
              Password
            </label>
            <div className="password-input-wrap">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="at least 8 characters"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                disabled={busy}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((value) => !value)}
                disabled={busy}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {mode === "register" && (
              <p className="subtle">New accounts start with $100,000.00 in cash and use email for future recovery.</p>
            )}

            {mode === "login" && (
              <div className="settings-actions">
                <button type="button" className="ghost-link" onClick={() => switchMode("reset-request")} disabled={busy}>
                  Forgot password?
                </button>
              </div>
            )}

            {error && <p className="error-box">{error}</p>}
            {success && <p className="success-box">{success}</p>}

            <button type="submit" className="primary-btn full" disabled={busy}>
              {busy ? "Submitting..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
        )}

        {mode === "reset-request" && (
          <form className="auth-form" onSubmit={submitResetRequest}>
            <label className="field-label" htmlFor="reset-email">
              Account Email
            </label>
            <input
              id="reset-email"
              type="email"
              value={resetEmail}
              onChange={(event) => setResetEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              disabled={busy}
            />

            {error && <p className="error-box">{error}</p>}
            {success && <p className="success-box">{success}</p>}
            {previewResetUrl && (
              <p className="subtle">
                Preview reset link: <Link href={previewResetUrl}>{previewResetUrl}</Link>
              </p>
            )}

            <button type="submit" className="primary-btn full" disabled={busy}>
              {busy ? "Preparing..." : "Send Reset Link"}
            </button>
            <button type="button" className="ghost-link full" onClick={() => switchMode("login")} disabled={busy}>
              Back to Sign In
            </button>
          </form>
        )}

        {mode === "reset-confirm" && (
          <form className="auth-form" onSubmit={submitResetConfirm}>
            <label className="field-label" htmlFor="reset-token">
              Reset Token
            </label>
            <input
              id="reset-token"
              value={resetToken}
              onChange={(event) => setResetToken(event.target.value)}
              placeholder="paste reset token"
              autoFocus={!resetTokenFromUrl}
              disabled={busy}
            />

            <label className="field-label" htmlFor="reset-new-password">
              New Password
            </label>
            <input
              id="reset-new-password"
              type={showPassword ? "text" : "password"}
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              placeholder="at least 8 characters"
              autoComplete="new-password"
              disabled={busy}
            />

            <label className="field-label" htmlFor="reset-confirm-password">
              Confirm New Password
            </label>
            <input
              id="reset-confirm-password"
              type={showPassword ? "text" : "password"}
              value={resetPasswordConfirm}
              onChange={(event) => setResetPasswordConfirm(event.target.value)}
              placeholder="repeat new password"
              autoComplete="new-password"
              disabled={busy}
            />

            <button
              type="button"
              className="password-toggle-btn"
              onClick={() => setShowPassword((value) => !value)}
              disabled={busy}
            >
              {showPassword ? "Hide Passwords" : "Show Passwords"}
            </button>

            {error && <p className="error-box">{error}</p>}
            {success && <p className="success-box">{success}</p>}

            <button type="submit" className="primary-btn full" disabled={busy}>
              {busy ? "Updating..." : "Reset Password"}
            </button>
            <button type="button" className="ghost-link full" onClick={() => switchMode("login")} disabled={busy}>
              Back to Sign In
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell auth-page">
          <section className="auth-card">
            <p className="eyebrow">Account</p>
            <h1>Loading Account</h1>
            <p className="subtle">Preparing sign-in and password reset tools.</p>
          </section>
        </main>
      }
    >
      <AuthPageContent />
    </Suspense>
  );
}
