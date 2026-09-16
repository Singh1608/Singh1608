import re
import xml.etree.ElementTree as ET

from job_scraper.http import get_text, strip_html
from job_scraper.models import JobPosting

PLATFORM = "personio"
LINK_PATTERN = re.compile(r"([\w-]+)\.jobs\.personio\.(?:de|com)", re.I)

XML_URL = "https://{slug}.jobs.personio.de/xml"


def fetch_jobs(slug: str, company_name: str) -> list[JobPosting]:
    xml_text = get_text(XML_URL.format(slug=slug))
    root = ET.fromstring(xml_text)
    postings = []
    for position in root.findall("position"):
        job_id = position.findtext("id", "")
        title = position.findtext("name", "")
        office = position.findtext("office", "")
        description_parts = [
            strip_html(desc.findtext("value", "") or "")
            for desc in position.findall("jobDescriptions/jobDescription")
        ]
        postings.append(
            JobPosting(
                company=company_name,
                title=title,
                url=f"https://{slug}.jobs.personio.de/job/{job_id}",
                platform=PLATFORM,
                location=office,
                description=" ".join(p for p in description_parts if p),
                posted_at=position.findtext("createdAt"),
            )
        )
    return postings
