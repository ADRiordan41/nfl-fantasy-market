"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export default function MarketPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string>("");
  const [buyShares, setBuyShares] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setError("");
    try {
      const data = await apiGet<Player[]>("/players");
      setPlayers(data);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function buy(playerId: number) {
    setBusyId(playerId);
    setError("");
    try {
      const shares = Number(buyShares[playerId] || 0);
      if (!shares || shares <= 0) throw new Error("Enter shares > 0");
      await apiPost("/trade/buy", { player_id: playerId, shares });
      await load(); // refresh prices
      setBuyShares((m) => ({ ...m, [playerId]: "" }));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>NFL Fantasy Market (Sandbox)</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Link href="/portfolio">Portfolio</Link>
        <button onClick={load}>Refresh</button>
      </div>

      {error && (
        <div style={{ background: "#fee", padding: 12, border: "1px solid #f99", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <table width="100%" cellPadding={10} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Player</th>
            <th>Team</th>
            <th>Pos</th>
            <th>Spot Price</th>
            <th>Buy</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>
  <Link href={`/player/${p.id}`}>{p.name}</Link>
</td>

              <td>{p.team}</td>
              <td>{p.position}</td>
              <td>${Number(p.spot_price).toFixed(2)}</td>
              <td style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={buyShares[p.id] || ""}
                  onChange={(e) => setBuyShares((m) => ({ ...m, [p.id]: e.target.value }))}
                  placeholder="shares"
                  style={{ width: 90 }}
                />
                <button disabled={busyId === p.id} onClick={() => buy(p.id)}>
                  {busyId === p.id ? "Buying..." : "Buy"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

