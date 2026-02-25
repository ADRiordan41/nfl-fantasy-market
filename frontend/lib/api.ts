const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8000";
const AUTH_TOKEN_STORAGE_KEY = "fsm_access_token";

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
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export function isUnauthorizedError(err: unknown): err is ApiHttpError {
  return err instanceof ApiHttpError && err.status === 401;
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
