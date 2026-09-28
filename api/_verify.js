// Is a stored posting still a job someone can apply to?
//
// The nightly refresh already catches the easy cases: a board that stops
// listing a role, a 404, a redirect to the board root. What it cannot see is a
// link that still answers 200 with a page saying the job is gone:
//   - "no longer accepting applications"
//   - "oferta wygasła"
//   - an expiry date in the page's structured data that has passed
//   - a Workday posting, which only reveals its state through Workday's own
//     API because the page itself is an empty JavaScript shell
//
// So this asks the hiring platform directly where it has an API that answers
// for one posting, and otherwise reads the page.
//
// Three outcomes, as in checkLive: open, closed, and unknown. Unknown is never
// treated as closed. A timeout, a 403 from bot protection or a 5xx is not
// evidence the job is gone, and marking it closed would remove a live role from
// his shortlist.

const TIMEOUT_MS = 8000;
// Some career sites refuse obvious bots with a 403, which would read as
// "unknown" forever. A browser user agent gets the same page a candidate sees.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_HTML = 600_000;

async function get(url, { json = false, method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: json ? "application/json" : "text/html,application/xhtml+xml",
        "accept-language": "en-GB,en;q=0.9,pl;q=0.5",
        ...(body ? { "content-type": "application/json" } : {}),
      },
    });
    let data = null;
    if (json) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      data = (await res.text()).slice(0, MAX_HTML);
    }
    return { status: res.status, ok: res.ok, url: res.url || url, data };
  } catch (err) {
    return { status: null, ok: false, url, data: null, error: err.name || "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

const open = (method, extra = {}) => ({ state: "open", method, ...extra });

// Posting text for the Head Hunter score (api/_headhunter.js). Capped: the
// score needs the requirements, not a whole careers page.
const MAX_TEXT = 20_000;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENTITIES[e]);
}
// Greenhouse sends its HTML entity-escaped, so decode, strip, then decode what
// the tags were hiding.
export function plainText(html) {
  if (!html) return "";
  return decode(decode(String(html))
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|li|ul|ol|br|h\d|tr|section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, MAX_TEXT);
}
const MODES = { remote: "remote", hybrid: "hybrid", onsite: "onsite", "on-site": "onsite", "on site": "onsite" };
const modeOf = (v) => MODES[String(v || "").toLowerCase()] || null;
const closed = (method, reason, extra = {}) => ({ state: "closed", method, reason, ...extra });
const unknown = (method, reason) => ({ state: "unknown", method, reason });

// For APIs that answer for one posting: 404/410 is closed, 2xx is open,
// anything else says nothing.
function byStatus(r, method, closedReason) {
  if (r.status === 404 || r.status === 410) return closed(method, closedReason);
  if (r.ok) return null; // caller inspects the body
  return unknown(method, r.status ? `HTTP ${r.status}` : r.error);
}

// --- platform APIs ------------------------------------------------------------

async function greenhouse(u) {
  const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (!m) return null;
  const r = await get(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}?pay_transparency=true`, { json: true });
  return byStatus(r, "greenhouse-api", "Greenhouse no longer has this posting")
    ?? open("greenhouse-api", {
      posted_at: r.data?.first_published || null,
      text: plainText(r.data?.content),
      meta: { salary: Array.isArray(r.data?.pay_input_ranges) && r.data.pay_input_ranges.length > 0 },
    });
}

async function lever(u, eu) {
  const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const r = await get(`https://api.${eu ? "eu." : ""}lever.co/v0/postings/${m[1]}/${m[2]}`, { json: true });
  const d = r.data || {};
  return byStatus(r, "lever-api", "Lever no longer has this posting")
    ?? open("lever-api", {
      posted_at: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      text: [d.descriptionPlain, ...(d.lists || []).map((l) => `${l.text}\n${plainText(l.content)}`), d.additionalPlain]
        .filter(Boolean).join("\n").slice(0, MAX_TEXT),
      meta: { salary: !!(d.salaryRange && (d.salaryRange.min || d.salaryRange.max)), mode: modeOf(d.workplaceType) },
    });
}

async function smartrecruiters(u) {
  const m = u.pathname.match(/^\/([^/]+)\/(\d+)/);
  if (!m) return null;
  const r = await get(`https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`, { json: true });
  const verdict = byStatus(r, "smartrecruiters-api", "SmartRecruiters no longer has this posting");
  if (verdict) return verdict;
  if (r.data?.active === false) return closed("smartrecruiters-api", "SmartRecruiters marks this posting inactive");
  const sections = r.data?.jobAd?.sections || {};
  const loc = r.data?.location || {};
  return open("smartrecruiters-api", {
    posted_at: r.data?.releasedDate || null,
    text: plainText(Object.values(sections).map((x) => `${x?.title || ""}\n${x?.text || ""}`).join("\n")),
    meta: { mode: loc.remote ? "remote" : loc.hybrid ? "hybrid" : null },
  });
}

async function ashby(u) {
  const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=true`, { json: true });
  if (!r.ok || !Array.isArray(r.data?.jobs)) return unknown("ashby-api", r.status ? `HTTP ${r.status}` : r.error);
  const job = r.data.jobs.find((j) => String(j.id) === m[2] || String(j.jobUrl || "").includes(m[2]));
  return job
    ? open("ashby-api", {
      posted_at: job.publishedAt || null,
      text: (job.descriptionPlain || plainText(job.descriptionHtml)).slice(0, MAX_TEXT),
      meta: {
        salary: !!(job.compensation?.compensationTierSummary || job.compensation?.summaryComponents?.length),
        mode: modeOf(job.workplaceType) || (job.isRemote ? "remote" : null),
      },
    })
    : closed("ashby-api", "no longer on the employer's Ashby board");
}

// Workday job pages render client-side, so the HTML says nothing either way.
// The CXS API behind them answers for a single posting.
async function workday(u) {
  let tenant;
  let rest;
  const rec = u.pathname.match(/^\/recruiting\/([^/]+)\/(.+)$/);
  if (rec) {
    tenant = rec[1];
    rest = rec[2];
  } else {
    tenant = u.hostname.split(".")[0];
    rest = u.pathname.replace(/^\/[a-z]{2}-[A-Z]{2}\//, "/").replace(/^\//, "");
  }
  rest = rest.replace(/\/apply\/?$/, "").replace(/\/$/, "");
  if (!/\/job\//.test(rest)) return null;
  const r = await get(`https://${u.host}/wday/cxs/${tenant}/${rest}`, { json: true });
  const verdict = byStatus(r, "workday-api", "Workday no longer has this posting");
  if (verdict) return verdict;
  const info = r.data?.jobPostingInfo;
  if (!info) return unknown("workday-api", "no posting data in the response");
  if (info.endDate && Date.parse(info.endDate) < Date.now()) {
    return closed("workday-api", `posting ended ${info.endDate.slice(0, 10)}`);
  }
  return open("workday-api", {
    posted_at: info.startDate || null,
    text: plainText(info.jobDescription),
    meta: { mode: modeOf(info.remoteType) },
  });
}

// --- the page itself -------------------------------------------------------------

// Closure notices, in the languages these employers publish in. Each is a
// whole phrase that only appears when the posting is gone. Bare words like
// "closed" or "expired" occur on open postings too.
const CLOSED_TEXT = [
  /no longer (?:available|accepting applications|open|active|being accepted|online)/i,
  /(?:job|position|role|vacancy|posting|opening|requisition|offer)\s+(?:has|have)\s+(?:been\s+)?(?:filled|closed|expired|removed|taken down)/i,
  /(?:job|position|role|vacancy|posting|opening|offer)\s+(?:is|was)\s+(?:now\s+)?(?:closed|expired|no longer)/i,
  /(?:this|the)\s+(?:job|position|role|vacancy|posting|opening)\s+(?:could not be found|was not found|does not exist|doesn't exist)/i,
  /applications?\s+(?:are|is)\s+(?:now\s+)?closed/i,
  /(?:we are|we're) no longer (?:accepting|recruiting|hiring for)/i,
  /(?:job|posting|position|vacancy) (?:not found|expired)\b/i,
  // Polish
  /oferta\s+(?:pracy\s+)?(?:wygasła|jest\s+nieaktualna|nieaktualna|została\s+(?:zamknięta|zakończona|wycofana))/i,
  /ogłoszenie\s+(?:wygasło|(?:jest\s+)?nieaktualne|zostało\s+zakończone)/i,
  /rekrutacja\s+(?:została\s+)?zakończona/i,
  /nie\s+przyjmujemy\s+już\s+(?:aplikacji|zgłoszeń)/i,
  // German, for the DACH-run boards that also hire in Poland
  /(?:stelle|stellenanzeige|position)\s+(?:ist\s+)?(?:nicht\s+mehr\s+verfügbar|bereits\s+besetzt)/i,
];

function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

// schema.org JobPosting blocks: most career sites publish one for Google, and
// validThrough is the employer's own statement of when the posting ends.
export function jobPostingData(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      for (const it of items) if (it && /JobPosting/.test(String(it["@type"]))) out.push(it);
    } catch { /* malformed blocks are common; skip them */ }
  }
  return out;
}

export function closureNotice(html) {
  const text = visibleText(html);
  for (const re of CLOSED_TEXT) {
    const m = text.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

async function page(url) {
  const r = await get(url);
  if (r.status === 404 || r.status === 410) return closed("page", `link returns HTTP ${r.status}`);
  if (!r.ok || typeof r.data !== "string") return unknown("page", r.status ? `HTTP ${r.status}` : r.error);

  // Several hosts retire a posting by redirecting to the board root.
  let landed;
  try { landed = new URL(r.url); } catch { landed = null; }
  if (landed && r.url !== url && /\/(jobs|careers|search|embed|job-search|vacancies)\/?$/i.test(landed.pathname)) {
    return closed("page", "link now redirects to the careers home page");
  }
  // Greenhouse's own pages bounce a removed posting to the board with
  // ?error=true, which still answers 200.
  if (landed && r.url !== url && landed.searchParams.get("error") === "true") {
    return closed("page", "link now redirects to the job board with an error");
  }

  const postings = jobPostingData(r.data);
  const until = postings.map((p) => p.validThrough).find(Boolean);
  const posted = postings.map((p) => p.datePosted).find(Boolean) || null;
  if (until && Date.parse(until) < Date.now() - 86_400_000) {
    return closed("page", `listing expired on ${String(until).slice(0, 10)}`, { posted_at: posted });
  }

  const notice = closureNotice(r.data);
  if (notice) return closed("page", `page says "${notice.slice(0, 80)}"`, { posted_at: posted });

  // The structured description when the page publishes one; the page text
  // otherwise, which carries navigation noise but also the requirements.
  const ld = postings.find((p) => p.description);
  return open("page", {
    posted_at: posted,
    text: ld ? plainText(ld.description) : visibleText(r.data).slice(0, MAX_TEXT),
    meta: {
      salary: postings.some((p) => p.baseSalary),
      mode: postings.some((p) => /telecommute/i.test(String(p.jobLocationType || ""))) ? "remote" : null,
    },
  });
}

// --- entry point ----------------------------------------------------------------

export async function verifyPosting(url) {
  let u;
  try { u = new URL(url); } catch { return unknown("none", "not a valid URL"); }
  const h = u.hostname;
  let verdict = null;
  try {
    if (/(^|\.)greenhouse\.io$/.test(h) && /^(job-boards|boards)(\.eu)?\./.test(h)) verdict = await greenhouse(u);
    else if (/^jobs(\.eu)?\.lever\.co$/.test(h)) verdict = await lever(u, h.includes(".eu."));
    else if (h === "jobs.smartrecruiters.com") verdict = await smartrecruiters(u);
    else if (h === "jobs.ashbyhq.com") verdict = await ashby(u);
    else if (/\.myworkday(jobs|site)\.com$/.test(h)) verdict = await workday(u);
  } catch {
    verdict = null;
  }
  // An API that could not answer falls back to reading the page. A definite
  // answer from the API is final.
  if (verdict && verdict.state !== "unknown") return verdict;
  const fromPage = await page(url);
  if (fromPage.state === "unknown" && verdict) return verdict;
  return fromPage;
}

// Check many postings with bounded concurrency inside a time budget. Anything
// the budget did not reach is simply absent from the result and is checked
// first next run.
export async function verifyAll(urls, { concurrency = 8, budgetMs = 45000 } = {}) {
  const started = Date.now();
  const out = new Map();
  const queue = [...urls];
  async function worker() {
    while (queue.length) {
      if (Date.now() - started > budgetMs) return;
      const url = queue.shift();
      out.set(url, await verifyPosting(url));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
