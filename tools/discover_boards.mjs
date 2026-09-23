// Employer discovery from aggregators — WITHOUT letting an aggregator link into
// the feed.
//
// Glassdoor and Indeed are hard-blocked at the edge (403 from a real, unproxied
// network, not just from the dev sandbox), and their public job APIs were
// retired years ago. What does answer is NoFluffJobs' search API and LinkedIn's
// guest endpoint. Neither is allowed to contribute a LINK: the pipeline's
// first-party rule (api/_fit.js AGGREGATORS) still refuses all of them.
//
// They are used for one thing only — telling us WHICH employers are hiring
// consultants in Poland. We take the names, discard the links, and go looking
// for that employer's own ATS board. A board that passes verification is added
// to SOURCES, after which the normal sweep finds its roles with first-party
// links, liveness checks and fit scoring already applied.
//
// Run from a Vercel sandbox — the dev proxy refuses every host below.
//   node tools/discover_boards.mjs
//
// ---------------------------------------------------------------------------
// TWO GATES, BOTH LEARNED THE HARD WAY
//
// 1. A probe must return actual POSTINGS. The earlier Workday tenant sweep
//    treated HTTP 422 as "tenant exists" and produced ~130 false positives.
//
// 2. The board must DECLARE THE EMPLOYER'S OWN NAME. Gate 1 alone is not
//    enough, and this is the subtle one: a slug that exists and serves postings
//    may belong to an entirely different company. Measured on a real run of 231
//    employers, gate 1 alone produced 11 "hits" of which 8 were other companies
//    —- lever/oliverwyman is an SF software firm advertising an Account
//    Executive, not the consultancy; greenhouse/link is a US defence contractor
//    hiring in Fort Meade, not Poland's Link Group; ashby/vector is unrelated.
//
// Even with both gates, read the output before trusting it. "LINK" still
// matches "Link Group" on substring, so the sample locations are printed for
// exactly that reason: they are what exposes a wrong match.
// ---------------------------------------------------------------------------

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Already in SOURCES.
const KNOWN = new Set([
  "capco", "xebia", "xebiacee", "vml", "vmlenterprisesolutions", "wise",
  "hellofresh", "stripe", "adyen", "datadog", "zowie", "inpost", "endava",
  "deliveryhero", "allegro", "accenture", "accenturepoland", "pwc", "duco",
]);

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Legal suffixes and filler that never appear in an ATS slug.
const STRIP = /\b(sp\.?\s*z\s*o\.?\s*o\.?|s\.?a\.?|gmbh|ltd|limited|inc|llc|llp|bv|nv|poland|polska|group|holding|international|global|services|solutions|technologies|technology|consulting|company)\b/gi;

function slugVariants(name) {
  const base = name.trim();
  const stripped = base.replace(STRIP, " ").trim();
  const out = new Set();
  for (const v of [base, stripped]) {
    if (!v) continue;
    out.add(norm(v));
    out.add(v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
    const first = v.trim().split(/\s+/)[0];
    if (first && first.length >= 4) out.add(norm(first));
  }
  return [...out].filter((s) => s.length >= 3 && s.length <= 40).slice(0, 4);
}

async function get(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": UA, ...(opts.headers || {}) },
      method: opts.method || "GET",
      body: opts.body,
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

// --- 1. discovery ----------------------------------------------------------

async function collect() {
  const employers = new Map();

  for (const q of ["consulting", "business analyst", "project manager", "transformation", "process", "PMO"]) {
    for (const page of [1, 2]) {
      // This query string is load-bearing. Dropping salaryCurrency/salaryPeriod
      // makes the endpoint answer 400.
      const r = await get(
        `https://nofluffjobs.com/api/search/posting?page=${page}&salaryCurrency=PLN&salaryPeriod=month&region=pl`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rawSearch: q }) }
      );
      if (!r.ok) { console.log(`  nofluffjobs "${q}" p${page}: HTTP ${r.status}`); continue; }
      let data;
      try { data = JSON.parse(r.text); } catch { continue; }
      const rows = data.postings || [];
      for (const p of rows) if (p.name) employers.set(norm(p.name), p.name);
      console.log(`  nofluffjobs "${q}" p${page}: ${rows.length} of ${data.totalCount}`);
    }
  }

  for (const q of ["management consultant", "business transformation", "finance transformation",
                   "strategy consultant", "operating model", "PMO", "business analyst", "process improvement"]) {
    let cards = 0;
    for (const start of [0, 25, 50, 75]) {
      const r = await get(
        "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
        + `?keywords=${encodeURIComponent(q)}&location=Poland&start=${start}`
      );
      if (!r.ok) continue;
      // The subtitle anchor carries the employer. We take its TEXT and throw the
      // href away: the href is a LinkedIn company page, useless for applying.
      for (const m of r.text.matchAll(/base-search-card__subtitle[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+?)\s*(?:<\/a>)?\s*<\//g)) {
        const co = m[1].trim();
        if (co) { employers.set(norm(co), co); cards++; }
      }
    }
    console.log(`  linkedin "${q}": ${cards} cards`);
  }

  return employers;
}

// --- 2. verified resolution ------------------------------------------------

const PROBES = [
  {
    platform: "greenhouse",
    meta: async (s) => {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${s}`);
      if (!r.ok) return null;
      try { return JSON.parse(r.text).name; } catch { return null; }
    },
    jobs: async (s) => {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`);
      if (!r.ok) return [];
      try { return JSON.parse(r.text).jobs || []; } catch { return []; }
    },
    loc: (j) => (j.location && j.location.name) || "",
  },
  {
    platform: "ashby",
    meta: async (s) => {
      const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
      if (!r.ok) return null;
      try { const d = JSON.parse(r.text); return d.organizationName || d.name || null; } catch { return null; }
    },
    jobs: async (s) => {
      const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
      if (!r.ok) return [];
      try { return JSON.parse(r.text).jobs || []; } catch { return []; }
    },
    loc: (j) => j.location || "",
  },
  {
    platform: "smartrecruiters",
    meta: async (s) => {
      const r = await get(`https://api.smartrecruiters.com/v1/companies/${s}`);
      if (!r.ok) return null;
      try { return JSON.parse(r.text).name; } catch { return null; }
    },
    jobs: async (s) => {
      const r = await get(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`);
      if (!r.ok) return [];
      try { return JSON.parse(r.text).content || []; } catch { return []; }
    },
    loc: (j) => (j.location && (j.location.city || j.location.country)) || "",
  },
  // Lever is deliberately absent. It publishes no board-metadata endpoint, so
  // gate 2 cannot be applied to it, and gate 1 alone is what produced the
  // oliverwyman false positive.
];

const PL = /pol(and|ska)|warsz|warsaw|krak|wroc|gdan|gdyn|pozna|katowic|lodz|łódź|szczecin|lublin|rzeszow/i;

function nameMatches(declared, wanted) {
  const a = norm(declared);
  const b = norm(wanted);
  if (!a || !b) return false;
  if (a === b) return true;
  const stripped = norm(wanted.replace(STRIP, " "));
  if (stripped && (a === stripped || a.includes(stripped) || stripped.includes(a))) return true;
  return a.includes(b) || b.includes(a);
}

async function resolve(name) {
  for (const slug of slugVariants(name)) {
    for (const probe of PROBES) {
      const declared = await probe.meta(slug);
      if (!declared) continue;
      if (!nameMatches(declared, name)) continue;
      const jobs = await probe.jobs(slug);
      if (!jobs.length) continue;
      const locs = jobs.map(probe.loc).filter(Boolean);
      return {
        platform: probe.platform,
        slug,
        declared,
        jobs: jobs.length,
        poland: locs.some((l) => PL.test(l)),
        sampleLocs: [...new Set(locs)].slice(0, 5),
      };
    }
  }
  return null;
}

// --- run -------------------------------------------------------------------

console.log("== discovery ==");
const employers = await collect();
const candidates = [...employers.entries()].filter(([k]) => !KNOWN.has(k)).map(([, v]) => v);
console.log(`\n${employers.size} distinct employers, ${candidates.length} new\n`);

console.log("== verified resolution ==");
const hits = [];
const queue = [...candidates];

// Sequential probing would outlive the sandbox. Each worker holds one request
// at a time and the platforms are hit round-robin, so no single API is hammered.
async function worker() {
  for (;;) {
    const name = queue.shift();
    if (!name) return;
    const found = await resolve(name);
    if (found) {
      hits.push({ name, ...found });
      console.log(`  HIT ${name} -> ${found.platform}/${found.slug} declared="${found.declared}" `
        + `${found.jobs} jobs PL=${found.poland} [${found.sampleLocs.join(" | ")}]`);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

console.log(`\n== ${hits.length} verified out of ${candidates.length} ==`);
console.log("Check the sample locations before adding any of these to SOURCES.");
console.log(JSON.stringify(hits, null, 1));
