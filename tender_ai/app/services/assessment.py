"""Eligibility (compliance) and contractual-risk assessment."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..domain.tender import RISK_CATALOGUE, TenderExtraction
from .heuristic_extractor import days_until

SEVERITY_FACTOR = {"LOW": 0.5, "MEDIUM": 0.8, "HIGH": 1.0}


@dataclass
class Capability:
    """The bidder's provable credentials (mirrors models.CompanyProfile)."""

    annual_turnover: float = 0
    net_worth: float = 0
    years_in_business: int = 0
    largest_similar_project: float = 0
    certifications: tuple[str, ...] = ()
    sectors: tuple[str, ...] = ()
    regions: tuple[str, ...] = ()
    available_bank_guarantee_limit: float = 0


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _check(name: str, required: float | None, actual: float) -> dict[str, Any]:
    if required is None:
        return {"criterion": name, "status": "NOT_STATED", "required": None, "actual": actual}
    ok = actual >= required
    return {
        "criterion": name,
        "status": "PASS" if ok else "FAIL",
        "required": required,
        "actual": actual,
        "headroom": round(actual / required, 2) if required else None,
    }


def assess_compliance(ex: TenderExtraction, cap: Capability) -> dict[str, Any]:
    el = ex.eligibility
    checks = [
        _check("Minimum annual turnover", el.min_annual_turnover, cap.annual_turnover),
        _check("Minimum net worth", el.min_net_worth, cap.net_worth),
        _check("Years of experience", el.min_years_experience, cap.years_in_business),
        _check("Similar project value", el.min_similar_project_value, cap.largest_similar_project),
    ]

    held = {_norm(c) for c in cap.certifications}
    missing = [c for c in el.required_certifications if _norm(c) not in held]
    checks.append({
        "criterion": "Required certifications",
        "status": "NOT_STATED" if not el.required_certifications else ("FAIL" if missing else "PASS"),
        "required": el.required_certifications,
        "actual": list(cap.certifications),
        "missing": missing,
    })

    # Guarantees tie up bank lines; a bid we cannot secure is not biddable.
    gtee = (ex.bid_security_amount or 0) + (
        (ex.performance_guarantee_pct or 0) / 100 * (ex.estimated_value or 0)
    )
    if gtee:
        checks.append({
            "criterion": "Bank guarantee capacity",
            "status": "PASS" if gtee <= cap.available_bank_guarantee_limit else "FAIL",
            "required": round(gtee, 2),
            "actual": cap.available_bank_guarantee_limit,
        })

    soft = []
    if ex.sector and cap.sectors and not any(_norm(s) in _norm(ex.sector) or _norm(ex.sector) in _norm(s) for s in cap.sectors):
        soft.append(f"Sector '{ex.sector}' is outside the company's core sectors")
    if ex.region and cap.regions and not any(_norm(r) in _norm(ex.region) or _norm(ex.region) in _norm(r) for r in cap.regions):
        soft.append(f"Region '{ex.region}' is outside the company's operating regions")

    failed = [c["criterion"] for c in checks if c["status"] == "FAIL"]
    unknown = [c["criterion"] for c in checks if c["status"] == "NOT_STATED"]
    headrooms = [c["headroom"] for c in checks if c.get("headroom")]
    return {
        "eligible": not failed,
        "failed": failed,
        "not_stated": unknown,
        "checks": checks,
        "warnings": soft,
        "sector_match": not any("Sector" in w for w in soft),
        # Weakest margin over any quantified threshold; 3.0 = comfortably clear.
        "eligibility_margin": min(min(headrooms), 3.0) if headrooms else 1.5,
    }


def assess_risk(ex: TenderExtraction, min_prep_days: int) -> dict[str, Any]:
    items = []
    seen: set[str] = set()
    score = 0.0
    for flag in ex.risk_flags:
        if flag.code in seen:
            continue
        seen.add(flag.code)
        desc, weight = RISK_CATALOGUE.get(flag.code, (flag.code.replace("_", " ").title(), 5))
        pts = weight * SEVERITY_FACTOR[flag.severity]
        score += pts
        items.append({"code": flag.code, "description": desc, "severity": flag.severity,
                      "points": round(pts, 1), "evidence": flag.evidence})

    days = days_until(ex.submission_deadline)
    if days is not None and days < min_prep_days * 2:
        pts = 12 if days < min_prep_days else 6
        score += pts
        items.append({"code": "BID_PREPARATION_TIME", "description": f"{days} days to prepare the bid",
                      "severity": "HIGH" if days < min_prep_days else "MEDIUM", "points": pts,
                      "evidence": f"Deadline {ex.submission_deadline}"})

    if not ex.estimated_value:
        score += 4
        items.append({"code": "VALUE_NOT_DISCLOSED", "description": "Estimated value not disclosed",
                      "severity": "LOW", "points": 4, "evidence": ""})

    score = round(min(score, 100.0), 1)
    band = "LOW" if score < 30 else "MEDIUM" if score < 60 else "HIGH"
    items.sort(key=lambda i: -i["points"])
    return {"score": score, "band": band, "items": items, "days_to_deadline": days}
