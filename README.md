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
  against (major Polish cities + remote variants).
- `search.role_keywords` — loose substring match against the job **title**,
  tuned to a Consultant / Senior Consultant / Senior Associate band covering
  consulting & strategy, transformation, business analysis, chief of staff &
  business management, PMO & programme management, and process /
  operational excellence.
- `search.exclude_title_keywords` — negative filter on the title, matched on
  **whole words**. This is what keeps the loose keywords above usable: bare
  `consultant` would otherwise match every Sales, Recruitment and Security
  Consultant posting. Word-boundary matching is deliberate — a wrong
  exclusion silently drops a real job, so `intern` must not knock out
  "Internal Consultant".
- `search.english_only` / `exclude_if_requires_polish` — language filtering
  heuristics (no external language-detection library; see
  `job_scraper/filters.py` for the approach and how to tune it).
- `companies` — a starting list, **unverified**: the careers URLs were
  written without network access to check them, so some will have moved.
  They use the auto-detect path on purpose (give the scraper a careers page,
  it finds the ATS behind it) rather than guessing ATS slugs.

### Triaging the company list

`python3 main.py` prints a summary of every company that returned nothing,
so you can tell a bad URL from a company with no open roles:

```
16 companies returned nothing (wrong URL/slug, unsupported ATS, ...):
  - Allegro
  - Brainly
```

Re-run with `-v` to see the specific failure per company, then fix or drop
the entry.

### Known coverage gap

The employers that fit a consulting/transformation profile best — Big 4,
MBB, and large banks (Citi, Goldman, ING, Nordea, Santander) — mostly run
**Workday**, SuccessFactors, Taleo or iCIMS, none of which have detectors
yet. The supported platforms (Greenhouse, Lever, Ashby, SmartRecruiters,
Recruitee, Personio, Teamtailor) skew toward tech companies and scaleups,
so the seeded company list is weighted that way.

Adding a Workday detector is the single biggest unlock for this profile:
Workday boards expose a semi-standard JSON endpoint
(`/wday/cxs/{tenant}/{site}/jobs`), so it fits the same detector interface
as the others in `job_scraper/detectors/`.

## Vercel deployment

The Vercel site is now just a redirect. `vercel.json` sends every path to
the live job pipeline, with `public/index.html` as a fallback landing page
if the redirect rule ever fails to apply. The deployment is pure static —
there is no serverless function, so there is nothing to build and nothing
to time out.

The Python serverless dashboard that used to live here was removed. It ran
this scraper on request, and the scraper could not reach the employers that
matter for this search (see the coverage gap above), so the page reliably
returned nothing. The pipeline it redirects to is maintained by scheduled
web searches instead, which is what actually produces results.

```bash
npm install -g vercel   # or: npx vercel
vercel login
vercel link              # first time only, links this dir to a Vercel project
vercel deploy --prod
```

The scraper itself remains a working CLI (`main.py`) and is unaffected by
any of this.

### Dashboard environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | all `api/` functions | Blob store holding the feed, run log and category overrides |
| `CRON_SECRET` | `api/refresh.js` | Bearer token the daily cron sends |
| `PIPELINE_EDIT_KEY` | `api/overrides.js` | Key the page asks for once per device before it syncs role-type changes. Keep it separate from `CRON_SECRET`, because this one gets typed into browsers |

Role types (Strategy, Finance, Business Analysis, …) are set from the job
title by `api/_category.js`. Changes made on the page are stored in
`pipeline/overrides.json` and shared across devices. Until
`PIPELINE_EDIT_KEY` is set, changes are saved only on the device where they
were made.

Node tests for the dashboard API: `cd tests && for t in *.test.mjs; do node $t; done`.

## Testing

```bash
python3 -m unittest discover -s tests -v
```

Tests mock all HTTP calls, so they run without network access. Note: this
was built/tested in a sandboxed environment with outbound network access
blocked to job platforms (Greenhouse, Lever, etc.), so live scraping against
real companies hasn't been verified end-to-end yet — do that as a first
smoke test once you add real companies to `config.yaml`.
