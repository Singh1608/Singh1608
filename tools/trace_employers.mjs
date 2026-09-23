// Trace every employer hiring consultants in Poland back to its OWN
// application system.
//
// The aggregators are read for evidence only — never for links that reach the
// feed. For each employer we collect:
//   - its website (NoFluffJobs posting detail, LinkedIn company page)
//   - any apply URL it publishes (justjoin.it applyUrl, NoFluffJobs apply)
// then walk from the website to its careers page and record which ATS the
// employer itself links to. That is the difference from slug guessing, which
// produced 8 false positives in 11: here the evidence comes from the
// employer's own site.
//
// Output: /w/trace.json — one record per employer with every ATS reference
// found and the page it was found on. Verification against each platform's
// API is a separate step (tools/verify_boards.mjs).
//
// Runs from a Vercel sandbox; the dev proxy refuses all of these hosts.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function get(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 15000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9,pl;q=0.8", ...(opts.headers || {}) },
      method: opts.method || "GET",
      body: opts.body,
    });
    let text = await res.text();
    if (text.length > 3_000_000) text = text.slice(0, 3_000_000);
    return { ok: res.ok, status: res.status, url: res.url, text };
  } catch {
    return { ok: false, status: 0, url, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, n, fn) {
  const q = [...items];
  const out = [];
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const it = q.shift();
      if (it === undefined) return;
      out.push(await fn(it));
    }
  }));
  return out;
}

// Same vocabulary as the pipeline's ROLE_KEYWORDS, so discovery looks where
// the feed will eventually filter.
const ROLE = /consult|strateg|transformation|operating model|change management|business analy|chief of staff|business manage|business operations|\bpmo\b|programme|program manag|project manag|process|operational excellence|continuous improvement|operations analyst|corporate development/i;

// --- employer registry -----------------------------------------------------

const emp = new Map();
function add(name, src) {
  const k = norm(name);
  if (!k) return null;
  let e = emp.get(k);
  if (!e) {
    e = { name: name.trim(), sources: new Set(), websites: new Set(), applyUrls: new Set(), li: new Set(), nfj: [] };
    emp.set(k, e);
  }
  e.sources.add(src);
  return e;
}

const NOT_EMPLOYER_HOST = /nofluffjobs|linkedin|justjoin|pracuj|facebook|instagram|twitter|x\.com|youtube|google|gstatic|gravatar|apple\.com|microsoft\.com\/?$/i;

function urlsIn(text) {
  return [...String(text).matchAll(/https?:\/\/[^\s"'<>\\)]+/g)].map((m) => m[0].replace(/[.,;]+$/, ""));
}

// --- 1. NoFluffJobs ---------------------------------------------------------

async function collectNoFluffJobs() {
  const Q = ["consulting", "consultant", "business analyst", "project manager", "programme manager",
    "program manager", "transformation", "process", "PMO", "strategy", "change management",
    "operations", "business operations", "chief of staff", "operational excellence", "continuous improvement"];
  for (const q of Q) {
    for (let page = 1; page <= 8; page++) {
      // The salary params are load-bearing: without them the endpoint answers 400.
      const r = await get(`https://nofluffjobs.com/api/search/posting?page=${page}&salaryCurrency=PLN&salaryPeriod=month&region=pl`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rawSearch: q }),
      });
      if (!r.ok) break;
      let d;
      try { d = JSON.parse(r.text); } catch { break; }
      const rows = d.postings || [];
      for (const p of rows) {
        if (!p.name) continue;
        const e = add(p.name, "nofluffjobs");
        if (e.nfj.length < 2 && !e.nfj.includes(p.id)) e.nfj.push(p.id);
      }
      if (!rows.length || page >= (d.totalPages || 1)) break;
    }
  }
  const withIds = [...emp.values()].filter((e) => e.nfj.length);
  await pool(withIds, 6, async (e) => {
    for (const id of e.nfj) {
      const r = await get(`https://nofluffjobs.com/api/posting/${id}`);
      if (!r.ok) continue;
      let x;
      try { x = JSON.parse(r.text); } catch { continue; }
      if (x.company?.url) e.websites.add(x.company.url);
      for (const u of urlsIn(JSON.stringify(x.apply || {}))) if (!NOT_EMPLOYER_HOST.test(u)) e.applyUrls.add(u);
    }
  });
  console.log(`nofluffjobs: ${withIds.length} employers`);
}

// --- 2. LinkedIn guest ------------------------------------------------------

async function collectLinkedIn() {
  const Q = ["management consultant", "business transformation", "finance transformation", "strategy consultant",
    "operating model", "PMO", "business analyst", "process improvement", "programme manager", "project manager",
    "change management", "chief of staff", "business operations", "strategy analyst", "corporate development",
    "operational excellence"];
  let seen = 0;
  // Three queries at a time. Sequential paging with a pause per page took
  // longer than the sandbox lives; three concurrent streams with a short pause
  // each stay well clear of LinkedIn's 429s in practice.
  await pool(Q, 3, async (q) => {
    for (let start = 0; start <= 150; start += 10) {
      let r = await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}&location=Poland&start=${start}`);
      if (r.status === 429) { await sleep(6000); r = await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}&location=Poland&start=${start}`); }
      if (!r.ok) break;
      const cards = [...r.text.matchAll(/base-search-card__subtitle[^>]*>\s*(?:<a[^>]*href="([^"]+)"[^>]*>)?\s*([^<]+?)\s*</g)];
      if (!cards.length) break;
      for (const m of cards) {
        const e = add(m[2], "linkedin");
        if (e && m[1]) e.li.add(m[1].replace(/&amp;/g, "&").split("?")[0]);
        seen++;
      }
      await sleep(150);
    }
  });
  const withLi = [...emp.values()].filter((e) => e.li.size && !e.websites.size);
  await pool(withLi, 4, async (e) => {
    const page = [...e.li][0];
    let r = await get(page);
    if (r.status === 429) { await sleep(8000); r = await get(page); }
    const m = r.text.match(/data-tracking-control-name="about_website"[^>]*href="([^"]+)"/) ||
              r.text.match(/href="([^"]+)"[^>]*data-tracking-control-name="about_website"/);
    if (m) {
      let site = m[1].replace(/&amp;/g, "&");
      if (site.includes("linkedin.com/redir")) {
        try { site = new URL(site).searchParams.get("url") || site; } catch { /* keep */ }
      }
      e.websites.add(site);
    }
    await sleep(300);
  });
  console.log(`linkedin: ${seen} cards, ${withLi.length} company pages read`);
}

// --- 3. justjoin.it ---------------------------------------------------------

async function collectJustJoin() {
  let from = 0;
  let matched = 0;
  for (let i = 0; i < 120; i++) {
    const r = await get(`https://justjoin.it/api/candidate-api/offers?perPage=100&from=${from}`, { headers: { accept: "application/json" } });
    if (!r.ok) break;
    let d;
    try { d = JSON.parse(r.text); } catch { break; }
    for (const o of d.data || []) {
      if (!o.companyName || !ROLE.test(o.title || "")) continue;
      const e = add(o.companyName, "justjoin");
      if (o.applyUrl && !NOT_EMPLOYER_HOST.test(o.applyUrl)) e.applyUrls.add(o.applyUrl);
      if (o.companyUrl) e.websites.add(o.companyUrl);
      matched++;
    }
    const next = d.meta?.next?.cursor;
    if (next == null || next === from || !(d.data || []).length) break;
    from = next;
  }
  console.log(`justjoin: ${matched} matching offers`);
}

// --- ATS fingerprints -------------------------------------------------------
// Each pattern extracts the identifiers the platform's API needs. They are
// matched against URLs and raw HTML of pages the EMPLOYER serves.

const GENERIC_SUB = /^(www|api|cdn|static|assets|app|help|support|blog|docs|status|mail|careers?|jobs?)$/i;
const ATS = [
  { p: "workday", re: /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g,
    id: (m) => ({ host: `${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3] }) },
  { p: "workday", re: /(wd\d+)\.myworkdaysite\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\/([a-z0-9_-]+)\/([A-Za-z0-9_-]+)/g,
    id: (m) => ({ host: `${m[1]}.myworkdaysite.com`, tenant: m[2], site: m[3], recruiting: true }) },
  { p: "greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/gi,
    id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "lever", re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+)/gi, id: (m) => ({ slug: m[1].toLowerCase(), eu: /eu\.lever/.test(m[0]) }) },
  { p: "ashby", re: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/g, id: (m) => ({ slug: decodeURIComponent(m[1]) }) },
  { p: "smartrecruiters", re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g, id: (m) => ({ slug: m[1] }) },
  { p: "recruitee", re: /\b([a-z0-9-]+)\.recruitee\.com/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "personio", re: /\b([a-z0-9-]+)\.jobs\.personio\.(de|com)/gi, id: (m) => ({ slug: m[1].toLowerCase(), tld: m[2] }) },
  { p: "workable", re: /apply\.workable\.com\/([a-z0-9_-]+)/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "teamtailor", re: /\b([a-z0-9-]+)\.teamtailor\.com/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "traffit", re: /\b([a-z0-9-]+)\.traffit\.com/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "erecruiter", re: /\b(?:[a-z0-9-]+\.)?erecruiter\.pl\/[^"'\s<>]*/gi, id: (m) => ({ url: m[0] }) },
  { p: "successfactors", re: /\b([a-z0-9-]+)\.(successfactors\.(?:com|eu)|sapsf\.(?:com|eu))\/(?:career|sfcareer\/jobreqcareer)\?[^"'\s<>]*company=([A-Za-z0-9_]+)/g,
    id: (m) => ({ host: `${m[1]}.${m[2]}`, company: m[3] }) },
  { p: "jobs2web", re: /\b([a-z0-9-]+)\.jobs2web\.com/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "oracle", re: /\b([a-z0-9-]+)\.fa\.([a-z0-9-]+)\.oraclecloud\.com\/hcmUI\/CandidateExperience\/[a-z]{2}(?:-[A-Z]{2})?\/sites\/([A-Za-z0-9_]+)/g,
    id: (m) => ({ host: `${m[1]}.fa.${m[2]}.oraclecloud.com`, site: m[3] }) },
  { p: "taleo", re: /\b([a-z0-9]+)\.taleo\.net\/careersection\/([A-Za-z0-9_.-]+)/gi, id: (m) => ({ host: `${m[1]}.taleo.net`, section: m[2] }) },
  { p: "icims", re: /\b(?:careers-)?([a-z0-9-]+)\.icims\.com/gi, id: (m) => ({ host: m[0].replace(/^.*?(?=[a-z0-9-]+\.icims)/i, "") }) },
  { p: "eightfold", re: /\b([a-z0-9-]+)\.eightfold\.ai/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "avature", re: /\b([a-z0-9-]+)\.avature\.net/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "bamboohr", re: /\b([a-z0-9-]+)\.bamboohr\.com/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "breezy", re: /\b([a-z0-9-]+)\.breezy\.hr/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "jobvite", re: /jobs\.jobvite\.com\/([a-z0-9_-]+)/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "softgarden", re: /\b([a-z0-9-]+)\.softgarden\.io/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "join", re: /join\.com\/companies\/([a-z0-9_-]+)/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "pinpoint", re: /\b([a-z0-9-]+)\.pinpointhq\.com/gi, id: (m) => ({ slug: m[1].toLowerCase() }) },
  { p: "csod", re: /\b([a-z0-9-]+)\.csod\.com\/ux\/ats\/careersite\/(\d+)/gi, id: (m) => ({ slug: m[1].toLowerCase(), site: m[2] }) },
  { p: "recruitify", re: /app\.recruitify\.ai\/project\/(\d+)/gi, id: (m) => ({ project: m[1] }) },
  { p: "phenom", re: /cdn\.phenompeople\.com|phenompeople\.com|"phenomapi|ph-page-element/gi, id: () => ({}) },
];

function fingerprint(text, where) {
  const found = [];
  for (const a of ATS) {
    a.re.lastIndex = 0;
    for (const m of String(text).matchAll(a.re)) {
      const id = a.id(m);
      if (id.slug && GENERIC_SUB.test(id.slug)) continue;
      found.push({ p: a.p, ...id, where });
    }
  }
  return found;
}

// --- 4. walk from the employer's site to its careers page ------------------

const CAREER_LINK = /(career|karier|kariera|\bjobs?\b|\/jobs|praca|join[- ]?us|work[- ]with[- ]us|vacanc|oferty|open[- ]positions|do[lł][aą]cz|job[- ]openings|search[- ]jobs|see[- ]all[- ]jobs|current[- ]openings)/i;
const FALLBACK_PATHS = ["/careers", "/career", "/kariera", "/jobs", "/en/careers", "/pl/kariera", "/join-us"];

function anchors(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    let href;
    try { href = new URL(m[1].replace(/&amp;/g, "&"), base).href; } catch { continue; }
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ href, text });
  }
  return out;
}

function siteOf(u) {
  try { const h = new URL(u).hostname.replace(/^www\./, ""); return h.split(".").slice(-2).join("."); } catch { return ""; }
}

async function trace(e) {
  const rec = { name: e.name, sources: [...e.sources], websites: [...e.websites], applyUrls: [...e.applyUrls], ats: [], pages: [] };
  // Direct evidence first: an apply URL the employer published.
  for (const u of e.applyUrls) {
    rec.ats.push(...fingerprint(u, `applyUrl ${u}`));
    const r = await get(u);
    if (r.ok) {
      rec.pages.push(r.url);
      rec.ats.push(...fingerprint(r.url, `applyUrl→${r.url}`), ...fingerprint(r.text, `applyUrl page ${r.url}`));
    }
  }
  let fetched = 0;
  const visited = new Set();
  const queue = [];
  for (const w of e.websites) {
    let u = w.trim();
    if (!/^https?:/.test(u)) u = "https://" + u;
    queue.push({ url: u, hop: 0 });
  }
  const home = queue[0]?.url;
  while (queue.length && fetched < 12) {
    const { url, hop } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const r = await get(url);
    fetched++;
    if (!r.ok || !r.text) continue;
    rec.pages.push(r.url);
    const hits = [...fingerprint(r.url, `url ${r.url}`), ...fingerprint(r.text, `page ${r.url}`)];
    rec.ats.push(...hits);
    if (hits.some((h) => h.p !== "phenom")) continue; // found a real ATS on this path
    if (hop >= 2) continue;
    const site = siteOf(r.url);
    for (const a of anchors(r.text, r.url)) {
      if (!CAREER_LINK.test(a.href) && !CAREER_LINK.test(a.text)) continue;
      const s = siteOf(a.href);
      // Stay on the employer's own site (or its careers subdomain), unless the
      // link already points at an ATS — fingerprint catches that on the next hop.
      if (s !== site && !fingerprint(a.href, "").length) continue;
      if (!visited.has(a.href)) queue.push({ url: a.href, hop: hop + 1 });
    }
  }
  // Nothing linked from the homepage: try the conventional paths.
  if (!rec.ats.some((h) => h.p !== "phenom") && home) {
    let origin;
    try { origin = new URL(home).origin; } catch { origin = null; }
    for (const p of origin ? FALLBACK_PATHS : []) {
      if (fetched >= 18) break;
      const u = origin + p;
      if (visited.has(u)) continue;
      visited.add(u);
      const r = await get(u);
      fetched++;
      if (!r.ok) continue;
      rec.pages.push(r.url);
      const hits = [...fingerprint(r.url, `url ${r.url}`), ...fingerprint(r.text, `page ${r.url}`)];
      rec.ats.push(...hits);
      if (hits.some((h) => h.p !== "phenom")) break;
    }
  }
  // De-duplicate on platform + identifiers.
  const seen = new Set();
  rec.ats = rec.ats.filter((h) => {
    const k = JSON.stringify({ ...h, where: undefined });
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  rec.fetched = fetched;
  return rec;
}

// --- run --------------------------------------------------------------------
//
// Two phases, because a Vercel sandbox on this plan lives about fifteen
// minutes whatever timeout is requested, and the first all-in-one run died
// with everything still in memory.
//
//   node trace_employers.mjs collect   -> /w/employers.json
//   node trace_employers.mjs trace     -> appends /w/traced.jsonl, one line
//                                         per employer, skipping any already
//                                         there — so it resumes after a restart
//   node trace_employers.mjs report    -> /w/trace.json + summary

const phase = process.argv[2] || "collect";

if (phase === "collect") {
  await collectNoFluffJobs();
  await collectLinkedIn();
  await collectJustJoin();
  const list = [...emp.values()].map((e) => ({
    name: e.name, sources: [...e.sources], websites: [...e.websites], applyUrls: [...e.applyUrls],
  }));
  writeFileSync("/w/employers.json", JSON.stringify(list));
  console.log(`${list.length} distinct employers written`);
  process.exit(0);
}

if (phase === "trace") {
  const list = JSON.parse(readFileSync("/w/employers.json", "utf8"));
  const done = new Set(
    existsSync("/w/traced.jsonl")
      ? readFileSync("/w/traced.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).name)
      : []
  );
  const todo = list.filter((e) => !done.has(e.name));
  console.log(`${done.size} already traced, ${todo.length} to go`);
  let n = 0;
  await pool(todo, 12, async (e) => {
    const rec = await trace({
      name: e.name, sources: new Set(e.sources), websites: new Set(e.websites), applyUrls: new Set(e.applyUrls),
    });
    // Keep only what verification needs; the evidence string stays so a wrong
    // match can be traced back to the page that produced it.
    rec.ats = rec.ats.map((a) => ({ ...a, where: String(a.where).slice(0, 200) }));
    rec.pages = rec.pages.slice(0, 6);
    appendFileSync("/w/traced.jsonl", JSON.stringify(rec) + "\n");
    if (++n % 50 === 0) console.log(`  traced ${n}/${todo.length}`);
  });
  console.log("trace complete");
  process.exit(0);
}

const records = readFileSync("/w/traced.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
writeFileSync("/w/trace.json", JSON.stringify(records));

const byPlatform = {};
for (const r of records) for (const p of new Set(r.ats.map((a) => a.p))) byPlatform[p] = (byPlatform[p] || 0) + 1;
const none = records.filter((r) => !r.ats.length);
const noSite = records.filter((r) => !r.websites.length && !r.applyUrls.length);
console.log("\nemployers per ATS platform:", JSON.stringify(byPlatform));
console.log(`no ATS found: ${none.length} (of which ${noSite.length} had no website or apply URL at all)`);
