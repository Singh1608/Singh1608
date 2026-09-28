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

The refresh runs at 00:00 UTC and `api/verify.js` at 01:00 UTC, an hour after it (Hobby crons fire somewhere inside their hour), so both finish before the 07:00 Dubai (03:00 UTC) head-hunt. It checks
every shortlisted role through the platform's own API (Greenhouse, Lever,
SmartRecruiters, Ashby, Workday) or by reading the page for a closure notice
or an expired `validThrough` date. A 403, a 5xx or a timeout counts as
unknown, never as closed. Closed roles leave the shortlist but stay under
"Closed" on the page. Roles with a real posting date 30+ days old are tagged,
not removed. Results live in `pipeline/verify.json`, and `/api/status` reports
the latest run.

Every role carries a **Head Hunter score out of 100** (`api/_headhunter.js`),
which replaces the old fit tiers on the page:

| Part | Points | What it measures |
| --- | --- | --- |
| Skills overlap | 40 | Share of the skills the posting asks for that he has used in a paid role |
| Seniority fit | 25 | Years and level asked for against his four years, stricter of the two |
| Domain fit | 20 | Industry (financial services scores highest) and function |
| Practical fit | 15 | Warsaw or remote-in-Poland, work mode stated, salary stated |

Two rules: a skill only listed on the CV or learned on a course scores zero, and
anything the posting hides (salary, seniority, work mode) scores low rather than
being guessed. The daily check stores what it finds in each posting
(`features` in `pipeline/verify.json`), and the weights are applied when the
feed is read, so a rule change needs no re-crawl. Until a role's first check,
it is scored from its title alone and labelled as such. Bands: 70+ strong, 55–69
good, 40–54 stretch, under 40 long shot.

`api/headhunt.js` serves that morning run. `GET` returns the shortlist (every
open role scoring 55+, plus named ids and employer posting URLs) with each
posting's text and a `needs_scoring` flag. `POST` stores the deep scores in
`pipeline/headhunt.json`, and the page shows them on each card. Both need
`PIPELINE_EDIT_KEY`.

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
