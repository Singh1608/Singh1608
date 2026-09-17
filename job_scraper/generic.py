"""Best-effort scraper for career pages that don't run a known ATS.

Strategy, in order:
1. schema.org JobPosting JSON-LD (<script type="application/ld+json">). Many
   sites embed this for Google for Jobs SEO even when hand-rolling their own
   career page, so it's the most reliable generic signal.
2. Heuristic anchor scan: links whose href/text look like individual job
   postings (containing "job", "career", "position", "vacan(cy|cies)", or a
   numeric/opaque id under a careers path), each followed and scraped for a
   title (<h1>) and a location, if a recognizable location string appears
   near the top of the page.

This will never be as reliable as a structured ATS API, and is expected to
miss postings or mis-parse some pages -- that's the tradeoff for supporting
"any" company site rather than only ones on a known platform.
"""
import json
import logging
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from job_scraper.http import get_text
from job_scraper.models import JobPosting

logger = logging.getLogger("job_scraper")

PLATFORM = "generic"

_JOB_LINK_PATTERN = re.compile(
    r"/(job|jobs|career|careers|position|positions|vacanc(?:y|ies)|opening|openings)s?/[^/?#]+",
    re.I,
)
# Each followed link is its own HTTP request, so this is the main driver of
# how long a generic-fallback company takes. Kept low to stay inside the
# serverless function's time budget.
_MAX_LINKS_TO_FOLLOW = 8


def _parse_json_ld(soup: BeautifulSoup, page_url: str, company_name: str) -> list[JobPosting]:
    postings = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (ValueError, TypeError):
            continue
        candidates = data if isinstance(data, list) else [data]
        for item in candidates:
            if not isinstance(item, dict):
                continue
            if item.get("@type") != "JobPosting":
                continue
            location = ""
            job_location = item.get("jobLocation")
            if isinstance(job_location, list):
                job_location = job_location[0] if job_location else {}
            if isinstance(job_location, dict):
                address = job_location.get("address", {})
                if isinstance(address, dict):
                    location = ", ".join(
                        filter(
                            None,
                            [
                                address.get("addressLocality"),
                                address.get("addressRegion"),
                                address.get("addressCountry"),
                            ],
                        )
                    )
            if item.get("jobLocationType") == "TELECOMMUTE" and not location:
                location = "Remote"

            description = item.get("description", "")
            if description:
                description = BeautifulSoup(description, "lxml").get_text(" ", strip=True)

            postings.append(
                JobPosting(
                    company=company_name,
                    title=item.get("title", ""),
                    url=item.get("url") or page_url,
                    platform=PLATFORM,
                    location=location,
                    description=description,
                    posted_at=item.get("datePosted"),
                )
            )
    return postings


def _heuristic_links(soup: BeautifulSoup, page_url: str) -> list[str]:
    links = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if _JOB_LINK_PATTERN.search(href):
            links.add(urljoin(page_url, href))
    return list(links)[:_MAX_LINKS_TO_FOLLOW]


def _scrape_link(url: str, company_name: str) -> JobPosting | None:
    try:
        html = get_text(url)
    except Exception as exc:  # noqa: BLE001 - best effort, log and skip
        logger.debug("generic: failed to fetch %s: %s", url, exc)
        return None
    soup = BeautifulSoup(html, "lxml")

    # A linked job page might itself carry JSON-LD -- prefer that if present.
    ld_postings = _parse_json_ld(soup, url, company_name)
    if ld_postings:
        return ld_postings[0]

    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else ""
    if not title:
        return None

    body_text = soup.get_text(" ", strip=True)
    return JobPosting(
        company=company_name,
        title=title,
        url=url,
        platform=PLATFORM,
        location="",
        description=body_text[:4000],
    )


def fetch_jobs(careers_url: str, company_name: str) -> list[JobPosting]:
    html = get_text(careers_url)
    soup = BeautifulSoup(html, "lxml")

    postings = _parse_json_ld(soup, careers_url, company_name)
    if postings:
        return postings

    postings = []
    for link in _heuristic_links(soup, careers_url):
        posting = _scrape_link(link, company_name)
        if posting:
            postings.append(posting)
    return postings
