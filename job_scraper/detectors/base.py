"""Interface every ATS detector module implements.

A detector module exposes:
  PLATFORM: str                     short platform identifier, e.g. "greenhouse"
  LINK_PATTERN: re.Pattern          matches this platform's URLs / embed links and
                                     captures the company "slug" in group(1)
  fetch_jobs(slug, company_name) -> list[JobPosting]
                                     fetches and normalizes all open postings

Detectors should be resilient: raise on genuine failures (network error, bad
slug) and let the caller (job_scraper.scraper) log + skip that company rather
than crash the whole run.
"""
