"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatNumber, formatPercent, formatSignedCurrency } from "@/lib/format";
import { teamPrimaryColor } from "@/lib/teamColors";
import type { Player, Portfolio, UserAccount } from "@/lib/types";

type HoldingRow = {
  id: number;
  name: string;
  sport: string;
  team: string;
  position: string;
  shares: number;
  base: number;
  spot: number;
  basisNotional: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
  allocationPct: number;
};

type SportGroup = {
  sport: string;
  rows: HoldingRow[];
  netValue: number;
  grossValue: number;
  allocationPct: number;
};

const SPORT_DISPLAY_ORDER = ["MLB", "NFL", "NBA", "NHL"] as const;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function PortfolioPage() {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [playersById, setPlayersById] = useState<Record<number, Player>>({});
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
    try {
      const [portfolioData, players, me] = await Promise.all([
        apiGet<Portfolio>("/portfolio"),
        apiGet<Player[]>("/players"),
        apiGet<UserAccount>("/auth/me"),
      ]);
      setPortfolio(portfolioData);
      setPlayersById(Object.fromEntries(players.map((player) => [player.id, player])));
      setCurrentUser(me);
      setError("");
    } catch (err: unknown) {
      handleRequestError(err);
    }
  }, [handleRequestError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo<HoldingRow[]>(() => {
    if (!portfolio) return [];

    return portfolio.holdings
      .map((holding) => {
        const player = playersById[holding.player_id];
        if (!player) return null;
        const shares = Number(holding.shares_owned);
        const base = Number(player.base_price);
        const spot = Number(holding.spot_price || player.spot_price);
        const basisNotional = Math.abs(shares) * base;
        const marketValue = Number(holding.market_value || shares * spot);
        const pnl = shares >= 0 ? marketValue - basisNotional : basisNotional + marketValue;
        const pnlPct = basisNotional > 0 ? (pnl / basisNotional) * 100 : 0;
        return {
          id: player.id,
          name: player.name,
          sport: player.sport,
          team: player.team,
          position: player.position,
          shares,
          base,
          spot,
          basisNotional,
          marketValue,
          pnl,
          pnlPct,
          allocationPct: 0,
        };
      })
      .filter((row): row is HoldingRow => row !== null)
      .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  }, [playersById, portfolio]);

  const computedNetExposure = useMemo(
    () => rows.reduce((sum, row) => sum + row.marketValue, 0),
    [rows],
  );

  const computedGrossExposure = useMemo(
    () => rows.reduce((sum, row) => sum + Math.abs(row.marketValue), 0),
    [rows],
  );

  const basisNotional = useMemo(
    () => rows.reduce((sum, row) => sum + row.basisNotional, 0),
    [rows],
  );

  const rowsWithAllocation = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        allocationPct: computedGrossExposure > 0 ? (Math.abs(row.marketValue) / computedGrossExposure) * 100 : 0,
      })),
    [computedGrossExposure, rows],
  );
  const sportGroups = useMemo<SportGroup[]>(() => {
    const groups = new Map<string, HoldingRow[]>();
    for (const row of rowsWithAllocation) {
      const existing = groups.get(row.sport);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(row.sport, [row]);
      }
    }

    const orderIndex = new Map<string, number>(SPORT_DISPLAY_ORDER.map((sport, index) => [sport, index]));
    return Array.from(groups.entries())
      .map(([sport, sportRows]) => {
        const netValue = sportRows.reduce((sum, row) => sum + row.marketValue, 0);
        const grossValue = sportRows.reduce((sum, row) => sum + Math.abs(row.marketValue), 0);
        return {
          sport,
          rows: sportRows,
          netValue,
          grossValue,
          allocationPct: computedGrossExposure > 0 ? (grossValue / computedGrossExposure) * 100 : 0,
        };
      })
      .sort((a, b) => {
        const aIndex = orderIndex.has(a.sport) ? (orderIndex.get(a.sport) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const bIndex = orderIndex.has(b.sport) ? (orderIndex.get(b.sport) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.sport.localeCompare(b.sport);
      });
  }, [computedGrossExposure, rowsWithAllocation]);

  const cash = portfolio?.cash_balance ?? 0;
  const holdings = portfolio?.net_exposure ?? computedNetExposure;
  const marginCall = portfolio?.margin_call ?? false;
  const totalAccount = portfolio?.equity ?? cash + holdings;
  const pnl = rows.reduce((sum, row) => sum + row.pnl, 0);
  const pnlPct = basisNotional > 0 ? (pnl / basisNotional) * 100 : 0;
  const pieSlices = useMemo(() => {
    const slices: { key: string; label: string; color: string; value: number }[] = [];
    const cashValue = Math.max(0, cash);
    slices.push({
      key: "cash",
      label: "Cash",
      color: "#11774c",
      value: cashValue,
    });

    for (const row of rowsWithAllocation) {
      const value = Math.max(0, row.marketValue);
      if (value <= 0) continue;
      slices.push({
        key: `player-${row.id}`,
        label: `${row.name} (${row.team})`,
        color: teamPrimaryColor(row.team, row.sport),
        value,
      });
    }
    return slices;
  }, [cash, rowsWithAllocation]);

  const pieTotal = useMemo(() => pieSlices.reduce((sum, slice) => sum + slice.value, 0), [pieSlices]);
  const pieBackground = useMemo(() => {
    if (pieTotal <= 0) return "conic-gradient(#deebf5 0 100%)";
    const separatorColor = "rgba(247, 251, 255, 0.96)";
    const hasMultipleSlices = pieSlices.length > 1;
    const baseSeparatorPct = hasMultipleSlices ? Math.min(0.42, 100 / (pieSlices.length * 18)) : 0;
    let cursor = 0;
    const stops: string[] = [];
    for (const slice of pieSlices) {
      const pct = (slice.value / pieTotal) * 100;
      const separatorPct = hasMultipleSlices ? Math.min(baseSeparatorPct, pct * 0.16) : 0;
      const colorStart = cursor;
      const colorEnd = cursor + Math.max(0, pct - separatorPct);
      const sliceEnd = cursor + pct;
      stops.push(`${slice.color} ${colorStart.toFixed(4)}% ${colorEnd.toFixed(4)}%`);
      if (separatorPct > 0.0001) {
        stops.push(`${separatorColor} ${colorEnd.toFixed(4)}% ${sliceEnd.toFixed(4)}%`);
      }
      cursor = sliceEnd;
    }
    if (cursor < 100) {
      stops.push(`${separatorColor} ${cursor.toFixed(4)}% 100%`);
    }
    return `conic-gradient(${stops.join(", ")})`;
  }, [pieSlices, pieTotal]);

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>Performance Board</h1>
          <p className="subtle">Monitor market value, allocation, and unrealized return by position.</p>
          {currentUser && (
            <p className="portfolio-user-meta">
              Username: <strong>{currentUser.username}</strong> | User ID: <strong>{currentUser.id}</strong>
              {currentUser.is_admin && (
                <span className="portfolio-admin-badge" aria-label="Admin account">
                  Admin
                </span>
              )}
            </p>
          )}
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      {marginCall && (
        <p className="error-box">
          Margin call active. Positions may be auto-liquidated until requirements are satisfied.
        </p>
      )}

      {!portfolio ? (
        <p className="subtle">Loading portfolio...</p>
      ) : (
        <>
          <section className="metrics-grid">
            <article className="kpi-card">
              <span>Cash</span>
              <strong>{formatCurrency(cash)}</strong>
            </article>
            <article className="kpi-card">
              <span>Holdings</span>
              <strong>{formatCurrency(holdings)}</strong>
            </article>
            <article className="kpi-card">
              <span>Total Account</span>
              <strong>{formatCurrency(totalAccount)}</strong>
            </article>
            <article className="kpi-card">
              <span>Unrealized P/L</span>
              <strong className={pnl >= 0 ? "up" : "down"}>
                {formatSignedCurrency(pnl)} ({formatPercent(pnlPct)})
              </strong>
            </article>
          </section>

          <section className="table-panel account-mix-panel">
            <div className="account-mix-layout">
              <div className="account-mix-chart-wrap">
                <div
                  className="account-mix-pie"
                  role="img"
                  aria-label="Pie chart showing holdings and cash composition"
                  style={{ background: pieBackground }}
                />
                <div className="account-mix-center">
                  <strong>{formatCurrency(totalAccount)}</strong>
                </div>
              </div>

              <div className="account-mix-legend">
                {pieSlices.map((slice) => {
                  const pct = pieTotal > 0 ? (slice.value / pieTotal) * 100 : 0;
                  return (
                    <div className="account-mix-row" key={slice.key}>
                      <span className="account-mix-label">
                        <span className="account-mix-swatch" style={{ background: slice.color }} />
                        <span className="account-mix-name" title={slice.label}>
                          {slice.label}
                        </span>
                      </span>
                      <strong>{formatCurrency(slice.value)}</strong>
                      <span>{formatPercent(pct, 1)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {rowsWithAllocation.length === 0 ? (
            <section className="empty-panel">
              <h3>No positions yet</h3>
              <p className="subtle">Place your first trade on the market screen to start tracking P/L.</p>
            </section>
          ) : (
            <>
              <section className="mobile-holdings">
                {sportGroups.map((group) => (
                  <section key={group.sport} className="portfolio-sport-group">
                    <div className="portfolio-sport-group-head">
                      <h3>{group.sport}</h3>
                      <p className="subtle portfolio-sport-summary">
                        {formatNumber(group.rows.length)} positions | Net {formatCurrency(group.netValue)} | {formatPercent(group.allocationPct, 1)} allocation
                      </p>
                    </div>

                    <div className="portfolio-sport-group-list">
                      {group.rows.map((row) => (
                        <article key={row.id} className="holding-card">
                          <div className="holding-head">
                            <Link href={`/player/${row.id}`} className="card-title">
                              {row.name}
                            </Link>
                            <span className="team-pill">
                              {row.sport} {row.team} {row.position}
                            </span>
                          </div>
                          <p className="muted-line">
                            {formatNumber(row.shares, 0)} shares | Current Price {formatCurrency(row.spot)} | Purchase Price{" "}
                            {formatCurrency(row.base)}
                          </p>
                          <div className="holding-metrics">
                            <span>Value: {formatCurrency(row.marketValue)}</span>
                            <span className={row.pnl >= 0 ? "up" : "down"}>
                              {formatSignedCurrency(row.pnl)} ({formatPercent(row.pnlPct)})
                            </span>
                          </div>
                          <div className="allocation-track">
                            <div style={{ width: `${Math.max(3, row.allocationPct)}%` }} />
                          </div>
                          <p className="subtle">Allocation {formatPercent(row.allocationPct, 1)}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </section>

              <section className="desktop-only portfolio-holdings-groups">
                {sportGroups.map((group) => (
                  <section key={group.sport} className="table-panel">
                    <div className="portfolio-sport-group-head">
                      <h3>{group.sport}</h3>
                      <p className="subtle portfolio-sport-summary">
                        {formatNumber(group.rows.length)} positions | Net {formatCurrency(group.netValue)} | Gross {formatCurrency(group.grossValue)} | {formatPercent(group.allocationPct, 1)} allocation
                      </p>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Player</th>
                            <th>Shares</th>
                            <th>Purchase Price</th>
                            <th>Current Price</th>
                            <th>Market Value</th>
                            <th>Unrealized P/L</th>
                            <th>Allocation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => (
                            <tr key={row.id}>
                              <td>
                                <Link href={`/player/${row.id}`} className="card-title">
                                  {row.name}
                                </Link>
                              </td>
                              <td>{formatNumber(row.shares, 0)}</td>
                              <td>{formatCurrency(row.base)}</td>
                              <td>{formatCurrency(row.spot)}</td>
                              <td>{formatCurrency(row.marketValue)}</td>
                              <td className={row.pnl >= 0 ? "up" : "down"}>
                                {formatSignedCurrency(row.pnl)} ({formatPercent(row.pnlPct)})
                              </td>
                              <td>{formatPercent(row.allocationPct, 1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
