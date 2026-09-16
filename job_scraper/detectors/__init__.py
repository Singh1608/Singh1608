from job_scraper.detectors import (
    ashby,
    greenhouse,
    lever,
    personio,
    recruitee,
    smartrecruiters,
    teamtailor,
)

# Registry of every known ATS platform: name -> module exposing
# LINK_PATTERN and fetch_jobs(slug, company_name). Order matters for
# detection: more specific/common patterns first.
REGISTRY = {
    greenhouse.PLATFORM: greenhouse,
    lever.PLATFORM: lever,
    ashby.PLATFORM: ashby,
    smartrecruiters.PLATFORM: smartrecruiters,
    recruitee.PLATFORM: recruitee,
    personio.PLATFORM: personio,
    teamtailor.PLATFORM: teamtailor,
}
