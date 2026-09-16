import re

from job_scraper.http import get_json, strip_html
from job_scraper.models import JobPosting

PLATFORM = "ashby"
LINK_PATTERN = re.compile(r"jobs\.ashbyhq\.com/([\w-]+)", re.I)

API_URL = "https://api.ashbyhq.com/posting-api/job-board/{slug}"


def fetch_jobs(slug: str, company_name: str) -> list[JobPosting]:
    data = get_json(API_URL.format(slug=slug), params={"includeCompensation": "false"})
    postings = []
    for job in data.get("jobs", []):
        description = job.get("descriptionPlain") or strip_html(job.get("descriptionHtml", ""))
        postings.append(
            JobPosting(
                company=company_name,
                title=job.get("title", ""),
                url=job.get("jobUrl") or job.get("applyUrl", ""),
                platform=PLATFORM,
                location=job.get("location", ""),
                description=description,
                posted_at=job.get("publishedAt"),
            )
        )
    return postings
