"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedCurrency, formatSignedPercent } from "@/lib/format";
import type { Player, Portfolio, PricePoint, Quote } from "@/lib/types";

type TradeSide = "BUY" | "SELL" | "SHORT" | "COVER";
const MAX_POSITION_NOTIONAL_PER_PLAYER = 10000;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseWholeShares(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

function toWholeQuickSizes(values: number[]): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const whole = Math.floor(value);
    if (whole <= 0 || seen.has(whole)) continue;
    seen.add(whole);
    result.push(whole);
  }
  return result;
}

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

function isCostSide(side: TradeSide): boolean {
  return side === "BUY" || side === "COVER";
}

function PriceHistoryChart({ points }: { points: PricePoint[] }) {
  const sorted = useMemo(
    () => [...points].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [points],
  );

  if (sorted.length === 0) {
    return (
      <article className="history-card">
        <div className="history-head">
          <h3>Price History</h3>
        </div>
        <p className="subtle">No history points yet. First trade or stats update will create the timeline.</p>
      </article>
    );
  }

  const width = 760;
  const height = 260;
  const left = 44;
  const right = 16;
  const top = 16;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const values = sorted.map((point) => point.spot_price);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = rawMin === rawMax ? Math.max(0, rawMin - 1) : rawMin;
  const max = rawMin === rawMax ? rawMax + 1 : rawMax;
  const span = Math.max(0.0001, max - min);

  const xAt = (index: number) => (sorted.length === 1 ? left + plotWidth / 2 : left + (index * plotWidth) / (sorted.length - 1));
  const yAt = (value: number) => top + ((max - value) / span) * plotHeight;

  const coords = sorted.map((point, index) => ({ x: xAt(index), y: yAt(point.spot_price), point }));
  const linePath = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${(
    top + plotHeight
  ).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(top + plotHeight).toFixed(2)} Z`;

  const start = sorted[0];
  const latest = sorted[sorted.length - 1];
  const delta = latest.spot_price - start.spot_price;
  const deltaPct = start.spot_price > 0 ? (delta / start.spot_price) * 100 : 0;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = max - span * fraction;
    const y = yAt(value);
    return { value, y };
  });

  return (
    <article className="history-card">
      <div className="history-head">
        <h3>Price History</h3>
        <p className="subtle">
          {sorted.length} points | Last update {formatStamp(latest.created_at)}
        </p>
      </div>

      <div className="history-stats">
        <span>
          Change{" "}
          <strong className={delta >= 0 ? "up" : "down"}>
            {formatSignedCurrency(delta)} ({formatSignedPercent(deltaPct)})
          </strong>
        </span>
        <span>
          Low <strong>{formatCurrency(rawMin)}</strong>
        </span>
        <span>
          High <strong>{formatCurrency(rawMax)}</strong>
        </span>
      </div>

      <div className="history-chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="history-chart" role="img" aria-label="Player price history line chart">
          <defs>
            <linearGradient id="spot-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(17,124,99,0.32)" />
              <stop offset="100%" stopColor="rgba(17,124,99,0.02)" />
            </linearGradient>
          </defs>

          {yTicks.map((tick) => (
            <g key={tick.y}>
              <line x1={left} x2={width - right} y1={tick.y} y2={tick.y} className="history-grid-line" />
              <text x={8} y={tick.y + 4} className="history-grid-label">
                {formatCurrency(tick.value, 0)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill="url(#spot-area)" />
          <path d={linePath} className="history-line" />
          <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={4} className="history-dot" />
        </svg>
      </div>

      <div className="history-axis-labels">
        <span>{formatStamp(start.created_at)}</span>
        <span>{formatStamp(latest.created_at)}</span>
      </div>
    </article>
  );
}

export default function PlayerPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const playerId = Number(params?.id);
  const validId = Number.isFinite(playerId) && playerId > 0;

  const [player, setPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [side, setSide] = useState<TradeSide>("BUY");
  const [shares, setShares] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busyPlace, setBusyPlace] = useState(false);
  const [error, setError] = useState("");

  const handleRequestError = useCallback(
    (err: unknown) => {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      setError(toMessage(err));
    },
    [router],
  );

  const load = useCallback(async () => {
    if (!validId) return;
    try {
      const [playerData, historyData, portfolioData] = await Promise.all([
        apiGet<Player>(`/players/${playerId}`),
        apiGet<PricePoint[]>(`/players/${playerId}/history?limit=1500`),
        apiGet<Portfolio>("/portfolio"),
      ]);
      setPlayer(playerData);
      setHistory(historyData);
      setPortfolio(portfolioData);
      setError("");
    } catch (err: unknown) {
      handleRequestError(err);
    }
  }, [handleRequestError, playerId, validId]);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const owned = useMemo(
    () => portfolio?.holdings.find((holding) => holding.player_id === playerId)?.shares_owned ?? 0,
    [playerId, portfolio],
  );

  const positionValue = owned * Number(player?.spot_price ?? 0);
  const premiumPct = player?.base_price ? ((player.spot_price - player.base_price) / player.base_price) * 100 : 0;
  const live = player?.live;
  const maxOpenSharesAtSpot = MAX_POSITION_NOTIONAL_PER_PLAYER / Math.max(0.0001, Number(player?.spot_price ?? 0));
  const buyRemaining = owned < 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, owned)));
  const shortRemaining =
    owned > 0 ? 0 : Math.max(0, Math.floor(maxOpenSharesAtSpot - Math.max(0, Math.abs(owned))));

  const quickSell = owned > 0 ? toWholeQuickSizes([owned * 0.25, owned * 0.5, owned]) : [];
  const quickCover = owned < 0 ? toWholeQuickSizes([Math.abs(owned) * 0.25, Math.abs(owned) * 0.5, Math.abs(owned)]) : [];
  const quickSizes = side === "SELL" ? quickSell : side === "COVER" ? quickCover : [];

  function changeSide(next: TradeSide) {
    setSide(next);
    setQuote(null);
  }

  function changeShares(next: string) {
    setShares(next);
    setQuote(null);
  }

  function applyQuick(nextSize: number) {
    changeShares(String(nextSize));
  }

  async function executeMaxTrade(nextSide: "BUY" | "SHORT", maxSize: number) {
    if (!validId || maxSize <= 0) return;
    setSide(nextSide);
    setShares(String(maxSize));
    setBusyPreview(true);
    setBusyPlace(true);
    setError("");
    try {
      const nextQuote = await apiPost<Quote>(`/quote/${nextSide.toLowerCase()}`, {
        player_id: playerId,
        shares: maxSize,
      });
      await apiPost(`/trade/${nextSide.toLowerCase()}`, {
        player_id: playerId,
        shares: nextQuote.shares,
      });
      setShares("");
      setQuote(null);
      await load();
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setBusyPreview(false);
      setBusyPlace(false);
    }
  }

  async function previewTrade() {
    if (!validId) return;
    const amount = parseWholeShares(shares);
    if (!amount) {
      setError("Enter whole shares (1 or more) before previewing.");
      return;
    }

    setBusyPreview(true);
    setError("");
    try {
      const nextQuote = await apiPost<Quote>(`/quote/${side.toLowerCase()}`, {
        player_id: playerId,
        shares: amount,
      });
      setQuote(nextQuote);
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setBusyPreview(false);
    }
  }

  async function placeTrade() {
    if (!quote || !validId) {
      setError("Preview a quote first.");
      return;
    }

    setBusyPlace(true);
    setError("");
    try {
      await apiPost(`/trade/${side.toLowerCase()}`, {
        player_id: playerId,
        shares: quote.shares,
      });
      setShares("");
      setQuote(null);
      await load();
    } catch (err: unknown) {
      handleRequestError(err);
    } finally {
      setBusyPlace(false);
    }
  }

  if (!validId) {
    return (
      <main className="page-shell">
        <section className="empty-panel">
          <h2>Invalid player id</h2>
          <p className="subtle">The selected player route is not valid.</p>
          <Link href="/market" className="ghost-link">
            Return to market
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero-panel player-hero">
        <div>
          <p className="eyebrow">Player Detail</p>
          <h1>{player ? player.name : "Loading player..."}</h1>
          <p className="subtle">{player ? `${player.sport} ${player.team} ${player.position}` : "Fetching latest quote..."}</p>
        </div>
        <div className="hero-actions">
          <button onClick={load}>Refresh</button>
          <Link href="/portfolio" className="ghost-link">
            Portfolio
          </Link>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      {live?.live_now && (
        <section className="table-panel live-detail-panel">
          <div className="live-now-head">
            <span className="live-indicator">
              <span className="live-dot" />
              LIVE NOW
            </span>
            {live.game_status && <span className="live-status">{live.game_status}</span>}
          </div>
          {live.game_label && <p className="live-stat-line">{live.game_label}</p>}
          <p className="live-stat-line">{live.game_stat_line ?? "In-game stats are updating."}</p>
          <p className="live-fpts">
            This game (week {live.week ?? player?.latest_week ?? "--"}):{" "}
            <strong>{formatNumber(live.game_fantasy_points ?? 0, 2)} pts</strong>
          </p>
        </section>
      )}

      {player && (
        <section className="metrics-grid">
          <article className="kpi-card">
            <span>Current Price</span>
            <strong>{formatCurrency(player.spot_price)}</strong>
          </article>
          <article className="kpi-card">
            <span>Purchase Price</span>
            <strong>{formatCurrency(player.base_price)}</strong>
          </article>
          <article className="kpi-card">
            <span>Premium</span>
            <strong className={premiumPct >= 0 ? "up" : "down"}>
              {formatSignedPercent(premiumPct)}
            </strong>
          </article>
          <article className="kpi-card">
            <span>Net Shares</span>
            <strong>{Math.round(owned)}</strong>
          </article>
          <article className="kpi-card">
            <span>Position Value</span>
            <strong>{formatCurrency(positionValue)}</strong>
          </article>
          <article className="kpi-card">
            <span>Total Float</span>
            <strong>{formatNumber(player.total_shares, 2)}</strong>
          </article>
        </section>
      )}

      <PriceHistoryChart points={history} />

      <section className="trade-layout">
        <article className="trade-card">
          <div className="segment-row segment-4">
            <button className={side === "BUY" ? "segment active" : "segment"} onClick={() => changeSide("BUY")}>
              Buy
            </button>
            <button
              className={side === "SELL" ? "segment danger-segment danger-active" : "segment danger-segment"}
              onClick={() => changeSide("SELL")}
            >
              Sell
            </button>
            <button
              className={side === "SHORT" ? "segment danger-segment danger-active" : "segment danger-segment"}
              onClick={() => changeSide("SHORT")}
            >
              Short
            </button>
            <button className={side === "COVER" ? "segment active" : "segment"} onClick={() => changeSide("COVER")}>
              Cover
            </button>
          </div>

          <label className="field-label">Shares</label>
          <p className="subtle">
            Opening buy/short size is capped at {formatCurrency(MAX_POSITION_NOTIONAL_PER_PLAYER)} notional per
            player. Shares available: Buy {formatNumber(buyRemaining)} | Short {formatNumber(shortRemaining)}.
          </p>
          <div className="chip-row">
            <button
              className="chip"
              onClick={() => void executeMaxTrade("BUY", buyRemaining)}
              disabled={buyRemaining <= 0 || busyPreview || busyPlace}
            >
              Buy Max ({formatNumber(buyRemaining)})
            </button>
            <button
              className="chip"
              onClick={() => void executeMaxTrade("SHORT", shortRemaining)}
              disabled={shortRemaining <= 0 || busyPreview || busyPlace}
            >
              Short Max ({formatNumber(shortRemaining)})
            </button>
          </div>
          <div className="trade-input-row">
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={shares}
              onChange={(event) => changeShares(event.target.value)}
              placeholder="0"
            />
            <button disabled={busyPreview} onClick={previewTrade}>
              {busyPreview ? "Quoting..." : "Preview"}
            </button>
          </div>

          {(side === "SELL" || side === "COVER") && (
            <div className="chip-row">
              {quickSizes.map((size) => (
                <button key={`${side}-${size}`} className="chip" onClick={() => applyQuick(size)}>
                  {formatNumber(size)}
                </button>
              ))}
              {side === "SELL" && quickSell.length === 0 && <span className="chip muted-chip">No shares to sell</span>}
              {side === "COVER" && quickCover.length === 0 && <span className="chip muted-chip">No short to cover</span>}
            </div>
          )}

          <button
            className={side === "SHORT" || side === "SELL" ? "primary-btn full short-btn" : "primary-btn full"}
            disabled={!quote || busyPlace}
            onClick={placeTrade}
          >
            {busyPlace ? "Placing..." : `Place ${side}`}
          </button>
        </article>

        <article className="quote-card">
          <h3>Quote Breakdown</h3>
          {quote ? (
            <>
              <p className="quote-main">
                {isCostSide(side) ? "Estimated Cost" : "Estimated Proceeds"}: {formatCurrency(quote.total)}
              </p>
              <p className="subtle">Shares: {formatNumber(quote.shares, 0)}</p>
              <p className="subtle">Average price: {formatCurrency(quote.average_price, 3)}</p>
              <p className="subtle">
                Current Price shift: {formatCurrency(quote.spot_price_before)} to {formatCurrency(quote.spot_price_after)}
              </p>
              <p className="quote-note">Quotes are point-in-time previews and can move with new trades.</p>
            </>
          ) : (
            <p className="subtle">Preview to populate quote details and enable trade execution.</p>
          )}
        </article>
      </section>
    </main>
  );
}

