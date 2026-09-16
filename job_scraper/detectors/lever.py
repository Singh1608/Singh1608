import re

from job_scraper.http import get_json, strip_html
from job_scraper.models import JobPosting

PLATFORM = "lever"
LINK_PATTERN = re.compile(r"jobs\.lever\.co/([\w-]+)", re.I)

API_URL = "https://api.lever.co/v0/postings/{slug}"


def fetch_jobs(slug: str, company_name: str) -> list[JobPosting]:
    jobs = get_json(API_URL.format(slug=slug), params={"mode": "json"})
    postings = []
    for job in jobs:
        categories = job.get("categories") or {}
        description = job.get("descriptionPlain") or strip_html(job.get("description", ""))
        lists_text = " ".join(
            strip_html(section.get("content", ""))
            for section in job.get("lists", []) or []
        )
        postings.append(
            JobPosting(
                company=company_name,
                title=job.get("text", ""),
                url=job.get("hostedUrl", ""),
                platform=PLATFORM,
                location=categories.get("location", ""),
                description=f"{description} {lists_text}".strip(),
                posted_at=str(job.get("createdAt", "")) or None,
            )
        )
    return postings
