"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Player = {
  id: number;
  name: string;
  team: string;
  position: string;
  spot_price: number;
};

type Portfolio = {
  cash_balance: number;
  holdings: { player_id: number; shares_owned: number }[];
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

export default function PlayerPage() {
  const params = useParams<{ id: string }>();
  const playerId = Number(params?.id);if (!Number.isFinite(playerId)) {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <p>Loading player…</p>
      <p style={{ color: "#666" }}>Waiting for route id.</p>
    </main>
  );
}


  const [player, setPlayer] = useState<Player | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string>("");
  const [buyShares, setBuyShares] = useState<string>("");
  const [sellShares, setSellShares] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [buyQuote, setBuyQuote] = useState<any>(null);
  const [sellQuote, setSellQuote] = useState<any>(null);
  type Quote = {
  player_id: number;
  shares: number;
  spot_price_before: number;
  spot_price_after: number;
  average_price: number;
  total: number;
};

const [confirmOpen, setConfirmOpen] = useState(false);
const [confirmSide, setConfirmSide] = useState<"BUY" | "SELL" | null>(null);
const [confirmQuote, setConfirmQuote] = useState<Quote | null>(null);

  async function load() {
    setError("");
    try {
      const p = await apiGet<Player>(`/players/${playerId}`);
      const port = await apiGet<Portfolio>("/portfolio");
      setPlayer(p);
      setPortfolio(port);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, [playerId]);

  const owned =
    portfolio?.holdings?.find((h) => h.player_id === playerId)?.shares_owned ?? 0;

  async function buy() {
    setBusy(true);
    setError("");
    try {
      const shares = Number(buyShares || 0);
      if (!shares || shares <= 0) throw new Error("Enter shares > 0");
      await apiPost("/trade/buy", { player_id: playerId, shares });
      setBuyQuote(null);
      setBuyShares("");
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sell() {
    setBusy(true);
    setError("");
    try {
      const shares = Number(sellShares || 0);
      if (!shares || shares <= 0) throw new Error("Enter shares > 0");
      await apiPost("/trade/sell", { player_id: playerId, shares });
      setSellQuote(null);
      setSellShares("");
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }
async function previewBuy() {
  setError("");
  try {
    const shares = Number(buyShares || 0);
    if (!shares || shares <= 0) throw new Error("Enter shares > 0");

    const q = await apiPost<Quote>("/quote/buy", { player_id: playerId, shares });

    setConfirmSide("BUY");
    setConfirmQuote(q);
    setConfirmOpen(true);
  } catch (e: any) {
    setError(e?.message || String(e));
  }
}

async function previewSell() {
  setError("");
  try {
    const shares = Number(sellShares || 0);
    if (!shares || shares <= 0) throw new Error("Enter shares > 0");

    const q = await apiPost<Quote>("/quote/sell", { player_id: playerId, shares });

    setConfirmSide("SELL");
    setConfirmQuote(q);
    setConfirmOpen(true);
  } catch (e: any) {
    setError(e?.message || String(e));
  }
}
async function confirmTrade() {
  if (!confirmSide || !confirmQuote) return;

  setBusy(true);
  setError("");
  try {
    const shares = confirmQuote.shares;

    if (confirmSide === "BUY") {
      await apiPost("/trade/buy", { player_id: playerId, shares });
      setBuyShares("");
      // optional: clear any inline quote UI you still have
      // setBuyQuote(null);
    } else {
      await apiPost("/trade/sell", { player_id: playerId, shares });
      setSellShares("");
      // setSellQuote(null);
    }

    setConfirmOpen(false);
    setConfirmSide(null);
    setConfirmQuote(null);

    await load();
  } catch (e: any) {
    setError(e?.message || String(e));
  } finally {
    setBusy(false);
  }
}

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Link href="/">Market</Link>
        <Link href="/portfolio">Portfolio</Link>
        <button onClick={load}>Refresh</button>
      </div>
{confirmOpen && confirmQuote && confirmSide && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      zIndex: 9999,
    }}
    onClick={() => {
      if (!busy) {
        setConfirmOpen(false);
        setConfirmSide(null);
        setConfirmQuote(null);
      }
    }}
  >
    <div
      style={{
        background: "#fff",
        width: 460,
        maxWidth: "100%",
        borderRadius: 16,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 14, color: "#666" }}>Confirm trade</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {confirmSide === "BUY" ? "Buy" : "Sell"} {player?.name ?? ""}
          </div>
        </div>

        <button
          aria-label="Close"
          disabled={busy}
          onClick={() => {
            setConfirmOpen(false);
            setConfirmSide(null);
            setConfirmQuote(null);
          }}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
            fontSize: 18,
            lineHeight: "32px",
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 16 }}>
        {/* Big number */}
        <div
          style={{
            background: confirmSide === "BUY" ? "rgba(0, 120, 255, 0.08)" : "rgba(0, 180, 120, 0.08)",
            border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "#555" }}>
            {confirmSide === "BUY" ? "Estimated cost" : "Estimated proceeds"}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>
            ${Number(confirmQuote.total).toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
            Quote preview based on current market depth.
          </div>
        </div>

        {/* Rows */}
        <div style={{ display: "grid", gap: 10 }}>
          <Row
            label="Shares"
            value={Number(confirmQuote.shares).toFixed(4)}
          />
          <Row
            label="Average price"
            value={`$${Number(confirmQuote.average_price).toFixed(3)}`}
          />
          <Row
            label="Spot price"
            value={`$${Number(confirmQuote.spot_price_before).toFixed(2)} → $${Number(confirmQuote.spot_price_after).toFixed(2)}`}
          />
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.4 }}>
          Final fill may differ slightly if the price moves between preview and confirm.
        </div>
      </div>

      {/* Footer buttons */}
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: 16,
          borderTop: "1px solid rgba(0,0,0,0.08)",
          background: "rgba(0,0,0,0.015)",
        }}
      >
        <button
          style={{
            flex: 1,
            height: 42,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.14)",
            background: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          disabled={busy}
          onClick={() => {
            setConfirmOpen(false);
            setConfirmSide(null);
            setConfirmQuote(null);
          }}
        >
          Cancel
        </button>

        <button
          style={{
            flex: 1,
            height: 42,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.14)",
            background: "#111",
            color: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 700,
          }}
          disabled={busy}
          onClick={confirmTrade}
        >
          {busy ? "Placing..." : "Confirm"}
        </button>
      </div>
    </div>
  </div>
)}


      {error && (
        <div style={{ background: "#fee", padding: 12, border: "1px solid #f99", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!player ? (
        <p>Loading...</p>
      ) : (
        <>
          <h1>{player.name}</h1>
          <p>
            {player.team} · {player.position}
          </p>
          <h2>Spot Price: ${Number(player.spot_price).toFixed(2)}</h2>
          <p>
            You own: <b>{Number(owned).toFixed(4)}</b> shares
          </p>

          <div style={{ display: "flex", gap: 24, marginTop: 20 }}>
            <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, width: 300 }}>
              <h3>Buy</h3>
              <input
                value={buyShares}
                onChange={(e) => setBuyShares(e.target.value)}
                placeholder="shares"
                style={{ width: "100%", marginBottom: 8 }}
              />
              <button disabled={busy} onClick={buy} style={{ width: "100%" }}>
                Buy
              </button>
<button disabled={busy} onClick={previewBuy} style={{ width: "100%", marginTop: 8 }}>
  Preview Buy
</button>

{buyQuote && (
  <div style={{ marginTop: 10, fontSize: 14, color: "#333" }}>
    <div>Est. cost: <b>${Number(buyQuote.total).toFixed(2)}</b></div>
    <div>Avg price: ${Number(buyQuote.average_price).toFixed(2)}</div>
    <div>Spot: ${Number(buyQuote.spot_price_before).toFixed(2)} → ${Number(buyQuote.spot_price_after).toFixed(2)}</div>
  </div>
)}
            </div>

            <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, width: 300 }}>
              <h3>Sell</h3>
              <input
                value={sellShares}
                onChange={(e) => setSellShares(e.target.value)}
                placeholder="shares"
                style={{ width: "100%", marginBottom: 8 }}
              />
              <button disabled={busy} onClick={sell} style={{ width: "100%" }}>
                Sell
              </button>
<button disabled={busy} onClick={previewSell} style={{ width: "100%", marginTop: 8 }}>
  Preview Sell
</button>

{sellQuote && (
  <div style={{ marginTop: 10, fontSize: 14, color: "#333" }}>
    <div>Est. proceeds: <b>${Number(sellQuote.total).toFixed(2)}</b></div>
    <div>Avg price: ${Number(sellQuote.average_price).toFixed(2)}</div>
    <div>Spot: ${Number(sellQuote.spot_price_before).toFixed(2)} → ${Number(sellQuote.spot_price_after).toFixed(2)}</div>
  </div>
)}

            </div>
          </div>
        </>
      )}
    </main>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 12px",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 13, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{value}</div>
    </div>
  );
}
