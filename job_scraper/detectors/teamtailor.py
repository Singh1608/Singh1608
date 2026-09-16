import re

from job_scraper.http import get_json, strip_html
from job_scraper.models import JobPosting

PLATFORM = "teamtailor"
LINK_PATTERN = re.compile(r"([\w-]+)\.teamtailor\.com", re.I)

API_URL = "https://{slug}.teamtailor.com/jobs.json"


def fetch_jobs(slug: str, company_name: str) -> list[JobPosting]:
    data = get_json(API_URL.format(slug=slug))
    postings = []
    for job in data.get("jobs", []):
        locations = job.get("locations") or []
        location = ", ".join(loc.get("city", "") for loc in locations if loc.get("city"))
        postings.append(
            JobPosting(
                company=company_name,
                title=job.get("title", ""),
                url=job.get("url") or job.get("careersite-job-url", ""),
                platform=PLATFORM,
                location=location or job.get("location", ""),
                description=strip_html(job.get("body", "")),
                posted_at=job.get("created-at"),
            )
        )
    return postings
