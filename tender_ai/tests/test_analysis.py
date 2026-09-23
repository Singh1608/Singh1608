from datetime import date

from app.cli import sample_text
from app.config import Settings
from app.domain import rules
from app.domain.tender import EligibilityCriteria, TenderExtraction
from app.services.assessment import Capability, assess_compliance, assess_risk
from app.services.forecast import PricingInputs, forecast, simulate
from app.services.heuristic_extractor import extract, parse_date, parse_money
from app.services.win_probability import BidContext, model_for, synthetic_history


def test_parse_money_variants():
    assert parse_money("USD 12.5 million") == (12_500_000, "USD")
    assert parse_money("Rs. 3 crore") == (30_000_000, "INR")
    assert parse_money("value of 4,500,000 EUR") == (4_500_000, "EUR")
    assert parse_money("€750k") == (750_000, "EUR")
    assert parse_money("no money here") is None


def test_parse_date_variants():
    assert parse_date("due 2026-10-15") == date(2026, 10, 15)
    assert parse_date("15th October 2026") == date(2026, 10, 15)
    assert parse_date("October 15, 2026") == date(2026, 10, 15)
    assert parse_date("15/10/2026") == date(2026, 10, 15)


def test_heuristic_extracts_sample_rfp():
    ex = extract(sample_text(date(2026, 1, 1)))
    assert ex.reference == "MTA/ITMS/2026/042"
    assert ex.buyer == "Metropolitan Transport Authority"
    assert ex.estimated_value == 12_500_000 and ex.currency == "USD"
    assert ex.bid_security_amount == 250_000
    assert ex.submission_deadline == "2026-01-31"
    assert ex.contract_duration_months == 78
    assert ex.evaluation_method == "QCBS" and ex.technical_weight_pct == 70
    assert ex.payment_terms_days == 90
    assert ex.liquidated_damages_cap_pct == 10
    assert ex.eligibility.min_annual_turnover == 20_000_000
    assert ex.eligibility.min_years_experience == 7
    assert set(ex.eligibility.required_certifications) == {"ISO 9001", "ISO 27001", "CMMI L3"}
    assert len(ex.scope_items) == 6
    codes = {f.code for f in ex.risk_flags}
    assert {"BROAD_INDEMNITY", "NO_PRICE_ADJUSTMENT", "TERMINATION_FOR_CONVENIENCE",
            "IP_TRANSFER", "LONG_PAYMENT_TERMS"} <= codes


def test_compliance_flags_missing_certification_and_turnover():
    ex = TenderExtraction(summary="", eligibility=EligibilityCriteria(
        min_annual_turnover=50e6, required_certifications=["ISO 27001", "SOC 2"]))
    res = assess_compliance(ex, Capability(annual_turnover=40e6, certifications=("ISO-27001",)))
    assert not res["eligible"]
    assert "Minimum annual turnover" in res["failed"]
    cert = next(c for c in res["checks"] if c["criterion"] == "Required certifications")
    assert cert["missing"] == ["SOC 2"]


def test_risk_score_bands_and_deadline_pressure():
    ex = extract(sample_text())
    r = assess_risk(ex, min_prep_days=7)
    assert 20 < r["score"] < 70
    ex.submission_deadline = date.today().isoformat()
    r2 = assess_risk(ex, min_prep_days=7)
    assert r2["score"] > r["score"]
    assert r2["items"][0]["code"] in {"BID_PREPARATION_TIME", "BROAD_INDEMNITY"}


def test_win_probability_falls_as_price_rises():
    m = model_for([])
    assert m.source == "industry_prior"
    probs = [m.predict(BidContext(price_ratio=r))["probability"] for r in (0.85, 1.0, 1.15)]
    assert probs[0] > probs[1] > probs[2]
    lowest = m.predict(BidContext(price_ratio=1.1, lowest_price_award=True))["probability"]
    assert lowest < probs[2] + 0.05  # price-driven awards punish a high price harder


def test_org_history_replaces_prior_when_sufficient():
    history = synthetic_history(n=200, seed=1)
    m = model_for(history)
    assert m.source == "org_history" and m.n_samples == 200


def test_simulation_loss_probability_rises_as_margin_falls():
    p = PricingInputs(direct_cost=1_000_000, risk_score=40, runs=2000)
    thin, fat = simulate(p, 1_050_000), simulate(p, 1_400_000)
    assert thin["probability_of_loss"] > fat["probability_of_loss"]
    assert fat["p10"] < fat["p50"] < fat["p90"]


def test_optimiser_respects_loss_limit_and_maximises_ev():
    p = PricingInputs(direct_cost=1_000_000, risk_score=30, runs=1500, bid_preparation_cost=10_000)
    fc = forecast(p, lambda price: max(0.0, 1.6 - price / 1_000_000), 0.2, 1_300_000)
    rec = fc["price_optimisation"]["recommended"]
    assert rec["probability_of_loss"] <= 0.2
    admissible = [c for c in fc["price_optimisation"]["curve"] if c["probability_of_loss"] <= 0.2]
    assert rec["expected_value"] == max(c["expected_value"] for c in admissible)
    assert fc["evaluated_price"]["price"] == rec["price"]


def test_recommendation_hard_stop_and_approval_matrix():
    s = Settings()
    compliance = {"eligible": False, "failed": ["Minimum net worth"], "warnings": [], "not_stated": []}
    risk = {"score": 20, "band": "LOW", "items": [], "days_to_deadline": 30}
    rec = rules.recommend(compliance, risk, {"probability": 0.6}, None, 0, 10, s)
    assert rec["decision"] == "NO_BID"

    roles = [r for r, _ in rules.required_approvals(12e6, {"score": 55, "items": []}, s)]
    assert roles == ["finance", "executive", "legal"]
    roles = [r for r, _ in rules.required_approvals(200_000, {"score": 10, "items": []}, s)]
    assert roles == ["bid_manager"]
