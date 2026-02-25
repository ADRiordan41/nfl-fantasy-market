"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
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

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      setError(toMessage(err));
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
            onClick={() => setMode("login")}
            disabled={busy}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "register" ? "auth-tab active" : "auth-tab"}
            onClick={() => setMode("register")}
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
          />

          <label className="field-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="at least 8 characters"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

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
