from pydantic import BaseModel, Field

class PlayerOut(BaseModel):
    id: int
    name: str
    team: str
    position: str
    base_price: float
    k: float
    total_shares: float
    spot_price: float

class PortfolioHolding(BaseModel):
    player_id: int
    shares_owned: float

class PortfolioOut(BaseModel):
    cash_balance: float
    holdings: list[PortfolioHolding]

class TradeIn(BaseModel):
    player_id: int
    shares: float = Field(gt=0)

class TradeOut(BaseModel):
    player_id: int
    shares: float
    unit_price_estimate: float
    total_cost_or_proceeds: float
    new_cash_balance: float
    new_total_shares: float

class StatIn(BaseModel):
    player_id: int
    week: int
    fantasy_points: float = Field(ge=0)

class SettlementOut(BaseModel):
    week: int
    dividends_paid_total: float
    users_credited: int

class QuoteOut(BaseModel):
    player_id: int
    shares: float
    spot_price_before: float
    spot_price_after: float
    average_price: float
    total: float  # buy cost or sell proceeds

