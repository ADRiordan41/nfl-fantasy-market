"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
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

type AuthMode = "login" | "register";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function authErrorMessage(err: unknown, mode: AuthMode): string {
  if (err instanceof ApiHttpError) {
    if (err.status === 401) return "Invalid username or password.";
    if (err.status === 404) return "Sign-in endpoint not found. Check frontend API base URL config.";
    if (err.status === 409) return "That username is already in use.";
    if (err.status === 422) {
      return mode === "register"
        ? "Invalid registration input. Use a valid username and a password with at least 8 characters."
        : "Invalid sign-in input.";
    }
    if (err.status >= 500) return "Server error. Please try again.";
  }
  const message = toMessage(err);
  if (/Failed to fetch/i.test(message)) {
    return "Unable to reach the backend service. Verify deployment and NEXT_PUBLIC_API_BASE_URL.";
  }
  return message;
}

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      setError("Username is required.");
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
    try {
      const session = await apiPost<AuthSession>(
        mode === "register" ? "/auth/register" : "/auth/login",
        mode === "register"
          ? {
              username: normalizedUsername,
              password,
            }
          : {
              username: normalizedUsername,
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
        <h1>{mode === "login" ? "Sign In" : "Create Account"}</h1>
        <p className="subtle">
          {mode === "login"
            ? "Access your portfolio and continue trading."
            : "Create a new account with its own isolated portfolio."}
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "auth-tab active" : "auth-tab"}
            onClick={() => {
              setMode("login");
              setError("");
            }}
            disabled={busy}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "register" ? "auth-tab active" : "auth-tab"}
            onClick={() => {
              setMode("register");
              setError("");
            }}
            disabled={busy}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="field-label" htmlFor="auth-username">
            Username
          </label>
          <input
            id="auth-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="lowercase username"
            autoComplete="username"
            autoFocus
            disabled={busy}
          />

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
            <p className="subtle">New accounts start with $100,000.00 in cash.</p>
          )}

          {error && <p className="error-box">{error}</p>}

          <button type="submit" className="primary-btn full" disabled={busy}>
            {busy ? "Submitting..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </section>
    </main>
  );
}
