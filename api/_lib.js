// Shared logic for the Poland role pipeline.
//
// Files under api/ whose name starts with "_" are not routed as functions,
// so this is a plain module the two endpoints import.
//
// No npm dependencies on purpose. The project builds with an empty install
// command, and every attempt so far to give this deployment a real build step
// has broken it. Blob is therefore driven through its REST API with fetch,
// not through @vercel/blob.

import { createHash } from "node:crypto";
import { EXTRA_FETCHERS } from "./_adapters.js";
import { DISCOVERED } from "./_discovered.js";

// --- identity ---------------------------------------------------------------

// Deterministic and idempotent: the same posting yields the same id on every
// run, which is what stops a refresh from re-adding roles already stored (and
// what keeps a flag the user set attached to the right role). Must stay
// byte-compatible with the ids already in the feed — changing it would orphan
// every existing flag.
export function jobId(company, url) {
  const slug = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

// --- filters ----------------------------------------------------------------
// Ported from config.yaml. Kept in the same shape so the two stay comparable.

const LOCATION_KEYWORDS = [
  "poland", "warsaw", "warszawa", "krakow", "kraków", "wroclaw", "wrocław",
  "gdansk", "gdańsk", "gdynia", "poznan", "poznań", "lodz", "łódź", "katowice",
  "remote - poland", "remote (poland)", "remote, poland", "emea remote",
];

const ROLE_KEYWORDS = [
  "consultant", "consulting", "senior associate", "corporate strategy",
  "business strategy", "commercial strategy", "strategy analyst",
  "strategic planning", "strategy & operations", "strategy and operations",
  "corporate development", "transformation", "target operating model",
  "change management", "business analyst", "business analysis",
  "chief of staff", "business manager", "business management",
  "business operations", "pmo", "programme manager", "program manager",
  "programme management", "program management", "project manager",
  "process improvement", "process excellence", "operational excellence",
  "continuous improvement", "process analyst", "business process",
  "operations analyst",
];

// Matched on whole words, unlike ROLE_KEYWORDS above. The asymmetry is
// deliberate and load-bearing: a missed match costs one absent role, but a
// wrong exclusion silently deletes a real one. "intern" must not kill
// "Internal Consultant", and "head" must not kill "Headcount Planning".
const EXCLUDE_TITLE_KEYWORDS = [
  "senior manager", "engagement manager", "head", "director", "vp",
  "vice president", "partner", "principal", "executive", "president",
  "intern", "internship", "trainee", "apprentice", "junior",
  "graduate programme", "graduate program", "working student", "entry level",
  "praktykant", "staz",
  "sales", "recruitment", "recruiter", "talent acquisition", "customer service",
  "account executive", "security", "cyber", "software engineer", "developer",
  "tax", "audit", "legal", "clinical", "medical", "nurse",
  // Technical delivery roles that slipped through on a "Consultant" or
  // "Business Analyst" prefix. The first real sweep surfaced, among others,
  // "Consultant / Senior Consultant – IAM & Secrets Management Delivery",
  // "Senior AI Engineer – AI Transformation & Delivery" and "Data Business
  // Analyst – GCP / Hadoop". A screener reading his CV against any of these
  // rejects it, so they are noise on a shortlist however well the prefix matched.
  "iam", "secrets management", "identity", "access management",
  "engineer", "architect", "devops", "sre", "gcp", "hadoop", "kafka",
  "machine learning", "data science", "cloud", "platform",
  "qa", "tester", "quality assurance", "frontend", "backend", "fullstack",
  "full stack", "salesforce", "sap", "servicenow",
  // Programming stacks. Added with the traced boards: GFT alone listed 46
  // roles passing every other filter, most of them "Expert iOS Consultant",
  // "Java Consultant" and the like — technical delivery behind a consulting
  // title, the same shape as the IAM roles above. Deliberately absent: SQL and
  // Python, which are on his CV and appear in analyst titles he can do; and
  // "swift" and "embedded", which in banking mean the SWIFT payments network
  // and embedded finance — both squarely his territory, not a language.
  "ios", "android", "java", "javascript", "typescript", "golang", "kotlin",
  "scala", "ruby", "php", "react", "angular", "node.js", "dotnet",
  "mainframe", "cobol", "abap", "firmware", "kubernetes",
  "terraform", "flutter", "unity",
];

// Postings that say Polish is required. He does not speak it, so these are
// dropped even when the rest of the listing is in English.
const REQUIRES_POLISH = [
  "polish language", "fluent polish", "fluency in polish",
  "polish is required", "polish speaking", "native polish",
  "język polski", "znajomość języka polskiego",
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesLocation(location) {
  const l = (location || "").toLowerCase();
  return LOCATION_KEYWORDS.some((k) => l.includes(k));
}

export function matchesRole(title) {
  const t = (title || "").toLowerCase();
  return ROLE_KEYWORDS.some((k) => t.includes(k));
}

export function excludedByTitle(title) {
  const t = (title || "").toLowerCase();
  return EXCLUDE_TITLE_KEYWORDS.some((k) =>
    new RegExp(`\\b${escapeRegExp(k)}\\b`).test(t)
  );
}

export function requiresPolish(description) {
  const d = (description || "").toLowerCase();
  return REQUIRES_POLISH.some((k) => d.includes(k));
}

// Languages he does not have. English is his working language and the reason
// the whole pipeline filters for English-speaking roles; everything here is a
// hard screen-out, not a weakness — he cannot acquire German by Tuesday.
//
// Arabic is deliberately absent. He works in Dubai and his resume claims no
// languages either way, so excluding it could drop a role he can actually do,
// and an Arabic-required role in Poland is vanishingly rare regardless.
const OTHER_LANGUAGES =
  "german|french|dutch|flemish|spanish|italian|portuguese|polish|czech|slovak|" +
  "hungarian|romanian|bulgarian|croatian|serbian|slovenian|norwegian|swedish|" +
  "danish|finnish|icelandic|russian|ukrainian|turkish|greek|hebrew|japanese|" +
  "korean|mandarin|chinese";

// The Big Four in Poland advertise language-gated roles as "… with German",
// which is why three of the top ten on the shortlist were unreachable. Their
// Workday and SmartRecruiters list APIs return no description, so the title is
// the only place this can be caught.
//
// "\bgerman\b" does not match "Germany": \b needs a non-word character after
// the match, and "y" is one. A role located in Germany is not a role requiring
// German, and conflating them would drop legitimate postings.
const LANGUAGE_REQUIRED = new RegExp(
  [
    `\\bwith\\s+(${OTHER_LANGUAGES})\\b`,
    `\\b(${OTHER_LANGUAGES})[\\s-]speaking\\b`,
    `\\b(${OTHER_LANGUAGES})\\s+speaker`,
    `\\b(fluent|native|proficient|advanced)\\s+(${OTHER_LANGUAGES})\\b`,
    `\\b(${OTHER_LANGUAGES})\\s+(language\\s+)?(required|mandatory|a must)\\b`,
    `\\(${OTHER_LANGUAGES}\\)`,
  ].join("|"),
  "i"
);

export function requiresOtherLanguage(text) {
  return LANGUAGE_REQUIRED.test(text || "");
}

export function keep(job) {
  return (
    matchesLocation(job.location) &&
    matchesRole(job.title) &&
    !excludedByTitle(job.title) &&
    !requiresPolish(job.description) &&
    // Both fields: Greenhouse, Lever and Ashby supply a description, so a
    // requirement buried in the body is caught here even though the stored-role
    // path in assess() can only see the title.
    !requiresOtherLanguage(job.title) &&
    !requiresOtherLanguage(job.description)
  );
}

// --- ATS sources ------------------------------------------------------------
//
// Only slugs confirmed to resolve are listed as `verified`. The rest are
// educated guesses that cost one fast 404 each; the refresh response reports
// per-source counts so dead ones are easy to spot and delete.

// Every entry below was probed against the live API and returned postings.
// Seven guessed slugs — Revolut, DocPlanner, Booksy, Netguru, Brainly, Tidio,
// Spacelift — were removed after returning nothing on every run; they were
// inherited guesses, and a board that answers with an empty list is
// indistinguishable from one that has no matching roles.
export const SOURCES = {
  greenhouse: [
    { name: "Capco", slug: "capco" },
    { name: "Xebia", slug: "xebiacee" },
    { name: "VML Enterprise Solutions", slug: "vmlenterprisesolutions" },
    { name: "Wise", slug: "wise" },
    // Added after a scan of ~70 candidates; each returned postings mentioning
    // Poland. Stripe and Adyen carry few Poland roles but are payments firms,
    // which is the one product sector his ACH/NACHA work speaks to directly.
    { name: "HelloFresh", slug: "hellofresh" },
    { name: "Stripe", slug: "stripe" },
    { name: "Adyen", slug: "adyen" },
    { name: "Datadog", slug: "datadog" },
    // Found by tools/discover_boards.mjs, which reads the aggregators for
    // EMPLOYER NAMES only and then looks for that employer's own board. Duco is
    // the single verified result from a sweep of 231 employers: its Greenhouse
    // board declares "Duco" and carries a Wroclaw office. Reconciliation and
    // data automation for financial services — the closest thing in the feed to
    // the ACH/NACHA work at Deloitte.
    { name: "Duco", slug: "duco" },
  ],
  ashby: [
    { name: "Zowie", slug: "zowie" },
  ],
  smartrecruiters: [
    { name: "InPost", slug: "inpost" },
    { name: "Endava", slug: "endava" },
    { name: "Delivery Hero", slug: "deliveryhero" },
    { name: "Allegro", slug: "allegro" },
  ],
  // The consulting firms, on their own systems. These are where his profile
  // actually screens well, and until now their roles only ever reached the
  // feed second-hand through aggregators.
  workday: [
    {
      name: "Accenture",
      host: "accenture.wd103.myworkdayjobs.com",
      tenant: "accenture",
      site: "AccentureCareers",
    },
    {
      name: "PwC",
      host: "pwc.wd3.myworkdayjobs.com",
      tenant: "pwc",
      site: "Global_Experienced_Careers",
    },
  ],
};

// Boards found by tracing aggregator employers to their own careers pages.
// Kept in their own module because they are generated and verified by
// tools/build_sources.mjs, while the entries above were chosen by hand.
for (const [platform, boards] of Object.entries(DISCOVERED)) {
  SOURCES[platform] = [...(SOURCES[platform] || []), ...boards];
}

const TIMEOUT_MS = 8000;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "poland-pipeline/1.0" },
    });
    if (!res.ok) return null; // a 404 here just means "not this board"
    return await res.json();
  } catch {
    return null; // a slow or dead board must not fail the whole run
  } finally {
    clearTimeout(timer);
  }
}

async function fromGreenhouse({ name, slug }) {
  const data = await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
  );
  if (!data?.jobs) return [];
  return data.jobs.map((j) => ({
    title: j.title,
    company: name,
    url: j.absolute_url,
    location: j.location?.name || "",
    description: j.content || "",
    posted_at: j.first_published || j.updated_at || null,
  }));
}

async function fromLever({ name, slug, eu = false }) {
  const data = await getJson(`https://api.${eu ? "eu." : ""}lever.co/v0/postings/${slug}?mode=json`);
  if (!Array.isArray(data)) return [];
  return data.map((j) => ({
    title: j.text,
    company: name,
    url: j.hostedUrl,
    location: j.categories?.location || "",
    description: j.descriptionPlain || "",
    // Lever gives epoch milliseconds.
    posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
  }));
}

async function fromAshby({ name, slug }) {
  const data = await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=false`
  );
  if (!data?.jobs) return [];
  return data.jobs.map((j) => ({
    title: j.title,
    company: name,
    url: j.jobUrl,
    location: j.location || "",
    description: j.descriptionPlain || "",
    posted_at: j.publishedAt || null,
  }));
}

// Workday powers Accenture's and PwC's own career sites. Its public "CXS"
// endpoint takes a POST and answers with a page of postings; both were probed
// against the live API before being added here, unlike the slugs they replace.
//
// Two things it does NOT give, which matter downstream:
//   - a real posting date, only relative prose ("Posted 30+ Days Ago")
//   - any description, so the Polish-fluency filter cannot run on these
async function fromWorkday({ name, host, site, tenant, recruiting = false, pages = 10 }) {
  // Ten pages of twenty. At four, every large tenant (State Street, Citi,
  // Accenture, Rockwool) came back at exactly 80 — the cap, not the count —
  // and anything past it would have been marked stale on the next run.
  //
  // Two hosting shapes. Most tenants live on {tenant}.wdN.myworkdayjobs.com and
  // link jobs as /{site}/job/...; some live on wdN.myworkdaysite.com, where the
  // tenant moves into the path. The CXS endpoint is the same for both.
  const jobBase = recruiting
    ? `https://${host}/recruiting/${tenant}/${site}`
    : `https://${host}/${site}`;
  const out = [];
  for (let page = 0; page < pages; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let data;
    try {
      const res = await fetch(
        `https://${host}/wday/cxs/${tenant}/${site}/jobs`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": "poland-pipeline/1.0",
          },
          body: JSON.stringify({
            limit: 20,
            offset: page * 20,
            searchText: "Poland",
            appliedFacets: {},
          }),
        }
      );
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break; // partial results beat none
    } finally {
      clearTimeout(timer);
    }
    const batch = data?.jobPostings || [];
    if (!batch.length) break;
    for (const j of batch) {
      if (!j.externalPath) continue;
      out.push({
        title: j.title,
        company: name,
        url: `${jobBase}${j.externalPath}`,
        // The city sits in the path (/job/Warsaw/...) and often in bulletFields;
        // locationsText says "3 Locations" when there are several, which names
        // no city at all, so the path is the more reliable of the three.
        location: [
          decodeURIComponent(j.externalPath.split("/")[2] || ""),
          ...(j.bulletFields || []),
          j.locationsText || "",
        ].join(" "),
        description: "",
        posted_at: relativePostedAt(j.postedOn),
      });
    }
    if (batch.length < 20) break;
  }
  return out;
}

// "Posted 30+ Days Ago" is not a date. Turn it into one, and be honest that it
// is a floor rather than a fact: 30+ could be sixty. It is still far better
// than falling back to the day we happened to look.
function relativePostedAt(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const day = 86_400_000;
  let daysAgo = null;
  if (t.includes("today")) daysAgo = 0;
  else if (t.includes("yesterday")) daysAgo = 1;
  else {
    const m = t.match(/(\d+)\+?\s*day/);
    if (m) daysAgo = Number(m[1]);
  }
  if (daysAgo === null) return null;
  return new Date(Date.now() - daysAgo * day).toISOString();
}

// SmartRecruiters, unlike Workday, gives a real released date and a fully
// spelled-out location. It still omits the description from the list response,
// so the Polish-fluency filter cannot run on these either.
async function fromSmartRecruiters({ name, slug }) {
  const data = await getJson(
    `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`
  );
  if (!data?.content) return [];
  return data.content.map((j) => ({
    title: j.name,
    company: name,
    url: `https://jobs.smartrecruiters.com/${j.company?.identifier || slug}/${j.id}`,
    location: j.location?.fullLocation ||
      [j.location?.city, j.location?.country].filter(Boolean).join(", "),
    description: "",
    posted_at: j.releasedDate || null,
  }));
}

export const FETCHERS = {
  greenhouse: fromGreenhouse,
  lever: fromLever,
  ashby: fromAshby,
  workday: fromWorkday,
  smartrecruiters: fromSmartRecruiters,
  // Platforms found by tracing aggregator employers to their own careers pages.
  ...EXTRA_FETCHERS,
};

// Every board is queried in parallel; one bad board yields [] rather than
// taking the run down with it.
export async function fetchAll() {
  const tasks = [];
  for (const [platform, boards] of Object.entries(SOURCES)) {
    for (const board of boards) {
      tasks.push(
        FETCHERS[platform](board).then((jobs) => ({
          platform,
          board: board.name,
          jobs,
        }))
      );
    }
  }
  return Promise.all(tasks);
}

// --- blob storage -----------------------------------------------------------

export const FEED_PATH = "pipeline/jobs.json";
export const RUN_LOG_PATH = "pipeline/last-run.json";

// The public base URL of a Blob store is only knowable after something has
// been written to it, so it cannot be configured up front. Ask the store where
// the object lives instead — that works on the very first run, when the object
// does not exist yet and the answer is simply "nowhere".
async function blobUrl(pathname) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://blob.vercel-storage.com/?prefix=${encodeURIComponent(pathname)}&limit=1`,
      { headers: { authorization: `Bearer ${token}`, "x-api-version": "7" } }
    );
    if (!res.ok) return null;
    const { blobs } = await res.json();
    return blobs?.find((b) => b.pathname === pathname)?.url || null;
  } catch {
    return null;
  }
}

export async function readBlob(pathname) {
  const url = await blobUrl(pathname);
  if (!url) return null;
  try {
    // no-store, or we would append to a stale baseline and silently drop
    // whatever the previous run stored.
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function readFeed() {
  return readBlob(FEED_PATH);
}

export function readRunLog() {
  return readBlob(RUN_LOG_PATH);
}

export async function writeBlob(pathname, data) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  const res = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "7",
      "x-content-type": "application/json",
      // A random suffix would change the URL on every write, and the read side
      // needs one stable address.
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "0",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`blob write failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function writeFeed(feed) {
  return writeBlob(FEED_PATH, feed);
}

export function writeRunLog(run) {
  return writeBlob(RUN_LOG_PATH, run);
}

// --- liveness ---------------------------------------------------------------
//
// Whether a posting is still open. This runs in the Vercel function because
// that is the only place in this system with unproxied outbound access — the
// development sandbox cannot reach employer sites at all.
//
// HEAD first, since it is cheap and most ATS hosts answer it. Some reject HEAD
// with 405 while serving GET perfectly well, so that one case falls through
// rather than being recorded as dead.

const LIVE_TIMEOUT_MS = 6000;

export async function checkLive(url) {
  for (const method of ["HEAD", "GET"]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": "poland-pipeline/1.0" },
      });
      if (method === "HEAD" && (res.status === 405 || res.status === 501)) continue;
      // A redirect to a board root is how several ATS hosts retire a posting:
      // the URL still answers 200, but not with the job.
      const landed = res.url || url;
      const retired =
        /\/(jobs|careers|search|embed)\/?$/i.test(new URL(landed).pathname) &&
        landed !== url;
      return {
        status: res.status,
        live: res.ok && !retired,
        redirected_to: landed !== url ? landed : undefined,
      };
    } catch (err) {
      // A timeout or network error is not evidence the job is gone; say so
      // rather than marking a live posting dead on one bad request.
      if (method === "GET") return { status: null, live: null, error: err.name || "fetch failed" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: null, live: null, error: "unreachable" };
}

// Bounded concurrency: 54 simultaneous requests would trip rate limits and
// blow the function's time budget.
export async function checkAllLive(urls, { concurrency = 8, budgetMs = 20000 } = {}) {
  const started = Date.now();
  const out = new Map();
  const queue = [...urls];
  async function worker() {
    while (queue.length) {
      if (Date.now() - started > budgetMs) return; // leave the rest unknown
      const url = queue.shift();
      out.set(url, await checkLive(url));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
