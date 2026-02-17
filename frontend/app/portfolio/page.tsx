"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Portfolio = {
  cash_balance: number;
  holdings: { player_id: number; shares_owned: number }[];
};

type Player = {
  id: number;
  name: string;
  team: string;
  position: string;
  spot_price: number;
};

const API_BASE = "http://localhost:8000";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [playersById, setPlayersById] = useState<Record<number, Player>>({});
  const [error, setError] = useState<string>("");

  async function load() {
    setError("");
    try {
      const p = await apiGet<Portfolio>("/portfolio");
      const players = await apiGet<Player[]>("/players");

      const map: Record<number, Player> = {};
      for (const pl of players) map[pl.id] = pl;

      setPlayersById(map);
      setPortfolio(p);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Portfolio</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Link href="/">Market</Link>
        <button onClick={load}>Refresh</button>
      </div>

      {error && (
        <div style={{ background: "#fee", padding: 12, border: "1px solid #f99", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!portfolio ? (
        <p>Loading...</p>
      ) : (
        <>
          <h2>Cash: ${Number(portfolio.cash_balance).toFixed(2)}</h2>

          <h3>Holdings</h3>
          {portfolio.holdings.length === 0 ? (
            <p>No holdings yet.</p>
          ) : (
            <table width="100%" cellPadding={10} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th>Player</th>
                  <th>Shares</th>
                  <th>Spot Price</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h) => {
                  const pl = playersById[h.player_id];
                  return (
                    <tr key={h.player_id} style={{ borderBottom: "1px solid #eee" }}>
                      <td>{pl ? `${pl.name} (${pl.team} ${pl.position})` : `Player #${h.player_id}`}</td>
                      <td>{Number(h.shares_owned).toFixed(4)}</td>
                      <td>{pl ? `$${Number(pl.spot_price).toFixed(2)}` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
