const LOCAL_API_BASE = "http://localhost:8000";
const RENDER_API_BASE = "https://matchupmarket.onrender.com";

function inferHostedApiBase(): string {
  if (typeof window === "undefined") return "";
  const hostname = window.location.hostname.trim().toLowerCase();
  if (!hostname) return "";
  if (hostname === "matchupmarket-frontend.onrender.com") return RENDER_API_BASE;
  if (hostname === "www.matchupmarket.com" || hostname === "matchupmarket.com") return RENDER_API_BASE;
  return "";
}

function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return inferHostedApiBase() || LOCAL_API_BASE;
}

const API_BASE = resolveApiBase();
export const AUTH_TOKEN_STORAGE_KEY = "fsm_access_token";
const AUTH_TOKEN_CHANGED_EVENT = "fsm-auth-token-changed";

export function getAuthTokenChangedEventName(): string {
  return AUTH_TOKEN_CHANGED_EVENT;
}

function emitAuthTokenChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_TOKEN_CHANGED_EVENT));
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly responseText: string;

  constructor(message: string, status: number, responseText: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.responseText = responseText;
  }
}

function responseMessage(method: string, path: string, statusCode: number, responseText: string): string {
  if (!responseText) return `${method} ${path} failed: ${statusCode}`;
  try {
    const parsed = JSON.parse(responseText) as { detail?: string };
    if (parsed.detail) return `${method} ${path} failed: ${statusCode} ${parsed.detail}`;
  } catch {
    // Fallback to raw response body.
  }
  return `${method} ${path} failed: ${statusCode} ${responseText}`;
}

function authHeaders(base: HeadersInit = {}): HeadersInit {
  const token = getAuthToken();
  if (!token) return base;
  return {
    ...base,
    Authorization: `Bearer ${token}`,
  };
}

export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() || "";
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  const trimmed = token.trim();
  if (!trimmed) return;
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, trimmed);
  emitAuthTokenChanged();
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  emitAuthTokenChanged();
}

export function isUnauthorizedError(err: unknown): err is ApiHttpError {
  return err instanceof ApiHttpError && err.status === 401;
}

export function friendlyApiError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!(err instanceof ApiHttpError)) {
    return err instanceof Error && err.message ? err.message : fallback;
  }

  let detail = "";
  try {
    const parsed = JSON.parse(err.responseText) as { detail?: unknown };
    if (typeof parsed.detail === "string") detail = parsed.detail;
    if (Array.isArray(parsed.detail)) detail = parsed.detail.map((item) => String(item?.msg ?? item)).join(" ");
  } catch {
    detail = "";
  }

  const message = detail || err.message;
  if (err.status === 404) return "We could not find that item. It may no longer be available.";
  if (err.status === 403) return "You do not have access to do that yet.";
  if (err.status >= 500) return "The server had trouble completing that request. Please try again.";
  if (/short this player/i.test(message)) return "You already have a short position in this player. Cover it before buying.";
  if (/long this player/i.test(message)) return "You already own shares in this player. Sell those shares before opening a short.";
  if (/insufficient|cash/i.test(message)) return "You do not have enough cash for this trade.";
  if (/not enough|shares/i.test(message)) return "You do not have enough shares for this trade.";
  if (/player not found/i.test(message)) return "We could not find that player. Try returning to the market.";
  if (/validation|field required|value is not/i.test(message)) return "Check the trade details and try again.";

  return detail || fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: authHeaders(init.headers),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new ApiHttpError(responseMessage(method, path, res.status, text), res.status, text);
  }

  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}
