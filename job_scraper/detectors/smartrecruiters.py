import re

from job_scraper.http import get_json
from job_scraper.models import JobPosting

PLATFORM = "smartrecruiters"
LINK_PATTERN = re.compile(r"jobs\.smartrecruiters\.com/([\w-]+)", re.I)

LIST_URL = "https://api.smartrecruiters.com/v1/companies/{slug}/postings"
PAGE_LIMIT = 100


def _location_str(loc: dict) -> str:
    if not loc:
        return ""
    parts = [loc.get("city"), loc.get("region"), loc.get("country")]
    label = ", ".join(p for p in parts if p)
    if loc.get("remote"):
        label = f"Remote ({label})" if label else "Remote"
    return label


def fetch_jobs(slug: str, company_name: str) -> list[JobPosting]:
    # The postings list endpoint doesn't include the full job description, only
    # a summary + location; fetching per-job descriptions for every posting at
    # every company would be expensive, so we leave description blank here and
    # rely on title/location for filtering. Location text is still reliable.
    postings = []
    offset = 0
    while True:
        data = get_json(
            LIST_URL.format(slug=slug), params={"limit": PAGE_LIMIT, "offset": offset}
        )
        content = data.get("content", [])
        if not content:
            break
        for job in content:
            postings.append(
                JobPosting(
                    company=company_name,
                    title=job.get("name", ""),
                    url=job.get("ref", "") or f"https://jobs.smartrecruiters.com/{slug}/{job.get('id', '')}",
                    platform=PLATFORM,
                    location=_location_str(job.get("location") or {}),
                    description="",
                    posted_at=job.get("releasedDate"),
                )
            )
        offset += PAGE_LIMIT
        if offset >= data.get("totalFound", 0):
            break
    return postings
