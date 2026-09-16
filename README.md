# job_scraper

Finds job postings directly from company career pages/websites, filtered for
English-speaking roles based in Poland.

## How it works

For each company in `config.yaml`, the scraper tries, in order:

1. **Known ATS, fast path** — if you give a `platform` + `slug` directly, it
   hits that platform's public API (structured JSON/XML, most reliable).
2. **Known ATS, auto-detect** — if you only give a `careers_url`, it fetches
   that page and looks for an embedded/linked board on a known ATS domain.
3. **Generic fallback** — if no known ATS is found, it falls back to
   best-effort HTML scraping: first schema.org `JobPosting` JSON-LD (common
   for SEO/Google for Jobs), then a heuristic scan for job-listing links.

Supported ATS platforms: Greenhouse, Lever, Ashby, SmartRecruiters,
Recruitee, Personio, Teamtailor. Adding another is one small module in
`job_scraper/detectors/` (see `detectors/base.py` for the interface).

The generic fallback means it can attempt *any* company site, but it's
inherently less reliable than the structured platforms — expect it to miss
postings or misparse some pages. That's the tradeoff for broad coverage.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

```bash
python3 main.py --config config.yaml --output results.json
python3 main.py --config config.yaml --output results.csv --format csv
python3 main.py --config config.yaml --no-filter   # skip filters, dump everything found
```

## Configuring

Edit `config.yaml`:

- `search.location_keywords` — Poland-related location strings to match
  against (already filled in with major Polish cities + remote variants).
- `search.role_keywords` — **placeholder right now**; matches broad
  engineering titles. Update these once you've shared your actual
  role/experience so results are relevant to you.
- `search.english_only` / `exclude_if_requires_polish` — language filtering
  heuristics (no external language-detection library; see
  `job_scraper/filters.py` for the approach and how to tune it).
- `companies` — **placeholder right now**; the two entries are schema
  examples with fake slugs/URLs, not real companies. Replace with actual
  companies you want to track (to be filled in later).

## Testing

```bash
python3 -m unittest discover -s tests -v
```

Tests mock all HTTP calls, so they run without network access. Note: this
was built/tested in a sandboxed environment with outbound network access
blocked to job platforms (Greenhouse, Lever, etc.), so live scraping against
real companies hasn't been verified end-to-end yet — do that as a first
smoke test once you add real companies to `config.yaml`.
