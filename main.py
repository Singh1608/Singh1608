#!/usr/bin/env python3
"""CLI entrypoint for job_scraper.

Usage:
    python3 main.py --config config.yaml --output results.json
    python3 main.py --config config.yaml --output results.csv --format csv
"""
import argparse
import logging
import sys

import yaml

from job_scraper.filters import passes_filters
from job_scraper.output import write_csv, write_json
from job_scraper.scraper import scrape_all


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape company career pages for job postings.")
    parser.add_argument("--config", default="config.yaml", help="Path to config YAML file")
    parser.add_argument("--output", default="results.json", help="Path to write results to")
    parser.add_argument(
        "--format", choices=["json", "csv"], default=None,
        help="Output format (default: inferred from --output extension)",
    )
    parser.add_argument(
        "--no-filter", action="store_true",
        help="Skip the search filters and output every posting found",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    with open(args.config, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    companies = cfg.get("companies", [])
    search_cfg = cfg.get("search", {})

    if not companies:
        print("No companies configured in config.yaml -- nothing to scrape.", file=sys.stderr)
        return 1

    print(f"Scraping {len(companies)} companies...")
    postings = scrape_all(companies)
    print(f"Found {len(postings)} total postings.")

    if args.no_filter:
        results = postings
    else:
        results = [p for p in postings if passes_filters(p, search_cfg)]
    print(f"{len(results)} postings match your filters.")

    fmt = args.format or ("csv" if args.output.endswith(".csv") else "json")
    if fmt == "csv":
        write_csv(results, args.output)
    else:
        write_json(results, args.output)
    print(f"Wrote results to {args.output}")

    for p in results[:20]:
        print(f"  - [{p.company}] {p.title} ({p.location}) -> {p.url}")
    if len(results) > 20:
        print(f"  ... and {len(results) - 20} more (see {args.output})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
