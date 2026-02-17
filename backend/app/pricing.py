from decimal import Decimal

def spot_price(base_price: Decimal, k: Decimal, total_shares: Decimal) -> Decimal:
    """Linear bonding curve: P(S) = base_price * (1 + k * S)"""
    return base_price * (Decimal(1) + k * total_shares)

def cost_to_buy(base_price: Decimal, k: Decimal, total_shares: Decimal, qty: Decimal) -> Decimal:
    """Cost = ∫ P(S) dS from S to S+qty"""
    s0 = total_shares
    s1 = total_shares + qty
    return base_price * (qty + (k / Decimal(2)) * (s1*s1 - s0*s0))

def proceeds_to_sell(base_price: Decimal, k: Decimal, total_shares: Decimal, qty: Decimal) -> Decimal:
    """Proceeds = ∫ P(S) dS from S-qty to S"""
    if qty > total_shares:
        qty = total_shares
    s0 = total_shares - qty
    s1 = total_shares
    return base_price * (qty + (k / Decimal(2)) * (s1*s1 - s0*s0))
