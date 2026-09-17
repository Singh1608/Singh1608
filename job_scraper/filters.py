"""Filtering heuristics: Poland location, English-language postings, role match.

No external language-detection dependency is used (langdetect fails to build
in some minimal environments and pulls in profile data files); instead we use
small, transparent heuristics that are easy to tune by hand.
"""
import re

from job_scraper.models import JobPosting

# Polish-specific diacritics -> if a text is dense with these, it's likely
# written in Polish rather than English.
_POLISH_CHARS = re.compile(r"[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]")

# Common English function words. A snippet of real English prose will contain
# several of these; machine-translated or Polish text generally won't.
_ENGLISH_STOPWORDS = {
    "the", "and", "you", "our", "with", "will", "for", "are", "this",
    "team", "work", "experience", "we", "your", "role", "have", "has",
    "join", "about", "to", "of", "in", "is",
}

_POLISH_REQUIRED_PATTERNS = [
    re.compile(r"\bpolish\s+(language\s+)?(is\s+)?(required|mandatory|essential|native)\b", re.I),
    re.compile(r"\b(fluent|fluency|native)\s+(in\s+)?polish\b", re.I),
    re.compile(r"\bznajomo[śs][ćc]\s+j[ęe]zyka\s+polskiego\b", re.I),
    re.compile(r"\bwymagana\s+znajomo[śs][ćc]\s+polskiego\b", re.I),
]


def is_english(text: str) -> bool:
    """Best-effort heuristic: True unless the text looks Polish or too short to tell."""
    if not text:
        return True  # nothing to judge on; don't filter out on empty description
    sample = text[:2000]
    words = re.findall(r"[a-zA-Zą-żĄ-Ż]+", sample.lower())
    if len(words) < 15:
        return True  # too short a sample to reliably judge; don't over-filter

    polish_char_hits = len(_POLISH_CHARS.findall(sample))
    english_hits = sum(1 for w in words if w in _ENGLISH_STOPWORDS)

    # Dense Polish diacritics with few recognizable English stopwords -> Polish text.
    if polish_char_hits > 5 and english_hits < 3:
        return False
    return english_hits >= 2 or polish_char_hits == 0


def requires_polish(text: str) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in _POLISH_REQUIRED_PATTERNS)


def matches_location(posting: JobPosting, location_keywords: list[str]) -> bool:
    haystack = f"{posting.location} {posting.title} {posting.description[:500]}".lower()
    return any(kw.lower() in haystack for kw in location_keywords)


def matches_role(title: str, role_keywords: list[str]) -> bool:
    if not role_keywords:
        return True
    title_lower = title.lower()
    return any(kw.lower() in title_lower for kw in role_keywords)


def excluded_by_title(title: str, exclude_keywords: list[str]) -> bool:
    # Word-boundary matched, unlike role_keywords: a wrong exclusion silently
    # drops a real job, so "intern" must not knock out "Internal Consultant"
    # and "lead" must not knock out "Leadership Development".
    if not exclude_keywords:
        return False
    title_lower = title.lower()
    return any(
        re.search(rf"\b{re.escape(kw.lower())}\b", title_lower)
        for kw in exclude_keywords
    )


def passes_filters(posting: JobPosting, search_cfg: dict) -> bool:
    location_keywords = search_cfg.get("location_keywords", [])
    if location_keywords and not matches_location(posting, location_keywords):
        return False

    if excluded_by_title(posting.title, search_cfg.get("exclude_title_keywords", [])):
        return False

    text = f"{posting.title} {posting.description}"
    if search_cfg.get("english_only", True) and not is_english(text):
        return False

    if search_cfg.get("exclude_if_requires_polish", True) and requires_polish(text):
        return False

    role_keywords = search_cfg.get("role_keywords", [])
    if not matches_role(posting.title, role_keywords):
        return False

    return True
