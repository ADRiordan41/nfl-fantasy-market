"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactElement,
  type SVGProps,
} from "react";
import { apiGet, apiPost, clearAuthToken, getAuthToken, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatSignedPercent } from "@/lib/format";
import { getToastEventName, type ToastEventDetail } from "@/lib/toast";
import { useAdaptivePolling } from "@/lib/use-adaptive-polling";
import type { MarketMover, MarketMovers, NotificationList, Player, SearchResult, UserAccount } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
  requiresAdmin?: boolean;
};

type ToastItem = {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
};

function MarketIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 20V10" />
      <path d="M9 20V6" />
      <path d="M14 20v-4" />
      <path d="M19 20V8" />
      <path d="M3.5 14.5L8.5 11l4 2 7-6" />
    </svg>
  );
}

function LiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
      <path d="M7 16.5h2.6" />
      <path d="M7 12.8h4.2" />
      <path d="m15.3 13.2 1.2 1.4 2-2.5" />
      <circle cx="16.8" cy="10" r="2.8" />
    </svg>
  );
}

function PortfolioIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3v9h9" />
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 12 5.8 18.2" />
    </svg>
  );
}

function CommunityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 6.5h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-6l-3.6 3V17H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
      <path d="M8 10h8" />
      <path d="M8 13h5.5" />
    </svg>
  );
}

function InboxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.4" />
      <path d="m4.5 7.5 7.5 6 7.5-6" />
      <path d="M9.5 12.6 4.8 17.4" />
      <path d="m19.2 17.4-4.7-4.8" />
    </svg>
  );
}

function AdminIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 7h10" />
      <path d="M4 17h16" />
      <path d="M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
      <path d="M8 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
    </svg>
  );
}

function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.08-1l2.03-1.58-1.7-2.95-2.45 1a7.1 7.1 0 0 0-1.73-1l-.37-2.62h-3.4L10.92 6.5a7.1 7.1 0 0 0-1.73 1l-2.45-1-1.7 2.95L7.07 11a7 7 0 0 0 0 2l-2.03 1.58 1.7 2.95 2.45-1a7.1 7.1 0 0 0 1.73 1l.37 2.62h3.4l.37-2.62a7.1 7.1 0 0 0 1.73-1l2.45 1 1.7-2.95L18.92 13c.05-.33.08-.66.08-1Z" />
    </svg>
  );
}

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient id="mmDockGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2f7fff" />
          <stop offset="100%" stopColor="#ff8a2a" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" fill="url(#mmDockGradient)" />
      <path d="M10 34h28" className="nav-logo-axis" />
      <path d="M10.5 30.5 18 22.5 24 26.8 36.2 15.8" className="nav-logo-line" />
      <circle cx="18" cy="22.5" r="2.1" className="nav-logo-point" />
      <circle cx="24" cy="26.8" r="2.1" className="nav-logo-point" />
      <circle cx="36.2" cy="15.8" r="2.3" className="nav-logo-point-accent" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/portfolio", label: "Portfolio", Icon: PortfolioIcon },
  { href: "/market", label: "Market", Icon: MarketIcon },
  { href: "/community", label: "Community", Icon: CommunityIcon },
  { href: "/inbox", label: "Inbox", Icon: InboxIcon },
  { href: "/live", label: "Live", Icon: LiveIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
  { href: "/admin/stats", label: "Admin", Icon: AdminIcon, requiresAdmin: true },
] satisfies NavItem[];

const MOBILE_HOME_MENU_HREFS = new Set([
  "/inbox",
  "/settings",
  "/admin/stats",
]);

const FOOTER_LINKS = [
  { href: "/support", label: "Support" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/risk", label: "Risk" },
  { href: "/community-guidelines", label: "Community Guidelines" },
] as const;

const DEV_TICKER_PREVIEW_ROWS: MarketMover[] = [
  { player_id: 900001, sport: "NFL", name: "Jalen Hurts", team: "PHI", position: "QB", spot_price: 42.18, reference_price: 38.95, change: 3.23, change_percent: 8.29, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900002, sport: "NFL", name: "Christian McCaffrey", team: "SF", position: "RB", spot_price: 39.44, reference_price: 41.2, change: -1.76, change_percent: -4.27, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900003, sport: "NFL", name: "Justin Jefferson", team: "MIN", position: "WR", spot_price: 37.61, reference_price: 34.76, change: 2.85, change_percent: 8.2, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900004, sport: "NFL", name: "Travis Kelce", team: "KC", position: "TE", spot_price: 31.02, reference_price: 33.11, change: -2.09, change_percent: -6.31, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900005, sport: "MLB", name: "Ronald Acuna Jr.", team: "ATL", position: "OF", spot_price: 28.77, reference_price: 26.22, change: 2.55, change_percent: 9.73, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900006, sport: "MLB", name: "Mookie Betts", team: "LAD", position: "OF", spot_price: 27.14, reference_price: 28.05, change: -0.91, change_percent: -3.24, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900007, sport: "NBA", name: "Nikola Jokic", team: "DEN", position: "C", spot_price: 44.33, reference_price: 40.18, change: 4.15, change_percent: 10.33, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900008, sport: "NBA", name: "Jayson Tatum", team: "BOS", position: "F", spot_price: 35.09, reference_price: 36.44, change: -1.35, change_percent: -3.7, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900009, sport: "NHL", name: "Connor McDavid", team: "EDM", position: "C", spot_price: 33.82, reference_price: 31.42, change: 2.4, change_percent: 7.64, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
  { player_id: 900010, sport: "NHL", name: "Auston Matthews", team: "TOR", position: "C", spot_price: 32.56, reference_price: 34.22, change: -1.66, change_percent: -4.85, current_at: "2026-01-01T00:00:00Z", reference_at: "2025-12-31T00:00:00Z" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatTickerGeneratedAt(value: string | null | undefined): string {
  if (!value) return "Waiting for market data";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Waiting for market data";
  const elapsedMs = Date.now() - parsed.getTime();
  if (elapsedMs < 45_000) return "Updated just now";
  if (elapsedMs < 90_000) return "Updated 1m ago";

  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Updated ${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Updated ${elapsedDays}d ago`;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const mobileHomeMenuRef = useRef<HTMLDivElement | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authError, setAuthError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileHomeMenuOpen, setMobileHomeMenuOpen] = useState(false);
  const [movers, setMovers] = useState<MarketMovers | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSuccess, setFeedbackSuccess] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const pushToast = useCallback((detail: ToastEventDetail) => {
    const message = (detail.message || "").trim();
    if (!message) return;
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const tone = detail.tone ?? "info";
    const durationMs = detail.durationMs ?? 2800;
    setToasts((previous) => [...previous, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, Math.max(1200, durationMs));
  }, []);

  const loadCurrentUser = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setCurrentUser(null);
      setCheckingSession(false);
      return;
    }

    setCheckingSession(true);
    try {
      const me = await apiGet<UserAccount>("/auth/me");
      setCurrentUser(me);
      setAuthError("");
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        clearAuthToken();
        setCurrentUser(null);
        if (pathname !== "/auth") router.replace("/auth");
        return;
      }
      setAuthError(toMessage(err));
    } finally {
      setCheckingSession(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    void loadCurrentUser();
  }, [loadCurrentUser]);

  useEffect(() => {
    if (pathname === "/auth") return;
    function handleDocumentMouseDown(event: MouseEvent) {
      if (!searchContainerRef.current) return;
      if (searchContainerRef.current.contains(event.target as Node)) return;
      setSearchOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname === "/auth" || !currentUser) return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchBusy(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchBusy(true);
      try {
        const result = await apiGet<SearchResult[]>(`/search?query=${encodeURIComponent(trimmed)}&limit=10`);
        if (cancelled) return;
        setSearchResults(result);
      } catch (err: unknown) {
        if (cancelled) return;
        if (isUnauthorizedError(err)) {
          clearAuthToken();
          setCurrentUser(null);
          router.replace("/auth");
          return;
        }
        setAuthError(toMessage(err));
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentUser, pathname, router, searchQuery]);

  useEffect(() => {
    setMobileHomeMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileHomeMenuOpen) return;
    function handleDocumentMouseDown(event: MouseEvent) {
      if (!mobileHomeMenuRef.current) return;
      if (mobileHomeMenuRef.current.contains(event.target as Node)) return;
      setMobileHomeMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [mobileHomeMenuOpen]);

  const loadMovers = useCallback(async () => {
    if (pathname === "/auth") {
      setMovers(null);
      return;
    }
    try {
      const response = await apiGet<MarketMovers>("/market/movers?limit=25&window_hours=24");
      if (response.gainers.length + response.losers.length > 0) {
        setMovers(response);
        return;
      }

      const players = await apiGet<Player[]>("/players");
      const fallbackRows: MarketMover[] = [...players]
        .sort((a, b) => b.spot_price - a.spot_price)
        .slice(0, 10)
        .map((player) => ({
          player_id: player.id,
          sport: player.sport,
          name: player.name,
          team: player.team,
          position: player.position,
          spot_price: player.spot_price,
          reference_price: player.spot_price,
          change: 0,
          change_percent: 0,
          current_at: new Date().toISOString(),
          reference_at: null,
        }));
      setMovers({
        generated_at: response.generated_at,
        window_hours: response.window_hours,
        gainers: fallbackRows,
        losers: [],
      });
    } catch {
      setMovers(null);
    }
  }, [pathname]);

  useAdaptivePolling(loadMovers, { activeMs: 60_000, hiddenMs: 240_000 });

  const loadNotifications = useCallback(async () => {
    if (pathname === "/auth" || !getAuthToken()) {
      setUnreadNotifications(0);
      return;
    }
    try {
      const response = await apiGet<NotificationList>("/notifications?limit=20");
      setUnreadNotifications(response.unread_count);
    } catch {
      setUnreadNotifications(0);
    }
  }, [pathname]);

  useAdaptivePolling(loadNotifications, { activeMs: 45_000, hiddenMs: 180_000 });

  useEffect(() => {
    const eventName = getToastEventName();
    function onToast(event: Event) {
      const customEvent = event as CustomEvent<ToastEventDetail>;
      if (!customEvent.detail) return;
      pushToast(customEvent.detail);
    }
    window.addEventListener(eventName, onToast as EventListener);
    return () => {
      window.removeEventListener(eventName, onToast as EventListener);
    };
  }, [pushToast]);

  async function logout() {
    setBusy(true);
    setAuthError("");
    try {
      await apiPost("/auth/logout", {});
    } catch (err: unknown) {
      if (!isUnauthorizedError(err)) {
        setAuthError(toMessage(err));
      }
    } finally {
      clearAuthToken();
      setCurrentUser(null);
      setUnreadNotifications(0);
      setBusy(false);
      pushToast({ message: "Signed out.", tone: "info" });
      router.replace("/auth");
    }
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResults([]);
    setSearchOpen(false);
  }

  function navigateToSearchResult(href: string) {
    clearSearch();
    router.push(href);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstResult = searchResults[0];
    if (!firstResult) return;
    navigateToSearchResult(firstResult.href);
  }

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = feedbackMessage.trim();
    if (!message) {
      setFeedbackError("Enter feedback before submitting.");
      return;
    }
    setFeedbackBusy(true);
    setFeedbackError("");
    setFeedbackSuccess("");
    try {
      await apiPost("/feedback", {
        message,
        page_path: pathname,
      });
      setFeedbackMessage("");
      setFeedbackSuccess("Feedback sent. Thank you.");
      pushToast({ message: "Feedback submitted.", tone: "success" });
    } catch (err: unknown) {
      if (isUnauthorizedError(err)) {
        setFeedbackOpen(false);
        clearAuthToken();
        setCurrentUser(null);
        router.replace("/auth");
        return;
      }
      setFeedbackError(toMessage(err));
    } finally {
      setFeedbackBusy(false);
    }
  }

  const showNav = pathname !== "/auth";
  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (!item.requiresAdmin) return true;
        return Boolean(currentUser?.is_admin);
      }),
    [currentUser?.is_admin],
  );
  const mobileDockItems = useMemo(
    () => visibleNavItems.filter((item) => !MOBILE_HOME_MENU_HREFS.has(item.href)),
    [visibleNavItems],
  );
  const mobileHomeMenuItems = useMemo(
    () => visibleNavItems.filter((item) => MOBILE_HOME_MENU_HREFS.has(item.href)),
    [visibleNavItems],
  );
  const mobileDockColumns = useMemo(() => 1 + mobileDockItems.length, [mobileDockItems.length]);
  const mobileDockStyle = useMemo(
    () => ({ "--mobile-dock-columns": mobileDockColumns } as CSSProperties),
    [mobileDockColumns],
  );
  const tickerEntries: MarketMover[] = useMemo(() => {
    if (!movers) {
      return process.env.NODE_ENV !== "production" ? DEV_TICKER_PREVIEW_ROWS : [];
    }
    const byPlayerId = new Map<number, MarketMover>();
    for (const row of [...movers.gainers, ...movers.losers]) {
      const existing = byPlayerId.get(row.player_id);
      if (!existing) {
        byPlayerId.set(row.player_id, row);
        continue;
      }
      const currentAbs = Math.abs(row.change_percent);
      const existingAbs = Math.abs(existing.change_percent);
      if (currentAbs > existingAbs) {
        byPlayerId.set(row.player_id, row);
      }
    }
    const resolved = [...byPlayerId.values()]
      .sort((a, b) => {
        const absPctDelta = Math.abs(b.change_percent) - Math.abs(a.change_percent);
        if (absPctDelta !== 0) return absPctDelta;
        const absDelta = Math.abs(b.change) - Math.abs(a.change);
        if (absDelta !== 0) return absDelta;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 10);
    if (resolved.length > 0) return resolved;
    return process.env.NODE_ENV !== "production" ? DEV_TICKER_PREVIEW_ROWS : [];
  }, [movers]);
  const tickerLoopEntries = tickerEntries.length > 0 ? [...tickerEntries, ...tickerEntries] : [];
  const currentYear = new Date().getFullYear();
  const sessionStatusLabel = checkingSession
    ? "Checking session"
    : currentUser
      ? `Signed in as @${currentUser.username}${currentUser.is_admin ? " (Admin)" : ""}`
      : "Browsing as guest";
  const tickerStatusLabel = formatTickerGeneratedAt(movers?.generated_at);

  return (
    <div className={`app-shell${showNav ? " with-ticker" : ""}`}>
      {showNav && (
        <div className="market-ticker" role="status" aria-live="polite">
          <div className="market-ticker-inner">
            <span className="market-ticker-label">Active Stocks</span>
            <div className="market-ticker-track">
              {tickerLoopEntries.length > 0 ? (
                <div className="market-ticker-marquee">
                  {tickerLoopEntries.map((row, idx) => {
                    const changeClass = row.change_percent >= 0 ? "up" : "down";
                    const rank = (idx % tickerEntries.length) + 1;
                    return (
                      <Link
                        key={`${row.player_id}-${idx}`}
                        href={`/player/${row.player_id}`}
                        className="market-ticker-item"
                      >
                        <span className="market-ticker-rank">#{rank}</span>
                        <span className="market-ticker-player">{row.name}</span>
                        <span className="market-ticker-team">
                          {row.team} {row.position}
                        </span>
                        <span className={`market-ticker-change ${changeClass}`}>
                          {formatSignedPercent(row.change_percent, 2)}
                        </span>
                        <span className="market-ticker-price">{formatCurrency(row.spot_price)}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="market-ticker-empty">No 24h player mover data yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div className="header-primary">
          <Link href="/" className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" className="brand-mark-icon">
                <defs>
                  <linearGradient id="mmBrandGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2f7fff" />
                    <stop offset="100%" stopColor="#ff8a2a" />
                  </linearGradient>
                </defs>
                <rect x="2.5" y="2.5" width="43" height="43" rx="12.5" fill="url(#mmBrandGradient)" />
                <path d="M10 34h28" className="brand-mark-axis" />
                <path d="M10.5 30.5 18 22.5 24 26.8 36.2 15.8" className="brand-mark-line" />
                <circle cx="18" cy="22.5" r="2.1" className="brand-mark-point" />
                <circle cx="24" cy="26.8" r="2.1" className="brand-mark-point" />
                <circle cx="36.2" cy="15.8" r="2.3" className="brand-mark-point-accent" />
              </svg>
            </span>
            <span>
              <strong className="brand-title">
                <span className="brand-matchup">Matchup</span>
                <span className="brand-market">Market</span>
              </strong>
            </span>
          </Link>

          {showNav && (
            <nav className="desktop-nav" aria-label="Primary">
              {visibleNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`desktop-tab ${isActive(pathname, item.href) ? "active" : ""}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <div className="header-actions">
          {showNav && currentUser && (
            <Link href="/notifications" className="header-icon-link" aria-label="Notifications">
              <BellIcon className="header-icon" />
              {unreadNotifications > 0 && (
                <span className="header-badge">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>
              )}
            </Link>
          )}

          <div className="auth-panel">
            {checkingSession ? (
              <span className="auth-muted">Checking session...</span>
            ) : currentUser ? (
              <div className="auth-row">
                <button type="button" className="auth-btn" onClick={() => void logout()} disabled={busy}>
                  Log out
                </button>
              </div>
            ) : (
              <Link href="/auth" className="ghost-link auth-link">
                Sign In
              </Link>
            )}
            {authError && <small className="auth-error">{authError}</small>}
          </div>

          {showNav && currentUser && (
            <div className="header-search" ref={searchContainerRef}>
              <form className="header-search-form" onSubmit={submitSearch}>
                <input
                  className="header-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Search"
                  aria-label="Search players or users"
                />
              </form>
              {searchOpen && searchQuery.trim().length >= 2 && (
                <div className="search-results" role="listbox" aria-label="Search results">
                  {searchBusy ? (
                    <p className="search-empty">Searching...</p>
                  ) : searchResults.length === 0 ? (
                    <p className="search-empty">No matches</p>
                  ) : (
                    searchResults.map((result, idx) => (
                      <button
                        key={`${result.kind}-${result.href}-${idx}`}
                        type="button"
                        className="search-result-item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => navigateToSearchResult(result.href)}
                      >
                        <span className="search-result-top">
                          <span className={`search-kind ${result.kind}`}>{result.kind === "player" ? "Player" : "User"}</span>
                          <strong>{result.label}</strong>
                        </span>
                        {result.subtitle && <span className="search-result-subtitle">{result.subtitle}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {showNav && (
        <div className="app-status-strip" role="status" aria-live="polite">
          <span className={`status-pill ${currentUser ? "ok" : "neutral"}`}>{sessionStatusLabel}</span>
          <span className="status-pill neutral">{tickerStatusLabel}</span>
        </div>
      )}

      <div id="main-content" tabIndex={-1} className="app-content">
        <div className="route-frame" key={`${pathname}-${currentUser?.username ?? "guest"}`}>
          {children}
        </div>
      </div>

      <footer className="app-footer">
        <small className="app-footer-copy">MatchupMarket Beta {currentYear}</small>
        <nav className="app-footer-links" aria-label="Support and policy links">
          {FOOTER_LINKS.map((item) => (
            <Link key={item.href} href={item.href} className="app-footer-link">
              {item.label}
            </Link>
          ))}
        </nav>
      </footer>

      {showNav && (
        <nav className="mobile-nav" style={mobileDockStyle}>
          <div className="mobile-home-menu-wrap" ref={mobileHomeMenuRef}>
            <button
              type="button"
              className={`mobile-link mobile-home-trigger ${pathname === "/" ? "active" : ""}${mobileHomeMenuOpen ? " open" : ""}`}
              onClick={() => setMobileHomeMenuOpen((open) => !open)}
              aria-label="Home and account actions"
              aria-haspopup="menu"
              aria-expanded={mobileHomeMenuOpen}
              title="Home and account actions"
            >
              <HomeIcon className="nav-icon nav-logo-icon" />
              <span className="sr-only">Home</span>
            </button>
            {mobileHomeMenuOpen && (
              <div className="mobile-home-menu" role="menu" aria-label="Home and account actions">
                <Link href="/" className="mobile-home-action" role="menuitem" onClick={() => setMobileHomeMenuOpen(false)}>
                  Home
                </Link>
                {mobileHomeMenuItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="mobile-home-action"
                    role="menuitem"
                    onClick={() => setMobileHomeMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
                {checkingSession ? (
                  <span className="mobile-home-action muted" role="status" aria-live="polite">
                    Checking...
                  </span>
                ) : currentUser ? (
                  <button
                    type="button"
                    className="mobile-home-action"
                    role="menuitem"
                    onClick={() => {
                      setMobileHomeMenuOpen(false);
                      void logout();
                    }}
                    disabled={busy}
                  >
                    {busy ? "Signing out..." : "Sign out"}
                  </button>
                ) : (
                  <Link href="/auth" className="mobile-home-action" role="menuitem" onClick={() => setMobileHomeMenuOpen(false)}>
                    Sign in
                  </Link>
                )}
              </div>
            )}
          </div>
          {mobileDockItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`mobile-link ${isActive(pathname, item.href) ? "active" : ""}`}
              aria-label={item.label}
              title={item.label}
            >
              <item.Icon className="nav-icon" />
              <span className="sr-only">{item.label}</span>
            </Link>
          ))}
        </nav>
      )}

      {showNav && currentUser && (
        <>
          <button
            type="button"
            className="feedback-fab"
            onClick={() => {
              setFeedbackOpen(true);
              setFeedbackSuccess("");
              setFeedbackError("");
            }}
          >
            Feedback
          </button>
          {feedbackOpen && (
            <div className="feedback-modal-backdrop" role="presentation" onClick={() => setFeedbackOpen(false)}>
              <section
                className="feedback-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Send feedback"
                onClick={(event) => event.stopPropagation()}
              >
                <h3>Send Feedback</h3>
                <p className="subtle">Share bugs, friction, or feature requests for this page.</p>
                <form onSubmit={submitFeedback} className="feedback-form">
                  <textarea
                    value={feedbackMessage}
                    onChange={(event) => setFeedbackMessage(event.target.value)}
                    placeholder="What should we improve?"
                    maxLength={2000}
                  />
                  <p className="subtle">Page: {pathname}</p>
                  {feedbackError && <p className="error-box" role="alert">{feedbackError}</p>}
                  {feedbackSuccess && <p className="success-box" role="status">{feedbackSuccess}</p>}
                  <div className="feedback-actions">
                    <button type="button" onClick={() => setFeedbackOpen(false)} disabled={feedbackBusy}>
                      Close
                    </button>
                    <button type="submit" className="primary-btn" disabled={feedbackBusy}>
                      {feedbackBusy ? "Sending..." : "Send Feedback"}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
        </>
      )}

      {toasts.length > 0 && (
        <div className="toast-viewport" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-card ${toast.tone}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6.5 16.5h11l-1.2-1.6V10a4.3 4.3 0 1 0-8.6 0v4.9Z" />
      <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
