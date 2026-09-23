"""End-to-end tender analysis: extract → assess → predict → forecast → recommend."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..domain import rules
from ..domain.tender import TenderExtraction
from ..models import CompanyProfile, HistoricalBid, Tender, TenderAnalysis, User
from ..schemas import AnalyzeRequest
from . import heuristic_extractor, llm
from .assessment import Capability, assess_compliance, assess_risk
from .forecast import PricingInputs, forecast
from .win_probability import BidContext, model_for

log = logging.getLogger(__name__)

PIPELINE_STATES = ("PRICING", "PENDING_APPROVAL", "APPROVED")


def extract(text: str, use_llm: bool) -> tuple[TenderExtraction, str, str | None, str | None]:
    """Returns (extraction, engine, model, fallback_reason)."""
    if use_llm:
        try:
            return llm.extract_with_claude(text), "claude", get_settings().anthropic_model, None
        except llm.LLMUnavailable as e:
            log.info("LLM extraction unavailable, using heuristic: %s", e)
            reason = str(e)
    else:
        reason = "LLM not requested"
    return heuristic_extractor.extract(text), "heuristic", None, reason


def capability(profile: CompanyProfile | None) -> Capability:
    if not profile:
        return Capability()
    return Capability(
        annual_turnover=profile.annual_turnover, net_worth=profile.net_worth,
        years_in_business=profile.years_in_business,
        largest_similar_project=profile.largest_similar_project,
        certifications=tuple(profile.certifications or ()), sectors=tuple(profile.sectors or ()),
        regions=tuple(profile.regions or ()),
        available_bank_guarantee_limit=profile.available_bank_guarantee_limit,
    )


def buyer_relationship(db: Session, tender: Tender) -> float:
    if not tender.buyer:
        return 0.0
    rows = db.execute(
        select(Tender.status, func.count()).where(
            Tender.org_id == tender.org_id, Tender.buyer == tender.buyer,
            Tender.id != tender.id, Tender.status.in_(("WON", "LOST")),
        ).group_by(Tender.status)
    ).all()
    counts = dict(rows)
    won, total = counts.get("WON", 0), counts.get("WON", 0) + counts.get("LOST", 0)
    # Shrink towards zero: one win out of one bid is not a strong relationship.
    return round(won / (total + 2), 3)


def org_history(db: Session, org_id: int) -> list[tuple[dict[str, float], bool]]:
    return [(h.features, h.won) for h in db.scalars(
        select(HistoricalBid).where(HistoricalBid.org_id == org_id)
    )]


def _apply_extraction(tender: Tender, ex: TenderExtraction) -> None:
    """Fill tender header fields the user left blank. User input wins."""
    tender.title = tender.title or ex.title or "Untitled tender"
    for attr in ("reference", "buyer", "sector", "region"):
        if not getattr(tender, attr) and getattr(ex, attr):
            setattr(tender, attr, getattr(ex, attr)[:300])
    if ex.currency:
        tender.currency = ex.currency
    if ex.estimated_value and not tender.estimated_value:
        tender.estimated_value = ex.estimated_value
    if ex.submission_deadline and not tender.submission_deadline:
        try:
            d = datetime.fromisoformat(ex.submission_deadline)
            tender.submission_deadline = d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            pass


def run(db: Session, tender: Tender, user: User, req: AnalyzeRequest) -> TenderAnalysis:
    s = get_settings()
    previous = tender.analyses[-1] if tender.analyses else None

    if req.reuse_extraction and previous:
        ex = TenderExtraction.model_validate(previous.extraction)
        engine, model, fallback = previous.engine, previous.model, None
    else:
        ex, engine, model, fallback = extract(tender.source_text, req.use_llm)
    _apply_extraction(tender, ex)

    profile = db.scalar(select(CompanyProfile).where(CompanyProfile.org_id == tender.org_id))
    compliance = assess_compliance(ex, capability(profile))
    risk = assess_risk(ex, s.min_days_to_prepare)

    bc = req.bid_context
    base_ctx = dict(
        lowest_price_award=ex.evaluation_method == "LOWEST_PRICE",
        technical_score=bc.technical_score, competitors=bc.competitors, incumbent=bc.incumbent,
        buyer_relationship=bc.buyer_relationship if bc.buyer_relationship is not None
        else buyer_relationship(db, tender),
        sector_match=compliance["sector_match"],
        eligibility_margin=compliance["eligibility_margin"],
        risk_score=risk["score"] / 100,
    )
    model_ = model_for(org_history(db, tender.org_id))

    fc = None
    reference_value = tender.estimated_value
    if req.pricing:
        pr = req.pricing
        inputs = PricingInputs(
            direct_cost=pr.direct_cost, bid_price=pr.bid_price,
            overhead_pct=pr.overhead_pct if pr.overhead_pct is not None else s.corporate_overhead_pct,
            contingency_pct=pr.contingency_pct,
            contract_months=pr.contract_months or ex.contract_duration_months or 12,
            payment_terms_days=pr.payment_terms_days if pr.payment_terms_days is not None
            else (ex.payment_terms_days or 45),
            advance_payment_pct=ex.advance_payment_pct or 0,
            retention_pct=ex.retention_pct or 0,
            performance_guarantee_pct=ex.performance_guarantee_pct or 0,
            bid_security=ex.bid_security_amount or 0,
            ld_cap_pct=ex.liquidated_damages_cap_pct if ex.liquidated_damages_cap_pct is not None else 5,
            cost_of_capital=pr.cost_of_capital if pr.cost_of_capital is not None else s.cost_of_capital,
            bg_commission=s.bank_guarantee_commission,
            bid_preparation_cost=pr.bid_preparation_cost, tax_rate=pr.tax_rate,
            risk_score=risk["score"], runs=s.monte_carlo_runs,
        )
        # Without a published estimate, assume the market clears ~15% over our cost base.
        if not reference_value:
            reference_value = pr.direct_cost * (1 + inputs.overhead_pct) * 1.15

        def win_at(price: float) -> float:
            return model_.predict(BidContext(price_ratio=price / reference_value, **base_ctx))["probability"]

        fc = forecast(inputs, win_at, s.max_loss_probability, tender.estimated_value)
        fc["reference_value"] = round(reference_value, 2)
        fc["reference_value_assumed"] = not tender.estimated_value

    price_for_win = (fc["evaluated_price"]["price"] if fc else tender.bid_price) or reference_value
    ratio = price_for_win / reference_value if (price_for_win and reference_value) else 1.0
    win = model_.predict(BidContext(price_ratio=ratio, **base_ctx))
    win["assumptions"] = {**base_ctx, "price_ratio": round(ratio, 3)}

    active = db.scalar(select(func.count()).select_from(Tender).where(
        Tender.org_id == tender.org_id, Tender.status.in_(PIPELINE_STATES), Tender.id != tender.id,
    )) or 0
    rec = rules.recommend(compliance, risk, win, fc, active,
                          profile.max_concurrent_bids if profile else 10, s)

    analysis = TenderAnalysis(
        tender=tender, engine=engine, model=model, summary=ex.summary,
        extraction={**ex.model_dump(), "_fallback_reason": fallback},
        compliance=compliance, risk=risk, win=win, forecast=fc, recommendation=rec,
        created_by=user.id,
    )
    db.add(analysis)
    if tender.status == "INTAKE":
        tender.status = "ANALYZED"
    db.flush()
    audit.record(db, user, "tender", tender.id, "analyze", {
        "analysis_id": analysis.id, "engine": engine, "decision": rec["decision"],
        "win_probability": win["probability"], "risk_score": risk["score"],
    })
    return analysis
