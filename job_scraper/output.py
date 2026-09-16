import csv
import json

from job_scraper.models import JobPosting

FIELDNAMES = ["company", "title", "location", "platform", "url", "posted_at", "description"]


def write_json(postings: list[JobPosting], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump([p.to_dict() for p in postings], f, indent=2, ensure_ascii=False)


def write_csv(postings: list[JobPosting], path: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for p in postings:
            writer.writerow(p.to_dict())
