"""The structured shape every tender is reduced to.

Both extraction engines (Claude and the offline heuristic) must produce this
exact model, so everything downstream — eligibility, risk, pricing, workflow —
is engine-agnostic.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

EvaluationMethod = Literal["LOWEST_PRICE", "QCBS", "QUALITY_ONLY", "UNKNOWN"]
Severity = Literal["LOW", "MEDIUM", "HIGH"]

# Known contractual risk codes, with the weight each carries in the risk score.
RISK_CATALOGUE: dict[str, tuple[str, float]] = {
    "UNLIMITED_LIABILITY": ("Liability is uncapped or exceeds contract value", 22),
    "BROAD_INDEMNITY": ("Indemnity covers indirect / consequential loss", 12),
    "HIGH_LIQUIDATED_DAMAGES": ("Liquidated damages cap above 10% of contract value", 14),
    "NO_PRICE_ADJUSTMENT": ("Fixed price with no escalation / price-variation clause", 10),
    "LONG_PAYMENT_TERMS": ("Payment terms beyond 60 days", 8),
    "TERMINATION_FOR_CONVENIENCE": ("Buyer may terminate for convenience", 6),
    "HIGH_PERFORMANCE_GUARANTEE": ("Performance guarantee above 10%", 8),
    "IP_TRANSFER": ("Full IP / source-code transfer to buyer", 7),
    "SHORT_TIMELINE": ("Delivery timeline unusually aggressive", 9),
    "LOCAL_CONTENT": ("Mandatory local-content / domestic-preference rules", 5),
    "RETENTION_MONEY": ("Retention money withheld from payments", 5),
    "BLACKLISTING_CLAUSE": ("Debarment / blacklisting for non-performance", 6),
}


class EligibilityCriteria(BaseModel):
    min_annual_turnover: float | None = None
    min_net_worth: float | None = None
    min_years_experience: int | None = None
    min_similar_project_value: float | None = None
    required_certifications: list[str] = Field(default_factory=list)


class RiskFlag(BaseModel):
    code: str
    severity: Severity
    evidence: str


class KeyDate(BaseModel):
    label: str
    date: str  # ISO-8601 date


class TenderExtraction(BaseModel):
    summary: str
    reference: str | None = None
    title: str | None = None
    buyer: str | None = None
    sector: str | None = None
    region: str | None = None
    currency: str | None = None
    estimated_value: float | None = None
    submission_deadline: str | None = None
    contract_duration_months: float | None = None
    bid_security_amount: float | None = None
    performance_guarantee_pct: float | None = None
    advance_payment_pct: float | None = None
    retention_pct: float | None = None
    payment_terms_days: int | None = None
    liquidated_damages_cap_pct: float | None = None
    evaluation_method: EvaluationMethod = "UNKNOWN"
    technical_weight_pct: float | None = None
    eligibility: EligibilityCriteria = Field(default_factory=EligibilityCriteria)
    scope_items: list[str] = Field(default_factory=list)
    key_dates: list[KeyDate] = Field(default_factory=list)
    risk_flags: list[RiskFlag] = Field(default_factory=list)
