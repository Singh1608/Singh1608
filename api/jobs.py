"""Vercel Python serverless function: GET /api/jobs

Runs the scraper against every company in config.yaml, applies the search
filters, and returns matching postings as JSON. Reuses the exact same
job_scraper package as the CLI (main.py) -- no logic duplicated here.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import yaml  # noqa: E402

from job_scraper.filters import passes_filters  # noqa: E402
from job_scraper.scraper import scrape_all  # noqa: E402

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.yaml")


def run_scrape() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    companies = cfg.get("companies", [])
    search_cfg = cfg.get("search", {})

    jobs: list[dict] = []
    diagnostics: list[dict] = []
    for result in scrape_all(companies):
        matched = [p for p in result.postings if passes_filters(p, search_cfg)]
        jobs.extend(p.to_dict() for p in matched)
        diagnostics.append(
            {
                "name": result.name,
                "platform": result.platform,
                "found": len(result.postings),
                "matched": len(matched),
                "error": result.error,
            }
        )

    return {"count": len(jobs), "jobs": jobs, "companies": diagnostics}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            body = json.dumps(run_scrape()).encode("utf-8")
            status = 200
        except Exception as exc:  # noqa: BLE001
            body = json.dumps({"error": str(exc)}).encode("utf-8")
            status = 500

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
