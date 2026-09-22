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

export function keep(job) {
  return (
    matchesLocation(job.location) &&
    matchesRole(job.title) &&
    !excludedByTitle(job.title) &&
    !requiresPolish(job.description)
  );
}

// --- ATS sources ------------------------------------------------------------
//
// Only slugs confirmed to resolve are listed as `verified`. The rest are
// educated guesses that cost one fast 404 each; the refresh response reports
// per-source counts so dead ones are easy to spot and delete.

export const SOURCES = {
  greenhouse: [
    { name: "Capco", slug: "capco", verified: true },
    { name: "Xebia", slug: "xebiacee", verified: true },
    { name: "VML Enterprise Solutions", slug: "vmlenterprisesolutions", verified: true },
    { name: "Wise", slug: "wise" },
    { name: "Revolut", slug: "revolut" },
    { name: "DocPlanner", slug: "docplanner" },
    { name: "Booksy", slug: "booksy" },
    { name: "Netguru", slug: "netguru" },
  ],
  lever: [
    { name: "Brainly", slug: "brainly" },
    { name: "Tidio", slug: "tidio" },
  ],
  ashby: [
    { name: "Spacelift", slug: "spacelift" },
    { name: "Zowie", slug: "zowie" },
  ],
};

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
  }));
}

async function fromLever({ name, slug }) {
  const data = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!Array.isArray(data)) return [];
  return data.map((j) => ({
    title: j.text,
    company: name,
    url: j.hostedUrl,
    location: j.categories?.location || "",
    description: j.descriptionPlain || "",
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
  }));
}

const FETCHERS = {
  greenhouse: fromGreenhouse,
  lever: fromLever,
  ashby: fromAshby,
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
