import re

from job_scraper.http import get_json, strip_html
from job_scraper.models import JobPosting

PLATFORM = "greenhouse"
LINK_PATTERN = re.compile(r"boards\.greenhouse\.io/(?:embed/job_board\?for=)?([\w-]+)", re.I)

API_URL = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"


def fetch_jobs(slug: str, company_name: str) -> list[JobPosting]:
    data = get_json(API_URL.format(slug=slug), params={"content": "true"})
    postings = []
    for job in data.get("jobs", []):
        location = (job.get("location") or {}).get("name", "")
        postings.append(
            JobPosting(
                company=company_name,
                title=job.get("title", ""),
                url=job.get("absolute_url", ""),
                platform=PLATFORM,
                location=location,
                description=strip_html(job.get("content", "")),
                posted_at=job.get("updated_at"),
            )
        )
    return postings
