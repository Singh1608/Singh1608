import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from job_scraper import generic
from job_scraper.detectors import REGISTRY
from job_scraper.http import get_text
from job_scraper.models import JobPosting

logger = logging.getLogger("job_scraper")


@dataclass
class CompanyResult:
    """What one company yielded, plus why it yielded nothing. Without the
    platform/error fields a zero-posting company is indistinguishable from a
    dead careers URL, which makes a bad company list impossible to debug."""

    name: str
    postings: list[JobPosting] = field(default_factory=list)
    platform: str = ""
    error: str = ""


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


def _probe_platforms(slug: str, name: str) -> CompanyResult:
    """Find which ATS hosts this company's board by trying each one.

    Knowing a company's name is easy; knowing which of seven ATS platforms it
    runs is not, and guessing wrong silently yields nothing. A company's board
    lives on exactly one platform and the rest return 404 in milliseconds, so
    probing is both cheap and self-correcting.
    """
    tried = []
    for platform, module in REGISTRY.items():
        try:
            postings = module.fetch_jobs(slug, name)
        except Exception:  # noqa: BLE001 - a 404 here just means "not this one"
            tried.append(platform)
            continue
        if postings:
            return CompanyResult(name, postings, platform)
        tried.append(platform)

    return CompanyResult(
        name, [], "", f"no board found for slug '{slug}' on: {', '.join(tried)}"
    )


def scrape_company(company_cfg: dict) -> CompanyResult:
    name = company_cfg["name"]
    platform = company_cfg.get("platform")
    slug = company_cfg.get("slug")
    careers_url = company_cfg.get("careers_url")

    try:
        if platform and slug:
            if platform not in REGISTRY:
                raise ValueError(f"Unknown platform '{platform}' for {name}")
            return CompanyResult(name, REGISTRY[platform].fetch_jobs(slug, name), platform)

        if slug:
            return _probe_platforms(slug, name)

        if not careers_url:
            raise ValueError(f"Company '{name}' needs either platform+slug or careers_url")

        detected = detect_platform(careers_url)
        if detected:
            platform, slug = detected
            logger.info("Detected %s as %s (slug=%s)", name, platform, slug)
            return CompanyResult(name, REGISTRY[platform].fetch_jobs(slug, name), platform)

        logger.info("No known ATS detected for %s, falling back to generic scraper", name)
        return CompanyResult(name, generic.fetch_jobs(careers_url, name), generic.PLATFORM)

    except Exception as exc:  # noqa: BLE001 - one bad company must not kill the run
        logger.warning("Failed to scrape %s: %s", name, exc)
        return CompanyResult(name, [], platform or "", str(exc)[:200])


MAX_PARALLEL_COMPANIES = 12


def scrape_all(companies_cfg: list[dict]) -> list[CompanyResult]:
    # Scraped in parallel because the serverless function caps out at 60s and
    # scraping companies one at a time, each with its own HTTP timeouts, runs
    # well past that. scrape_company swallows its own exceptions, so a failing
    # company still just yields an empty CompanyResult here.
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_COMPANIES) as pool:
        return list(pool.map(scrape_company, companies_cfg))
