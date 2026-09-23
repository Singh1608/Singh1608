"""Offline, deterministic tender extractor.

Used when no LLM is configured, when the LLM call fails, and as a
cross-check on LLM output. It is pattern-based, so it favours precision over
recall: a field it cannot find confidently is left ``None`` rather than
guessed, and the eligibility check treats ``None`` as "not stated".
"""

from __future__ import annotations

import re
from datetime import date, datetime

from ..domain.tender import (
    EligibilityCriteria,
    KeyDate,
    RiskFlag,
    TenderExtraction,
)

_CURRENCY_TOKENS = {
    "$": "USD", "usd": "USD", "us$": "USD", "€": "EUR", "eur": "EUR", "£": "GBP",
    "gbp": "GBP", "₹": "INR", "inr": "INR", "rs": "INR", "rs.": "INR", "aed": "AED",
    "sar": "SAR", "pln": "PLN", "zł": "PLN", "aud": "AUD", "cad": "CAD", "sgd": "SGD",
}
_MULTIPLIERS = {
    "k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "million": 1e6, "b": 1e9,
    "bn": 1e9, "billion": 1e9, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "crore": 1e7,
    "crores": 1e7, "cr": 1e7,
}

_CUR = r"(?P<cur>us\$|\$|€|£|₹|usd|eur|gbp|inr|rs\.?|aed|sar|pln|zł|aud|cad|sgd)"
_NUM = r"(?P<num>\d[\d,]*(?:\.\d+)?)"
_MULT = r"(?:\s*(?P<mult>thousand|million|billion|lakhs?|lac|crores?|mn|bn|cr|k|m|b)\b)?"
# Currency before the number ("USD 4.5 million") or after it ("4.5 million EUR").
MONEY_PREFIX_RE = re.compile(rf"{_CUR}\s*{_NUM}{_MULT}", re.IGNORECASE)
MONEY_SUFFIX_RE = re.compile(rf"{_NUM}{_MULT}\s*{_CUR}(?![a-z])", re.IGNORECASE)
PCT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|per\s?cent)", re.IGNORECASE)

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}
_MON_ABBR = {k[:3]: v for k, v in _MONTHS.items()}
DATE_RES = [
    re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"),
    re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b"),
    re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b"),
    re.compile(r"\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b"),
]


def parse_money(text: str) -> tuple[float, str | None] | None:
    matches = [m for m in (MONEY_PREFIX_RE.search(text), MONEY_SUFFIX_RE.search(text)) if m]
    if not matches:
        return None
    m = min(matches, key=lambda x: x.start())
    value = float(m.group("num").replace(",", ""))
    if m.group("mult"):
        value *= _MULTIPLIERS[m.group("mult").lower()]
    return value, _CURRENCY_TOKENS.get(m.group("cur").lower())


def parse_date(text: str) -> date | None:
    for i, rx in enumerate(DATE_RES):
        m = rx.search(text)
        if not m:
            continue
        try:
            if i == 0:
                return date(int(m[1]), int(m[2]), int(m[3]))
            if i == 1:
                mon = _MONTHS.get(m[2].lower()) or _MON_ABBR.get(m[2][:3].lower())
                if mon:
                    return date(int(m[3]), mon, int(m[1]))
            if i == 2:
                mon = _MONTHS.get(m[1].lower()) or _MON_ABBR.get(m[1][:3].lower())
                if mon:
                    return date(int(m[3]), mon, int(m[2]))
            if i == 3:  # public tenders overwhelmingly use day-first
                return date(int(m[3]), int(m[2]), int(m[1]))
        except ValueError:
            continue
    return None


def _lines_matching(text: str, pattern: str) -> list[str]:
    rx = re.compile(pattern, re.IGNORECASE)
    return [ln.strip() for ln in text.splitlines() if rx.search(ln)]


def _first_money(text: str, label: str) -> tuple[float, str | None] | None:
    for ln in _lines_matching(text, label):
        tail = re.split(label, ln, maxsplit=1, flags=re.IGNORECASE)[-1]
        found = parse_money(tail) or parse_money(ln)
        if found:
            return found
    return None


def _first_pct(text: str, label: str) -> float | None:
    for ln in _lines_matching(text, label):
        m = PCT_RE.search(ln)
        if m:
            return float(m.group(1))
    return None


def _field(text: str, label: str) -> str | None:
    m = re.search(rf"^\s*(?:{label})\s*[:\-–]\s*(?P<value>.+)$", text, re.IGNORECASE | re.MULTILINE)
    return m.group("value").strip() if m else None


def _duration_months(text: str) -> float | None:
    unit_re = r"(\d+(?:\.\d+)?)\s*(months?|years?|weeks?)"
    for ln in _lines_matching(text, r"contract (period|duration)|period of (contract|performance)|duration"):
        # "18 months build, 60 months O&M; contract duration 78 months" -> 78
        m = (re.search(r"duration\D{0,25}" + unit_re, ln, re.IGNORECASE)
             or re.search(unit_re, ln, re.IGNORECASE))
        if m:
            n, unit = float(m[1]), m[2].lower()
            return n * 12 if unit.startswith("year") else n / 4.345 if unit.startswith("week") else n
    return None


def _certifications(text: str) -> list[str]:
    found: list[str] = []
    for m in re.finditer(r"\bISO[/ ]?(?:IEC[ ]?)?(\d{4,5})(?::\d{4})?\b", text):
        found.append(f"ISO {m.group(1)}")
    for m in re.finditer(r"\bCMMI(?:[- ](?:DEV|SVC))?\s*(?:level|L|ML)\s*(\d)\b", text, re.IGNORECASE):
        found.append(f"CMMI L{m.group(1)}")
    for token, name in [(r"\bSOC\s?2\b", "SOC 2"), (r"\bPCI[- ]DSS\b", "PCI DSS"),
                        (r"\bOHSAS\b", "OHSAS 18001"), (r"\bCE mark", "CE"),
                        (r"\bFedRAMP\b", "FedRAMP"), (r"\bCyber Essentials\b", "Cyber Essentials")]:
        if re.search(token, text, re.IGNORECASE):
            found.append(name)
    return sorted(set(found))


_RISK_RULES: list[tuple[str, str, str]] = [
    ("UNLIMITED_LIABILITY", r"unlimited liability|liability (shall )?(not be|is not) (capped|limited)|without limit", "HIGH"),
    ("BROAD_INDEMNITY", r"indemnif\w+.{0,80}(indirect|consequential|any and all)", "MEDIUM"),
    ("NO_PRICE_ADJUSTMENT", r"(firm|fixed) price.{0,60}(no|not subject to|without).{0,20}(escalation|adjustment|variation)|no price (escalation|variation|adjustment)", "MEDIUM"),
    ("TERMINATION_FOR_CONVENIENCE", r"terminat\w+.{0,40}\b(for|at) (its |their |the \w+'s )?convenience", "LOW"),
    ("IP_TRANSFER", r"(intellectual property|source code).{0,60}(vest|transfer|assign)\w*.{0,30}(purchaser|buyer|authority|client)", "MEDIUM"),
    ("LOCAL_CONTENT", r"local content|make in india|domestic (preference|content)|buy american", "LOW"),
    ("BLACKLISTING_CLAUSE", r"blacklist|debar", "LOW"),
    ("SHORT_TIMELINE", r"within (\d|1[0-4]) days of (award|contract|notification)|immediate mobili[sz]ation", "MEDIUM"),
]


def _risk_flags(text: str, ex: TenderExtraction) -> list[RiskFlag]:
    flags: list[RiskFlag] = []
    for code, pattern, sev in _RISK_RULES:
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if m:
            # Widen to whole sentences around the match so evidence reads cleanly.
            start = max(text.rfind(". ", 0, m.start()) + 2, m.start() - 160, 0)
            end = text.find(".", m.end())
            end = len(text) if end == -1 else min(end + 1, m.end() + 160)
            snippet = " ".join(text[start:end].split())
            snippet = re.sub(r"^\d+(\.\d+)*\s+", "", snippet)
            flags.append(RiskFlag(code=code, severity=sev, evidence=snippet))
    if ex.liquidated_damages_cap_pct is not None and ex.liquidated_damages_cap_pct > 10:
        flags.append(RiskFlag(code="HIGH_LIQUIDATED_DAMAGES", severity="HIGH",
                              evidence=f"LD cap {ex.liquidated_damages_cap_pct}% of contract value"))
    if ex.payment_terms_days is not None and ex.payment_terms_days > 60:
        flags.append(RiskFlag(code="LONG_PAYMENT_TERMS", severity="MEDIUM",
                              evidence=f"Payment within {ex.payment_terms_days} days"))
    if ex.performance_guarantee_pct is not None and ex.performance_guarantee_pct > 10:
        flags.append(RiskFlag(code="HIGH_PERFORMANCE_GUARANTEE", severity="MEDIUM",
                              evidence=f"Performance guarantee {ex.performance_guarantee_pct}%"))
    if ex.retention_pct:
        flags.append(RiskFlag(code="RETENTION_MONEY", severity="LOW",
                              evidence=f"Retention {ex.retention_pct}%"))
    return flags


def _bullet_kind(marker: str) -> str:
    if marker[0] in "-*•●":
        return "symbol"
    return "digit" if marker.strip("().")[0].isdigit() else "letter"


def _scope_items(text: str) -> list[str]:
    items: list[str] = []
    style = ""
    in_scope = False
    for raw in text.splitlines():
        ln = raw.strip()
        if re.match(r"^(\d+[.)]\s*)?(scope of (work|supply|services)|scope|deliverables)\b", ln, re.IGNORECASE):
            in_scope = True
            continue
        if in_scope:
            m = re.match(r"^([-*•●]|\(?[a-z0-9]{1,2}[.)])\s+(.+)", ln, re.IGNORECASE)
            # Stay with the first item's bullet style so the next numbered
            # section heading ("4. Eligibility") is not taken as a scope item.
            if m and (not items or _bullet_kind(m.group(1)) == style):
                style = _bullet_kind(m.group(1))
                items.append(m.group(2).strip())
            elif ln and items:
                break
    return items[:25]


def _evaluation(text: str) -> tuple[str, float | None]:
    low = text.lower()
    weight = None
    m = re.search(r"(\d{2})\s*[:/]\s*(\d{2})\s*(?:\(?\s*technical\s*[:/]\s*financial|technical)", low)
    if m:
        weight = float(m.group(1))
    else:
        m = re.search(r"technical\D{0,30}(\d{2})\s*%", low)
        if m:
            weight = float(m.group(1))
    if re.search(r"qcbs|quality[- ]and[- ]cost|quality cum cost|most economically advantageous|meat\b", low) or weight:
        return "QCBS", weight
    if re.search(r"quality[- ]based selection|\bqbs\b", low):
        return "QUALITY_ONLY", 100.0
    if re.search(r"\bl-?1\b|lowest (evaluated |responsive )?(bid|price|offer|tender)", low):
        return "LOWEST_PRICE", 0.0
    return "UNKNOWN", None


def _summary(text: str, ex: TenderExtraction) -> str:
    facts = []
    if ex.buyer:
        facts.append(f"Issued by {ex.buyer}")
    if ex.estimated_value:
        facts.append(f"estimated value {ex.currency or ''} {ex.estimated_value:,.0f}".replace("  ", " "))
    if ex.contract_duration_months:
        facts.append(f"{ex.contract_duration_months:g}-month contract")
    if ex.submission_deadline:
        facts.append(f"bids due {ex.submission_deadline}")
    if ex.evaluation_method != "UNKNOWN":
        method = {"QCBS": "quality-and-cost (QCBS)", "LOWEST_PRICE": "lowest price",
                  "QUALITY_ONLY": "quality only"}[ex.evaluation_method]
        weight = f", {ex.technical_weight_pct:g}% technical" if ex.technical_weight_pct else ""
        facts.append(f"evaluated on {method}{weight}")
    # Lead with the first real prose paragraph, skipping "Label: value" header blocks.
    lead = ""
    for para in re.split(r"\n\s*\n", text):
        lines = [ln for ln in para.strip().splitlines() if ln.strip()]
        prose = [ln for ln in lines if not re.match(r"^\s*[\w ()/&.-]{2,40}:\s", ln)
                 and not (len(ln.strip()) < 60 and not ln.rstrip().endswith("."))]
        joined = " ".join(" ".join(prose).split())
        if len(joined) > 120 and joined.count(". ") >= 1:
            sentences = re.split(r"(?<=[.!?])\s+", joined)
            lead = " ".join(sentences[:2])[:600]
            break
    head = (ex.title or "Tender") + (": " + "; ".join(facts) + "." if facts else ".")
    risks = f" {len(ex.risk_flags)} contractual risk flag(s) detected." if ex.risk_flags else ""
    return f"{head} {lead}{risks}".strip()


def extract(text: str) -> TenderExtraction:
    ex = TenderExtraction(summary="")
    ex.title = _field(text, r"title|tender title|name of (work|project|tender)|subject")
    ex.reference = _field(text, r"tender (no|number|ref(erence)?)\.?|ref(erence)?( no\.?)?|rfp (no|number)\.?|solicitation (no|number)\.?")
    ex.buyer = _field(text, r"issued by|buyer|procuring (entity|authority)|contracting authority|client|purchaser|organi[sz]ation")
    ex.sector = _field(text, r"sector|category|industry")
    ex.region = _field(text, r"location|region|place of (performance|delivery)|site")

    value = _first_money(text, r"estimated (contract )?(value|cost)|contract value|budget|project cost|tender value")
    if value:
        ex.estimated_value, ex.currency = value[0], value[1]
    emd = _first_money(text, r"bid security|earnest money|emd|tender security|bid bond")
    if emd:
        ex.bid_security_amount = emd[0]
        ex.currency = ex.currency or emd[1]

    ex.performance_guarantee_pct = _first_pct(text, r"performance (bank )?(guarantee|security|bond)")
    ex.advance_payment_pct = _first_pct(text, r"advance payment|mobili[sz]ation advance")
    ex.retention_pct = _first_pct(text, r"retention")
    ld_lines = _lines_matching(text, r"liquidated damages|penalt(y|ies) for delay")
    for ln in ld_lines:
        pcts = [float(p) for p in PCT_RE.findall(ln)]
        if pcts:
            ex.liquidated_damages_cap_pct = max(pcts)
            break
    for ln in _lines_matching(text, r"payment"):
        m = re.search(r"(\d{1,3})\s*days", ln, re.IGNORECASE)
        if m:
            ex.payment_terms_days = int(m.group(1))
            break

    ex.contract_duration_months = _duration_months(text)
    for ln in _lines_matching(text, r"(submission|closing|due|last) date|deadline|bids? (must|shall) be (submitted|received)"):
        d = parse_date(ln)
        if d:
            ex.submission_deadline = d.isoformat()
            break
    for label in ("pre-bid meeting", "site visit", "bid opening", "clarification", "question"):
        for ln in _lines_matching(text, label):
            d = parse_date(ln)
            if d:
                ex.key_dates.append(KeyDate(label=label.title(), date=d.isoformat()))
                break
    if ex.submission_deadline:
        ex.key_dates.append(KeyDate(label="Submission deadline", date=ex.submission_deadline))

    ex.evaluation_method, ex.technical_weight_pct = _evaluation(text)

    elig = EligibilityCriteria(required_certifications=_certifications(text))
    t = _first_money(text, r"turnover")
    elig.min_annual_turnover = t[0] if t else None
    nw = _first_money(text, r"net worth")
    elig.min_net_worth = nw[0] if nw else None
    sim = _first_money(text, r"similar (work|project|assignment|contract)s?")
    elig.min_similar_project_value = sim[0] if sim else None
    for ln in _lines_matching(text, r"experience|in business|years of operation|incorporated"):
        m = re.search(r"(\d{1,2})\s*\+?\s*years", ln, re.IGNORECASE)
        if m:
            elig.min_years_experience = int(m.group(1))
            break
    ex.eligibility = elig

    ex.scope_items = _scope_items(text)
    ex.risk_flags = _risk_flags(text, ex)
    if not ex.title:
        first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "Untitled tender")
        ex.title = first[:200]
    ex.summary = _summary(text, ex)
    return ex


def days_until(iso_date: str | None, today: date | None = None) -> int | None:
    if not iso_date:
        return None
    try:
        d = datetime.fromisoformat(iso_date).date()
    except ValueError:
        return None
    return (d - (today or date.today())).days
