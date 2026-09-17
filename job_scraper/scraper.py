import logging
from concurrent.futures import ThreadPoolExecutor

from job_scraper import generic
from job_scraper.detectors import REGISTRY
from job_scraper.http import get_text
from job_scraper.models import JobPosting

logger = logging.getLogger("job_scraper")


def detect_platform(careers_url: str) -> tuple[str, str] | None:
    """Try to identify a known ATS from a company's careers page: first by
    checking if the URL itself is on a known ATS domain, then by scanning the
    page's HTML for an embedded/linked ATS board."""
    for platform, module in REGISTRY.items():
        match = module.LINK_PATTERN.search(careers_url)
        if match:
            return platform, match.group(1)

    try:
        html = get_text(careers_url)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not fetch %s to detect ATS platform: %s", careers_url, exc)
        return None

    for platform, module in REGISTRY.items():
        match = module.LINK_PATTERN.search(html)
        if match:
            return platform, match.group(1)
    return None


def scrape_company(company_cfg: dict) -> list[JobPosting]:
    name = company_cfg["name"]
    platform = company_cfg.get("platform")
    slug = company_cfg.get("slug")
    careers_url = company_cfg.get("careers_url")

    try:
        if platform and slug:
            if platform not in REGISTRY:
                raise ValueError(f"Unknown platform '{platform}' for {name}")
            return REGISTRY[platform].fetch_jobs(slug, name)

        if not careers_url:
            raise ValueError(f"Company '{name}' needs either platform+slug or careers_url")

        detected = detect_platform(careers_url)
        if detected:
            platform, slug = detected
            logger.info("Detected %s as %s (slug=%s)", name, platform, slug)
            return REGISTRY[platform].fetch_jobs(slug, name)

        logger.info("No known ATS detected for %s, falling back to generic scraper", name)
        return generic.fetch_jobs(careers_url, name)

    except Exception as exc:  # noqa: BLE001 - one bad company must not kill the run
        logger.warning("Failed to scrape %s: %s", name, exc)
        return []


MAX_PARALLEL_COMPANIES = 8


def scrape_all(companies_cfg: list[dict]) -> list[JobPosting]:
    # Scraped in parallel because the serverless function caps out at 60s and
    # scraping companies one at a time, each with its own HTTP timeouts, runs
    # well past that. scrape_company swallows its own exceptions, so a failing
    # company still just yields an empty list here.
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_COMPANIES) as pool:
        per_company = pool.map(scrape_company, companies_cfg)
    return [posting for postings in per_company for posting in postings]
