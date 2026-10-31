from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TenderCreate(BaseModel):
    text: str = Field(min_length=50, description="Full tender document text")
    title: str | None = None
    reference: str | None = None
    buyer: str | None = None
    sector: str | None = None
    region: str | None = None


class BidContextIn(BaseModel):
    technical_score: float = Field(0.7, ge=0, le=1, description="Expected technical score 0-1")
    competitors: int = Field(5, ge=1, le=100)
    incumbent: bool = False
    buyer_relationship: float | None = Field(
        None, ge=0, le=1, description="Override; default derived from past outcomes with this buyer"
    )


class PricingIn(BaseModel):
    direct_cost: float = Field(gt=0)
    bid_price: float | None = Field(None, gt=0)
    overhead_pct: float | None = Field(None, ge=0, le=1)
    contingency_pct: float | None = Field(None, ge=0, le=1)
    bid_preparation_cost: float = Field(0, ge=0)
    tax_rate: float = Field(0, ge=0, le=0.6)
    cost_of_capital: float | None = Field(None, ge=0, le=1)
    contract_months: float | None = Field(None, gt=0)
    payment_terms_days: int | None = Field(None, ge=0, le=730)


class AnalyzeRequest(BaseModel):
    use_llm: bool = True
    reuse_extraction: bool = Field(
        False, description="Re-run scoring and forecasting on the latest extraction (no AI call)"
    )
    bid_context: BidContextIn = Field(default_factory=BidContextIn)
    pricing: PricingIn | None = None


class ActionRequest(BaseModel):
    comment: str | None = None
    decision: Literal["bid", "no_bid"] | None = None
    outcome: Literal["won", "lost"] | None = None
    bid_price: float | None = Field(None, gt=0)
    winning_price: float | None = Field(None, gt=0)


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    role_required: str
    reason: str
    decision: str
    decided_by: int | None
    comment: str | None
    decided_at: datetime | None


class AnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    engine: str
    model: str | None
    summary: str
    extraction: dict[str, Any]
    compliance: dict[str, Any]
    risk: dict[str, Any]
    win: dict[str, Any] | None
    forecast: dict[str, Any] | None
    recommendation: dict[str, Any] | None
    created_at: datetime


class TenderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str | None
    title: str
    buyer: str | None
    sector: str | None
    region: str | None
    currency: str
    estimated_value: float | None
    submission_deadline: datetime | None
    status: str
    bid_price: float | None
    version: int
    created_at: datetime
    updated_at: datetime


class TenderDetail(TenderOut):
    latest_analysis: AnalysisOut | None = None
    approvals: list[ApprovalOut] = []
    allowed_actions: list[str] = []


class CompanyProfileIO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    annual_turnover: float = 0
    net_worth: float = 0
    years_in_business: int = 0
    largest_similar_project: float = 0
    certifications: list[str] = []
    sectors: list[str] = []
    regions: list[str] = []
    max_concurrent_bids: int = 10
    available_bank_guarantee_limit: float = 0


class HistoricalBidIn(BaseModel):
    features: dict[str, float]
    won: bool


class UserCreate(BaseModel):
    name: str
    email: str
    role: Literal["viewer", "analyst", "bid_manager", "finance", "legal", "executive", "admin"]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    role: str
    active: bool
