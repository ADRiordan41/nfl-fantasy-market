import os
from decimal import Decimal


PRICE_IMPACT_MULTIPLIER = max(
    Decimal("0.000001"),
    Decimal(os.environ.get("PRICE_IMPACT_MULTIPLIER", "0.2")),
)
BASE_SPREAD_PCT = max(
    Decimal("0.0005"),
    Decimal(os.environ.get("BASE_SPREAD_PCT", "0.012")),
)
LIVE_SPREAD_MULTIPLIER = max(
    Decimal("1"),
    Decimal(os.environ.get("LIVE_SPREAD_MULTIPLIER", "1.35")),
)
VOLATILITY_SPREAD_MULTIPLIER = max(
    Decimal("0"),
    Decimal(os.environ.get("VOLATILITY_SPREAD_MULTIPLIER", "0.35")),
)
MAX_TOTAL_SPREAD_PCT = max(
    BASE_SPREAD_PCT,
    Decimal(os.environ.get("MAX_TOTAL_SPREAD_PCT", "0.08")),
)
LIQUIDITY_REFERENCE_PRICE = max(
    Decimal("1"),
    Decimal(os.environ.get("LIQUIDITY_REFERENCE_PRICE", "180")),
)
MIN_LIQUIDITY_MULTIPLIER = max(
    Decimal("0.25"),
    Decimal(os.environ.get("MIN_LIQUIDITY_MULTIPLIER", "0.75")),
)
MAX_LIQUIDITY_MULTIPLIER = max(
    MIN_LIQUIDITY_MULTIPLIER,
    Decimal(os.environ.get("MAX_LIQUIDITY_MULTIPLIER", "1.85")),
)
LIVE_IMPACT_MULTIPLIER = max(
    Decimal("1"),
    Decimal(os.environ.get("LIVE_IMPACT_MULTIPLIER", "1.2")),
)
RECENT_FORM_WINDOW = max(1, int(os.environ.get("RECENT_FORM_WINDOW", "3")))
RECENT_FORM_WEIGHT = max(
    Decimal("0"),
    min(Decimal("0.6"), Decimal(os.environ.get("RECENT_FORM_WEIGHT", "0.22"))),
)
LIVE_POINTS_WEIGHT = max(
    Decimal("0"),
    Decimal(os.environ.get("LIVE_POINTS_WEIGHT", "1.0")),
)
MIN_PROJECTED_WEIGHT = max(
    Decimal("0"),
    min(Decimal("1"), Decimal(os.environ.get("MIN_PROJECTED_WEIGHT", "0.18"))),
)


def liquidity_multiplier(anchor_price: Decimal) -> Decimal:
    safe_anchor = max(anchor_price, Decimal("1"))
    ratio = safe_anchor / LIQUIDITY_REFERENCE_PRICE
    multiplier = ratio.sqrt() if ratio > 0 else Decimal("1")
    return min(MAX_LIQUIDITY_MULTIPLIER, max(MIN_LIQUIDITY_MULTIPLIER, multiplier))

def effective_k(
    k: Decimal,
    anchor_price: Decimal | None = None,
    *,
    live_now: bool = False,
) -> Decimal:
    liquidity = liquidity_multiplier(anchor_price if anchor_price is not None else Decimal("100"))
    live_multiplier = LIVE_IMPACT_MULTIPLIER if live_now else Decimal("1")
    return (k * PRICE_IMPACT_MULTIPLIER * live_multiplier) / liquidity


def spread_percentage(
    *,
    anchor_price: Decimal,
    reference_price: Decimal,
    live_now: bool = False,
) -> Decimal:
    liquidity = liquidity_multiplier(anchor_price)
    safe_reference = max(reference_price, Decimal("1"))
    volatility = abs(anchor_price - safe_reference) / safe_reference
    spread = (BASE_SPREAD_PCT / liquidity) + (volatility * VOLATILITY_SPREAD_MULTIPLIER)
    if live_now:
        spread *= LIVE_SPREAD_MULTIPLIER
    return min(MAX_TOTAL_SPREAD_PCT, max(Decimal("0.0005"), spread))


def spot_price(
    base_price: Decimal,
    k: Decimal,
    total_shares: Decimal,
    *,
    live_now: bool = False,
) -> Decimal:
    """Mid price from fair value plus inventory/order-flow pressure."""
    ke = effective_k(k, base_price, live_now=live_now)
    return max(Decimal("0.000001"), base_price * (Decimal(1) + ke * total_shares))


def cost_to_buy(
    base_price: Decimal,
    k: Decimal,
    total_shares: Decimal,
    qty: Decimal,
    *,
    live_now: bool = False,
    spread_pct: Decimal | None = None,
) -> Decimal:
    """Cost = integral of mid price from S to S+qty, then paid at ask."""
    ke = effective_k(k, base_price, live_now=live_now)
    s0 = total_shares
    s1 = total_shares + qty
    mid_cost = base_price * (qty + (ke / Decimal(2)) * (s1 * s1 - s0 * s0))
    if spread_pct is None or spread_pct <= 0:
        return mid_cost
    return mid_cost * (Decimal("1") + (spread_pct / Decimal("2")))


def proceeds_to_sell(
    base_price: Decimal,
    k: Decimal,
    total_shares: Decimal,
    qty: Decimal,
    *,
    live_now: bool = False,
    spread_pct: Decimal | None = None,
) -> Decimal:
    """Proceeds = integral of mid price from S-qty to S, then sold at bid."""
    if qty <= 0:
        return Decimal("0")
    ke = effective_k(k, base_price, live_now=live_now)
    s0 = total_shares - qty
    s1 = total_shares
    mid_proceeds = base_price * (qty + (ke / Decimal(2)) * (s1 * s1 - s0 * s0))
    if spread_pct is None or spread_pct <= 0:
        return mid_proceeds
    return mid_proceeds * (Decimal("1") - (spread_pct / Decimal("2")))


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


def recent_form_anchor(
    *,
    projected_points: Decimal,
    recent_points: Decimal,
    recent_sample_size: int,
    season_weeks: int,
    performance_weight: Decimal,
) -> Decimal:
    if recent_sample_size <= 0:
        return max(projected_points, Decimal("1"))
    safe_weeks = max(1, season_weeks)
    expected_recent = projected_points * Decimal(recent_sample_size) / Decimal(safe_weeks)
    recent_delta = recent_points - expected_recent
    return max(Decimal("1"), projected_points + (performance_weight * recent_delta))


def blended_fair_value(
    *,
    projected_points: Decimal,
    season_anchor: Decimal,
    recent_anchor: Decimal,
    latest_week: int,
    season_weeks: int,
) -> Decimal:
    safe_weeks = max(1, season_weeks)
    progress = min(Decimal("1"), max(Decimal("0"), Decimal(latest_week) / Decimal(safe_weeks)))
    recent_weight = RECENT_FORM_WEIGHT
    season_weight = (Decimal("1") - recent_weight) * progress
    projected_weight = max(MIN_PROJECTED_WEIGHT, Decimal("1") - season_weight - recent_weight)
    total_weight = projected_weight + season_weight + recent_weight
    if total_weight <= 0:
        return max(projected_points, Decimal("1"))
    fair_value = (
        (projected_points * projected_weight)
        + (season_anchor * season_weight)
        + (recent_anchor * recent_weight)
    ) / total_weight
    return max(fair_value, Decimal("1"))
