"use client";

import { formatCurrency, formatPercent, formatSignedPercent } from "@/lib/format";

export type AccountMixSegment = {
  key: string;
  label: string;
  color: string;
  value: number;
  gainLossPct: number | null;
  pct: number;
  startAngle: number;
  endAngle: number;
};

const ACCOUNT_MIX_INNER_RADIUS = 47;
const ACCOUNT_MIX_OUTER_RADIUS = 76;
const ACCOUNT_MIX_RING_WIDTH = ACCOUNT_MIX_OUTER_RADIUS - ACCOUNT_MIX_INNER_RADIUS;
const ACCOUNT_MIX_TRACK_RADIUS = ACCOUNT_MIX_INNER_RADIUS + ACCOUNT_MIX_RING_WIDTH / 2;

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

function describeDonutSegment(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  if (endAngle <= startAngle) return "";
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, startAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

type AccountMixPanelProps = {
  totalValue: number;
  pieSegments: AccountMixSegment[];
  activeSliceKey: string | null;
  onActiveSliceKeyChange: (key: string | null) => void;
};

export default function AccountMixPanel({
  totalValue,
  pieSegments,
  activeSliceKey,
  onActiveSliceKeyChange,
}: AccountMixPanelProps) {
  const activeAccountMixSlice = pieSegments.length
    ? (activeSliceKey ? pieSegments.find((slice) => slice.key === activeSliceKey) : null) ?? pieSegments[0]
    : null;

  return (
    <section className="table-panel account-mix-panel" data-parity-section="account-mix">
      <div className="portfolio-sport-group-head">
        <h3>Account Mix</h3>
        <p className="subtle portfolio-sport-summary">Cash and all open holdings.</p>
      </div>
      <div className="account-mix-layout">
        <div className="account-mix-chart-wrap" onMouseLeave={() => onActiveSliceKeyChange(null)}>
          <svg className="account-mix-donut" viewBox="0 0 200 200" role="img" aria-label="Donut chart showing account mix composition">
            <circle
              className="account-mix-donut-track"
              cx="100"
              cy="100"
              r={ACCOUNT_MIX_TRACK_RADIUS}
              strokeWidth={ACCOUNT_MIX_RING_WIDTH}
            />
            {pieSegments.map((slice) => {
              const path = describeDonutSegment(
                100,
                100,
                ACCOUNT_MIX_INNER_RADIUS,
                ACCOUNT_MIX_OUTER_RADIUS,
                slice.startAngle,
                slice.endAngle,
              );
              const isActive = activeAccountMixSlice?.key === slice.key;
              const isMuted = Boolean(activeAccountMixSlice) && !isActive;
              return (
                <path
                  key={slice.key}
                  d={path}
                  fill={slice.color}
                  className={`account-mix-segment${isActive ? " active" : ""}${isMuted ? " muted" : ""}`}
                  tabIndex={0}
                  onMouseEnter={() => onActiveSliceKeyChange(slice.key)}
                  onFocus={() => onActiveSliceKeyChange(slice.key)}
                  aria-label={`${slice.label}: ${formatCurrency(slice.value)} (${formatPercent(slice.pct, 1)} allocation)${
                    slice.gainLossPct == null ? "" : `, ${formatSignedPercent(slice.gainLossPct, 2)} gain/loss`
                  }`}
                />
              );
            })}
          </svg>
          {activeAccountMixSlice && (
            <div className="account-mix-tooltip" role="status">
              <strong>{activeAccountMixSlice.label}</strong>
              <span>
                {formatCurrency(activeAccountMixSlice.value)} ({formatPercent(activeAccountMixSlice.pct, 1)})
              </span>
            </div>
          )}
          <div className="account-mix-center">
            <span>{activeAccountMixSlice ? activeAccountMixSlice.label : "Total Account"}</span>
            <strong>{formatCurrency(activeAccountMixSlice ? activeAccountMixSlice.value : totalValue)}</strong>
            <span>
              {activeAccountMixSlice ? `${formatPercent(activeAccountMixSlice.pct, 1)} allocation` : "Hover slices for details"}
            </span>
          </div>
        </div>

        <div className="account-mix-legend" onMouseLeave={() => onActiveSliceKeyChange(null)}>
          {pieSegments.map((slice) => {
            const isActive = activeAccountMixSlice?.key === slice.key;
            const isMuted = Boolean(activeAccountMixSlice) && !isActive;
            return (
              <div
                className={`account-mix-row${isActive ? " active" : ""}${isMuted ? " muted" : ""}`}
                key={slice.key}
                tabIndex={0}
                onMouseEnter={() => onActiveSliceKeyChange(slice.key)}
                onFocus={() => onActiveSliceKeyChange(slice.key)}
                aria-label={`${slice.label}: ${formatCurrency(slice.value)} (${formatPercent(slice.pct, 1)} allocation)${
                  slice.gainLossPct == null ? "" : `, ${formatSignedPercent(slice.gainLossPct, 2)} gain/loss`
                }`}
              >
                <span className="account-mix-label">
                  <span className="account-mix-swatch" style={{ background: slice.color }} />
                  <span className="account-mix-name" title={slice.label}>
                    {slice.label}
                  </span>
                </span>
                <strong>{formatCurrency(slice.value)}</strong>
                <span>{formatPercent(slice.pct, 1)}</span>
                <span className={slice.gainLossPct == null ? "account-mix-gl" : `account-mix-gl ${slice.gainLossPct >= 0 ? "up" : "down"}`}>
                  {slice.gainLossPct == null ? "--" : formatSignedPercent(slice.gainLossPct, 2)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
