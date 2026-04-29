"use client";

import { formatCurrency, formatNumber } from "@/lib/format";
import type { Quote } from "@/lib/types";

export type TradeDirection = "BUY" | "SELL" | "SHORT" | "COVER";

type TradePreviewProps = {
  playerName: string;
  side: TradeDirection;
  quote: Quote;
};

type ConfirmTradeModalProps = TradePreviewProps & {
  open: boolean;
  busy: boolean;
  successMessage?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

const SIDE_COPY: Record<TradeDirection, { label: string; verb: string; totalLabel: string }> = {
  BUY: { label: "Buy", verb: "buy", totalLabel: "Estimated cost" },
  SELL: { label: "Sell", verb: "sell", totalLabel: "Estimated proceeds" },
  SHORT: { label: "Short", verb: "short", totalLabel: "Estimated cost" },
  COVER: { label: "Cover", verb: "cover", totalLabel: "Estimated proceeds" },
};

export function isCostSide(side: TradeDirection): boolean {
  return side === "BUY" || side === "SHORT";
}

export function tradeSideLabel(side: TradeDirection): string {
  return SIDE_COPY[side].label;
}

export function tradeActionClass(side: TradeDirection): string {
  return side === "BUY" || side === "COVER" ? "trade-action-positive" : "trade-action-negative";
}

export function TradePreview({ playerName, side, quote }: TradePreviewProps) {
  const copy = SIDE_COPY[side];
  return (
    <div className="trade-preview-card">
      <div className="trade-preview-line">
        <span>Player</span>
        <strong>{playerName}</strong>
      </div>
      <div className="trade-preview-line">
        <span>Action</span>
        <strong>{copy.label}</strong>
      </div>
      <div className="trade-preview-line">
        <span>Shares</span>
        <strong>{formatNumber(quote.shares, 0)}</strong>
      </div>
      <div className="trade-preview-line">
        <span>Estimated average price</span>
        <strong>{formatCurrency(quote.average_price, 3)}</strong>
      </div>
      <div className="trade-preview-line trade-preview-total">
        <span>{copy.totalLabel}</span>
        <strong>{formatCurrency(quote.total)}</strong>
      </div>
      <div className="trade-preview-line">
        <span>Price before</span>
        <strong>{formatCurrency(quote.spot_price_before)}</strong>
      </div>
      <div className="trade-preview-line">
        <span>Estimated price after</span>
        <strong>{formatCurrency(quote.spot_price_after)}</strong>
      </div>
    </div>
  );
}

export default function ConfirmTradeModal({
  open,
  playerName,
  side,
  quote,
  busy,
  successMessage,
  onCancel,
  onConfirm,
}: ConfirmTradeModalProps) {
  if (!open) return null;

  const copy = SIDE_COPY[side];
  return (
    <div className="trade-modal-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <section
        className="trade-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        {successMessage ? (
          <>
            <h3 id="trade-confirm-title">Trade Complete</h3>
            <p className="success-box" role="status">{successMessage}</p>
            <button type="button" className="primary-btn full" onClick={onCancel}>
              Done
            </button>
          </>
        ) : (
          <>
            <h3 id="trade-confirm-title">Confirm {copy.label}</h3>
            <p className="subtle">
              You are about to {copy.verb} {formatNumber(quote.shares, 0)} shares of {playerName}.
              Review the estimate before placing the trade.
            </p>
            <TradePreview playerName={playerName} side={side} quote={quote} />
            <div className="trade-modal-actions">
              <button type="button" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className={`primary-btn ${tradeActionClass(side)}`}
                onClick={onConfirm}
                disabled={busy}
              >
                {busy ? "Placing..." : `Confirm ${copy.label}`}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
