import os
from decimal import Decimal


PRICE_IMPACT_MULTIPLIER = max(
    Decimal("0.000001"),
    Decimal(os.environ.get("PRICE_IMPACT_MULTIPLIER", "0.2")),
)


def effective_k(k: Decimal) -> Decimal:
    return k * PRICE_IMPACT_MULTIPLIER


def spot_price(base_price: Decimal, k: Decimal, total_shares: Decimal) -> Decimal:
    """Linear bonding curve: P(S) = base_price * (1 + k * S)."""
    ke = effective_k(k)
    return base_price * (Decimal(1) + ke * total_shares)


def cost_to_buy(base_price: Decimal, k: Decimal, total_shares: Decimal, qty: Decimal) -> Decimal:
    """Cost = integral of P(S) dS from S to S+qty."""
    ke = effective_k(k)
    s0 = total_shares
    s1 = total_shares + qty
    return base_price * (qty + (ke / Decimal(2)) * (s1 * s1 - s0 * s0))


def proceeds_to_sell(base_price: Decimal, k: Decimal, total_shares: Decimal, qty: Decimal) -> Decimal:
    """Proceeds = integral of P(S) dS from S-qty to S."""
    if qty <= 0:
        return Decimal("0")
    ke = effective_k(k)
    s0 = total_shares - qty
    s1 = total_shares
    return base_price * (qty + (ke / Decimal(2)) * (s1 * s1 - s0 * s0))


def adjusted_base_price(
    projected_points: Decimal,
    points_to_date: Decimal,
    latest_week: int,
    season_weeks: int,
    performance_weight: Decimal,
) -> Decimal:
    """
    Fair-value anchor model:
    - Starts at projected season points (week 0)
    - Moves with in-season over/under-performance relative to projection pace
    - Converges toward final season points as weeks progress
    """
    safe_weeks = max(1, season_weeks)
    clamped_week = min(max(latest_week, 0), safe_weeks)
    expected_to_date = projected_points * Decimal(clamped_week) / Decimal(safe_weeks)
    delta = points_to_date - expected_to_date
    fair_value = projected_points + (performance_weight * delta)
    return max(fair_value, Decimal("1"))
