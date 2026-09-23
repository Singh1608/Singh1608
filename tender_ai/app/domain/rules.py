"""Business policy: bid/no-bid recommendation and delegation of authority.

AI outputs are advisory. The recommendation below is a rule-based synthesis
that a person must still act on through the workflow; nothing here submits
a bid on its own.
"""

from __future__ import annotations

from typing import Any

from ..config import Settings


def recommend(
    compliance: dict[str, Any],
    risk: dict[str, Any],
    win: dict[str, Any] | None,
    forecast: dict[str, Any] | None,
    active_bids: int,
    max_concurrent_bids: int,
    s: Settings,
) -> dict[str, Any]:
    hard: list[str] = []
    soft: list[str] = []
    strengths: list[str] = []

    if not compliance["eligible"]:
        hard.append("Fails mandatory eligibility: " + ", ".join(compliance["failed"]))
    days = risk.get("days_to_deadline")
    if days is not None and days < 0:
        hard.append("Submission deadline has passed")
    elif days is not None and days < s.min_days_to_prepare:
        hard.append(f"Only {days} days to deadline (policy minimum {s.min_days_to_prepare})")
    if active_bids >= max_concurrent_bids:
        hard.append(f"Bid team at capacity ({active_bids}/{max_concurrent_bids} active bids)")

    if risk["score"] > s.max_risk_score:
        soft.append(f"Contract risk {risk['score']} exceeds appetite ({s.max_risk_score})")
    elif risk["band"] == "LOW":
        strengths.append("Low contractual risk")
    soft += compliance.get("warnings", [])
    if compliance.get("not_stated"):
        soft.append("Eligibility criteria not found in document: " + ", ".join(compliance["not_stated"]))

    if win:
        pw = win["probability"]
        if forecast:
            pw = forecast["win_probability_at_price"]
        if pw < s.min_win_probability:
            soft.append(f"Win probability {pw:.0%} below threshold {s.min_win_probability:.0%}")
        elif pw >= 0.5:
            strengths.append(f"Strong win probability ({pw:.0%})")

    if forecast:
        ev = forecast["evaluated_price"]
        margin = ev["expected_margin_pct"] / 100
        if margin < s.min_expected_margin:
            soft.append(f"Expected margin {margin:.1%} below hurdle {s.min_expected_margin:.0%}")
        else:
            strengths.append(f"Expected margin {margin:.1%}")
        if ev["probability_of_loss"] > s.max_loss_probability:
            soft.append(f"Probability of loss {ev['probability_of_loss']:.0%} above limit "
                        f"{s.max_loss_probability:.0%}")
    else:
        soft.append("No cost estimate yet: profitability not assessed")

    # Hard stops are not overridable by the bid manager (see workflow).
    decision = "NO_BID" if hard else "REVIEW" if soft else "BID"
    return {"decision": decision, "hard_stops": hard, "concerns": soft, "strengths": strengths}


def required_approvals(
    contract_value: float, risk: dict[str, Any], s: Settings
) -> list[tuple[str, str]]:
    """Delegation-of-authority matrix -> [(role, reason)]."""
    out: list[tuple[str, str]] = []
    if contract_value >= s.doa_finance_threshold:
        out.append(("finance", f"Bid value ≥ {s.doa_finance_threshold:,.0f}"))
    else:
        out.append(("bid_manager", "Standard bid sign-off (below finance threshold)"))
    if contract_value >= s.doa_executive_threshold:
        out.append(("executive", f"Bid value ≥ {s.doa_executive_threshold:,.0f}"))
    codes = {i["code"] for i in risk.get("items", [])}
    if risk.get("score", 0) >= s.legal_review_risk_threshold or "UNLIMITED_LIABILITY" in codes:
        out.append(("legal", "Elevated contractual risk"))
    return out
