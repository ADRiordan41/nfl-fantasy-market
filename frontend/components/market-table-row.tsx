"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency, formatNumber, formatPercent, formatSignedCurrency, formatSignedPercent } from "@/lib/format";
import type { Quote } from "@/lib/types";

export type MarketTradeSide = "BUY" | "SELL" | "SHORT" | "COVER";

export type MarketPriceFlashState = {
  spot?: "up" | "down";
};

export type MarketTableRowModel = {
  player: {
    id: number;
    name: string;
    team: string;
    position: string;
    sport: string;
    spot_price: number;
    live: {
      live_now: boolean;
    } | null;
  };
  sharesHeld: number;
  sharesShort: number;
  seasonEarnings: number;
  totalChangePct: number;
  change24hPct: number;
  change7dPct: number;
  buyRemaining: number;
  shortRemaining: number;
};

type MarketTableRowProps = {
  row: MarketTableRowModel;
  isTradingHalted: boolean;
  hidePerformanceColumns?: boolean;
  extraColumnsBeforeEarnings?: boolean;
  combinePositionColumn?: boolean;
  positionShares?: number | null;
  holdingTotalValue?: number | null;
  closeOnlyShares?: number | null;
  averageEntryPrice?: number | null;
  userTotalGain?: number | null;
  userTotalGainPct?: number | null;
  priceFlash?: MarketPriceFlashState;
  measureRow?: boolean;
  onMeasureRow?: (height: number) => void;
  onSetError: (message: string) => void;
  onPreviewQuote: (playerId: number, side: MarketTradeSide, shares: number) => Promise<Quote>;
  onExecuteTrade: (playerId: number, side: MarketTradeSide, shares: number) => Promise<void>;
};

export const DEFAULT_MARKET_ROW_HEIGHT = 44;

function isCostSide(side: MarketTradeSide): boolean {
  return side === "BUY" || side === "SHORT";
}

function parseWholeShares(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}

function flashClass(direction: "up" | "down" | undefined): string {
  if (!direction) return "";
  return direction === "up" ? " market-cell-flash-up" : " market-cell-flash-down";
}

function MarketTableRow({
  row,
  isTradingHalted,
  hidePerformanceColumns = false,
  extraColumnsBeforeEarnings = false,
  combinePositionColumn = false,
  positionShares = null,
  holdingTotalValue = null,
  closeOnlyShares = null,
  averageEntryPrice,
  userTotalGain,
  userTotalGainPct,
  priceFlash,
  measureRow = false,
  onMeasureRow,
  onSetError,
  onPreviewQuote,
  onExecuteTrade,
}: MarketTableRowProps) {
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const [side, setSide] = useState<MarketTradeSide>("BUY");
  const [qty, setQty] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  useEffect(() => {
    if (!measureRow || !onMeasureRow || !rowRef.current) return;
    const height = Math.ceil(rowRef.current.getBoundingClientRect().height);
    if (height > 0) onMeasureRow(height);
  }, [isPlacing, isPreviewing, measureRow, onMeasureRow, quote]);

  const setQuantity = useCallback((value: string) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 4);
    setQty(digitsOnly);
    setQuote(null);
  }, []);

  const handlePreviewTrade = useCallback(async () => {
    if (isTradingHalted) return;
    const shares = parseWholeShares(qty);
    if (!shares) {
      onSetError("Enter whole shares (1 or more) before previewing.");
      return;
    }

    setIsPreviewing(true);
    onSetError("");
    try {
      const nextQuote = await onPreviewQuote(row.player.id, side, shares);
      setQuote(nextQuote);
    } catch {
      // Parent callback already surfaces the request error.
    } finally {
      setIsPreviewing(false);
    }
  }, [isTradingHalted, onPreviewQuote, onSetError, qty, row.player.id, side]);

  const handlePlaceTrade = useCallback(async () => {
    if (isTradingHalted) return;
    if (!quote) {
      onSetError("Preview a quote first.");
      return;
    }

    setIsPlacing(true);
    onSetError("");
    try {
      await onExecuteTrade(row.player.id, side, quote.shares);
      setQty("");
      setQuote(null);
    } catch {
      // Parent callback already surfaces the request error.
    } finally {
      setIsPlacing(false);
    }
  }, [isTradingHalted, onExecuteTrade, onSetError, quote, row.player.id, side]);

  const handleExecuteMaxTrade = useCallback(
    async (nextSide: MarketTradeSide, maxSize: number) => {
      if (isTradingHalted || maxSize <= 0) return;
      setSide(nextSide);
      setQty(String(maxSize));
      setIsPreviewing(true);
      setIsPlacing(true);
      onSetError("");
      try {
        const nextQuote = await onPreviewQuote(row.player.id, nextSide, maxSize);
        await onExecuteTrade(row.player.id, nextSide, nextQuote.shares);
        setQty("");
        setQuote(null);
      } catch {
        // Parent callback already surfaces the request error.
      } finally {
        setIsPreviewing(false);
        setIsPlacing(false);
      }
    },
    [isTradingHalted, onExecuteTrade, onPreviewQuote, onSetError, row.player.id],
  );

  const rowHighlighted = Boolean(quote) || isPreviewing || isPlacing;
  const hasAverageEntry = averageEntryPrice != null && Number.isFinite(averageEntryPrice);
  const hasUserTotalGain = userTotalGain != null && Number.isFinite(userTotalGain);
  const closeOnlyEnabled = closeOnlyShares != null;
  const closeQuickSide: MarketTradeSide | null =
    closeOnlyShares == null ? null : closeOnlyShares > 0 ? "SELL" : closeOnlyShares < 0 ? "COVER" : null;
  const closeQuickSize =
    closeOnlyShares == null ? 0 : Math.max(0, Math.abs(Math.trunc(Number(closeOnlyShares))));
  const positionValue = Number(positionShares ?? 0);
  const positionClass =
    positionValue > 0 ? "market-position-held" : positionValue < 0 ? "market-position-short" : "market-position-flat";

  return (
    <tr
      ref={rowRef}
      className={`market-data-row${rowHighlighted ? " market-row-quoted" : ""}${isPlacing ? " market-row-placing" : ""}`}
      data-market-row="true"
    >
      <td className="market-sticky-player-cell">
        <div className="market-player-cell">
          <Link href={`/player/${row.player.id}`} className="card-title">
            {row.player.name}
          </Link>
          <span className="market-player-meta">
            {row.player.team} {row.player.position}
          </span>
          {row.player.live?.live_now && <span className="market-live-chip">LIVE</span>}
        </div>
      </td>
      <td className={`market-cell-numeric market-price-cell market-mid-cell${flashClass(priceFlash?.spot)}`}>
        {formatCurrency(row.player.spot_price)}
      </td>
      {!hidePerformanceColumns ? (
        <td className={`market-cell-numeric ${row.totalChangePct >= 0 ? "up" : "down"}`}>
          {formatSignedPercent(row.totalChangePct)}
        </td>
      ) : null}
      {!hidePerformanceColumns ? (
        <td className={`market-cell-numeric ${row.change24hPct >= 0 ? "up" : "down"}`}>
          {formatSignedPercent(row.change24hPct)}
        </td>
      ) : null}
      {extraColumnsBeforeEarnings && hasAverageEntry ? (
        <td className="market-cell-numeric">{formatCurrency(averageEntryPrice)}</td>
      ) : null}
      {extraColumnsBeforeEarnings && hasUserTotalGain ? (
        <td className={`market-cell-numeric ${userTotalGain >= 0 ? "up" : "down"}`}>
          {formatSignedCurrency(userTotalGain)}{" "}
          {userTotalGainPct != null && Number.isFinite(userTotalGainPct) ? `(${formatPercent(userTotalGainPct)})` : ""}
        </td>
      ) : null}
      <td className="market-cell-numeric">{formatCurrency(row.seasonEarnings)}</td>
      {!extraColumnsBeforeEarnings && hasAverageEntry ? (
        <td className="market-cell-numeric">{formatCurrency(averageEntryPrice)}</td>
      ) : null}
      {!extraColumnsBeforeEarnings && hasUserTotalGain ? (
        <td className={`market-cell-numeric ${userTotalGain >= 0 ? "up" : "down"}`}>
          {formatSignedCurrency(userTotalGain)}{" "}
          {userTotalGainPct != null && Number.isFinite(userTotalGainPct) ? `(${formatPercent(userTotalGainPct)})` : ""}
        </td>
      ) : null}
      {combinePositionColumn ? (
        <td className={`market-cell-numeric ${positionClass}`}>{formatNumber(Math.abs(positionValue), 0)}</td>
      ) : (
        <td className="market-cell-numeric">{formatNumber(Math.round(row.sharesHeld))}</td>
      )}
      {combinePositionColumn ? (
        <td className="market-cell-numeric">{formatCurrency(Number(holdingTotalValue ?? 0))}</td>
      ) : (
        <td className="market-cell-numeric">{formatNumber(Math.round(row.sharesShort))}</td>
      )}
      <td className="market-cell-control">
        <div className={`market-row-actions${closeOnlyEnabled ? " market-row-actions-close-only" : ""}`}>
          {closeOnlyEnabled ? (
            <button
              className={`chip market-mini-btn ${
                closeQuickSide === "SELL" ? "market-quick-short-btn" : "market-quick-buy-btn"
              }`}
              onClick={() => {
                if (closeQuickSide) {
                  void handleExecuteMaxTrade(closeQuickSide, closeQuickSize);
                }
              }}
              disabled={isTradingHalted || !closeQuickSide || closeQuickSize <= 0 || isPreviewing || isPlacing}
            >
              {closeQuickSide === "SELL" ? "Sell Max" : "Cover Max"}
            </button>
          ) : (
            <>
              <button
                className="chip market-mini-btn market-quick-buy-btn"
                onClick={() => void handleExecuteMaxTrade("BUY", row.buyRemaining)}
                disabled={isTradingHalted || row.buyRemaining <= 0 || isPreviewing || isPlacing}
              >
                Buy Max
              </button>
              <button
                className="chip market-mini-btn market-quick-short-btn"
                onClick={() => void handleExecuteMaxTrade("SHORT", row.shortRemaining)}
                disabled={isTradingHalted || row.shortRemaining <= 0 || isPreviewing || isPlacing}
              >
                Short Max
              </button>
            </>
          )}
        </div>
      </td>
      <td className="market-cell-control">
        <select
          className="market-side-select"
          value={side}
          onChange={(event) => {
            setSide(event.target.value as MarketTradeSide);
            setQuote(null);
          }}
          disabled={isTradingHalted}
        >
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
          <option value="SHORT">SHORT</option>
          <option value="COVER">COVER</option>
        </select>
      </td>
      <td className="market-qty-cell market-cell-control">
        <input
          className="market-qty-input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={qty}
          onChange={(event) => setQuantity(event.target.value)}
          placeholder="qty"
          disabled={isTradingHalted}
        />
      </td>
      <td className="market-quote-cell">
        {quote ? (
          <div className="market-quote-with-action">
            <div className="market-quote-text">
              <p className="market-quote-main">{isCostSide(side) ? "Cost" : "Net"}: {formatCurrency(quote.total)}</p>
              <p className="market-quote-sub">Avg {formatCurrency(quote.average_price, 3)}</p>
            </div>
            <button
              className={
                side === "SHORT" || side === "SELL"
                  ? "primary-btn short-btn market-quote-action-btn"
                  : "primary-btn market-quote-action-btn"
              }
              disabled={isTradingHalted || isPlacing}
              onClick={() => void handlePlaceTrade()}
            >
              {isPlacing ? "Placing..." : "Execute"}
            </button>
          </div>
        ) : (
          <button
            className="market-quote-action-btn market-quote-preview-btn"
            onClick={() => void handlePreviewTrade()}
            disabled={isTradingHalted || isPreviewing}
          >
            {isPreviewing ? "Quoting..." : "Preview"}
          </button>
        )}
      </td>
    </tr>
  );
}

export default memo(MarketTableRow);
