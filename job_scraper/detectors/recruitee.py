import re

from job_scraper.http import get_json, strip_html
from job_scraper.models import JobPosting

PLATFORM = "recruitee"
LINK_PATTERN = re.compile(r"([\w-]+)\.recruitee\.com", re.I)

API_URL = "https://{slug}.recruitee.com/api/offers/"


def fetch_jobs(slug: str, company_name: str) -> list[JobPosting]:
    data = get_json(API_URL.format(slug=slug))
    postings = []
    for job in data.get("offers", []):
        location_parts = [job.get("city"), job.get("country")]
        location = ", ".join(p for p in location_parts if p)
        if job.get("remote"):
            location = f"Remote ({location})" if location else "Remote"
        postings.append(
            JobPosting(
                company=company_name,
                title=job.get("title", ""),
                url=job.get("careers_url", ""),
                platform=PLATFORM,
                location=location,
                description=strip_html(job.get("description", "")),
                posted_at=job.get("published_at"),
            )
        )
    return postings
