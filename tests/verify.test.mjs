// The daily dead-role check: what counts as closed, what must stay unknown,
// and how the result reaches the page.
import { closureNotice, verifyPosting } from "../api/_verify.js";

let n = 0;
let failed = 0;
function check(label, ok, detail = "") {
  n++;
  if (!ok) failed++;
  console.log(`${String(n).padStart(2)}. ${label.padEnd(60)} ${ok ? "PASS" : "FAIL"} ${ok ? "" : detail}`);
}

// url -> response. A function receives the request options.
let routes = {};
const json = (status, body, url) => ({ status, ok: status >= 200 && status < 300, url, json: async () => body, text: async () => JSON.stringify(body) });
const html = (status, body, url) => ({ status, ok: status >= 200 && status < 300, url, json: async () => { throw new Error("not json"); }, text: async () => body });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const r = routes[url];
  if (!r) return html(404, "not found", url);
  if (r === "TIMEOUT") { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
  return typeof r === "function" ? r(opts) : r;
};

const OPEN_PAGE = "<html><body><h1>Business Analyst</h1><p>Apply now. Applications close on 30 September.</p></body></html>";

// --- platform APIs ------------------------------------------------------------
routes = {
  "https://boards-api.greenhouse.io/v1/boards/capco/jobs/111": json(200, { id: 111, first_published: "2026-08-01T00:00:00Z" }),
  "https://boards-api.greenhouse.io/v1/boards/capco/jobs/404": json(404, {}),
  "https://job-boards.greenhouse.io/capco/jobs/404": html(200, "<html>board</html>", "https://job-boards.greenhouse.io/capco?error=true"),
};
let v = await verifyPosting("https://job-boards.greenhouse.io/capco/jobs/111");
check("Greenhouse API 200 -> open, with posting date", v.state === "open" && v.posted_at === "2026-08-01T00:00:00Z", JSON.stringify(v));
v = await verifyPosting("https://job-boards.greenhouse.io/capco/jobs/404");
check("Greenhouse API 404 -> closed", v.state === "closed" && v.method === "greenhouse-api", JSON.stringify(v));

routes = {
  "https://api.eu.lever.co/v0/postings/acme/0f0e0d0c-0b0a-0908-0706-050403020100": json(404, {}),
  "https://api.smartrecruiters.com/v1/companies/Acme/postings/7441": json(200, { active: false }),
  "https://api.smartrecruiters.com/v1/companies/Acme/postings/7442": json(200, { active: true, releasedDate: "2026-09-01T00:00:00Z" }),
};
v = await verifyPosting("https://jobs.eu.lever.co/acme/0f0e0d0c-0b0a-0908-0706-050403020100");
check("Lever (EU) API 404 -> closed", v.state === "closed" && v.method === "lever-api", JSON.stringify(v));
v = await verifyPosting("https://jobs.smartrecruiters.com/Acme/7441-business-analyst");
check("SmartRecruiters active:false -> closed", v.state === "closed", JSON.stringify(v));
v = await verifyPosting("https://jobs.smartrecruiters.com/Acme/7442");
check("SmartRecruiters active -> open, with date", v.state === "open" && v.posted_at.startsWith("2026-09-01"), JSON.stringify(v));

const WD = "https://accenture.wd103.myworkdayjobs.com/AccentureCareers/job/Warsaw/Strategy-Analyst_R001";
routes = {
  "https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers/job/Warsaw/Strategy-Analyst_R001":
    json(200, { jobPostingInfo: { title: "Strategy Analyst", startDate: "2026-07-20" } }),
  "https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers/job/Warsaw/Gone_R002": json(404, {}),
  "https://wd3.myworkdaysite.com/wday/cxs/statestreet/Global/job/Krakow/Analyst_R9": json(200, { jobPostingInfo: { startDate: "2026-09-10" } }),
};
v = await verifyPosting(WD);
check("Workday CXS 200 -> open, exact start date", v.state === "open" && v.posted_at === "2026-07-20", JSON.stringify(v));
v = await verifyPosting(WD + "/apply");
check("Workday link ending /apply resolves the same posting", v.state === "open", JSON.stringify(v));
v = await verifyPosting("https://accenture.wd103.myworkdayjobs.com/en-US/AccentureCareers/job/Warsaw/Gone_R002");
check("Workday CXS 404 (locale-prefixed link) -> closed", v.state === "closed" && v.method === "workday-api", JSON.stringify(v));
v = await verifyPosting("https://wd3.myworkdaysite.com/recruiting/statestreet/Global/job/Krakow/Analyst_R9");
check("Workday myworkdaysite /recruiting/ link parsed", v.state === "open" && v.posted_at === "2026-09-10", JSON.stringify(v));

// --- reading the page -----------------------------------------------------------
const P = "https://careers.example.com/job/123";
const pageCase = async (resp) => { routes = { [P]: resp }; return verifyPosting(P); };
v = await pageCase(html(200, "<div>Search jobs</div><p>The Job is no longer available.</p>", P));
check("EY-style 'no longer available' notice -> closed", v.state === "closed" && /no longer available/.test(v.reason), JSON.stringify(v));
v = await pageCase(html(200, "<main>Ta oferta pracy wygasła</main>", P));
check("Polish 'oferta pracy wygasła' -> closed", v.state === "closed", JSON.stringify(v));
v = await pageCase(html(200, "<p>Rekrutacja została zakończona.</p>", P));
check("Polish 'rekrutacja została zakończona' -> closed", v.state === "closed", JSON.stringify(v));
v = await pageCase(html(200, '<script type="application/ld+json">{"@type":"JobPosting","datePosted":"2026-06-01","validThrough":"2026-08-01T00:00:00Z"}</script>' + OPEN_PAGE, P));
check("JobPosting validThrough in the past -> closed", v.state === "closed" && /expired on 2026-08-01/.test(v.reason), JSON.stringify(v));
v = await pageCase(html(200, '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","datePosted":"2026-09-01","validThrough":"2099-01-01"}]}</script>' + OPEN_PAGE, P));
check("validThrough in the future -> open, datePosted kept", v.state === "open" && v.posted_at === "2026-09-01", JSON.stringify(v));
v = await pageCase(html(200, OPEN_PAGE, P));
check("ordinary open page ('Applications close on...') -> open", v.state === "open", JSON.stringify(v));
v = await pageCase(html(200, '<script>var s="no longer available"</script>' + OPEN_PAGE, P));
check("the phrase inside a <script> is ignored", v.state === "open", JSON.stringify(v));
v = await pageCase(html(410, "gone", P));
check("HTTP 410 -> closed", v.state === "closed", JSON.stringify(v));
v = await pageCase(html(200, "<html>all jobs</html>", "https://careers.example.com/careers"));
check("redirect to the careers home page -> closed", v.state === "closed", JSON.stringify(v));

// --- what must NOT be read as closed ----------------------------------------------
v = await pageCase(html(403, "blocked", P));
check("403 from bot protection -> unknown, not closed", v.state === "unknown", JSON.stringify(v));
v = await pageCase(html(503, "down", P));
check("503 -> unknown, not closed", v.state === "unknown", JSON.stringify(v));
v = await pageCase("TIMEOUT");
check("timeout -> unknown, not closed", v.state === "unknown", JSON.stringify(v));
routes = {
  "https://boards-api.greenhouse.io/v1/boards/capco/jobs/500": json(500, {}),
  "https://job-boards.greenhouse.io/capco/jobs/500": html(200, OPEN_PAGE, "https://job-boards.greenhouse.io/capco/jobs/500"),
};
v = await verifyPosting("https://job-boards.greenhouse.io/capco/jobs/500");
check("API error falls back to the page (open)", v.state === "open" && v.method === "page", JSON.stringify(v));
check("closureNotice finds nothing on a normal posting", closureNotice(OPEN_PAGE) === null);

// --- the scheduled run -------------------------------------------------------------
const { default: verifyHandler } = await import("../api/verify.js");
const { default: jobsHandler } = await import("../api/jobs.js");
let blobs = {};
const days = (d) => new Date(Date.now() - d * 86400000).toISOString();
blobs["pipeline/jobs.json"] = {
  updated_at: days(0),
  jobs: [
    { id: "gh-open", company: "Capco", title: "Business Analyst — Payments", url: "https://job-boards.greenhouse.io/capco/jobs/111", tier: 2, fit_score: 5, status: "new", live: true, posted_at: null, found_at: days(2).slice(0, 10) },
    { id: "gh-gone", company: "Capco", title: "Senior Business Analyst", url: "https://job-boards.greenhouse.io/capco/jobs/404", tier: 2, fit_score: 6, status: "new", live: true, found_at: days(2).slice(0, 10) },
    { id: "wd-old", company: "Accenture", title: "Strategy Analyst", url: WD, tier: 1, fit_score: 7, status: "new", live: true, found_at: days(1).slice(0, 10) },
    { id: "flaky", company: "Acme", title: "Strategy Consultant", url: P, tier: 1, fit_score: 7, status: "new", live: true, found_at: days(1).slice(0, 10) },
    { id: "gated", company: "PwC", title: "Consultant with German", url: "https://x.test/g", tier: 1, fit_score: 7, status: "new", live: true, gated_out: "language" },
    { id: "dead", company: "EY", title: "Consultant", url: "https://x.test/d", tier: 1, fit_score: 7, status: "new", live: false, http_status: 404 },
  ],
};
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes("?prefix=")) {
    const p = decodeURIComponent(url.split("prefix=")[1].split("&")[0]);
    return json(200, { blobs: blobs[p] ? [{ pathname: p, url: `https://B/${p}` }] : [] });
  }
  if (url.startsWith("https://B/")) return json(200, blobs[url.slice(10)]);
  if (url.startsWith("https://blob.vercel-storage.com/") && opts.method === "PUT") {
    blobs[url.slice("https://blob.vercel-storage.com/".length)] = JSON.parse(opts.body);
    return json(200, {});
  }
  calls.push(url);
  const r = {
    "https://boards-api.greenhouse.io/v1/boards/capco/jobs/111": json(200, { first_published: days(3) }),
    "https://boards-api.greenhouse.io/v1/boards/capco/jobs/404": json(404, {}),
    "https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers/job/Warsaw/Strategy-Analyst_R001": json(200, { jobPostingInfo: { startDate: days(45).slice(0, 10) } }),
    [P]: html(503, "down", P),
  }[url];
  return r || html(404, "", url);
};
process.env.BLOB_READ_WRITE_TOKEN = "t";
process.env.CRON_SECRET = "cron";
const call = (handler, req) => new Promise((resolve) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve(this); return this; } };
  handler(req, res);
});

let r = await call(verifyHandler, { headers: {} });
check("verify refuses a caller without the cron secret", r.code === 401);

process.env.PIPELINE_EDIT_KEY = "edit";
r = await call(verifyHandler, { headers: { authorization: "Bearer wrong" } });
check("verify refuses a wrong key", r.code === 401 && !blobs["pipeline/verify.json"]);

// The first run goes in with the edit key: an on-demand check.
r = await call(verifyHandler, { headers: { authorization: "Bearer edit" } });
check("verify accepts the edit key for an on-demand run", r.code === 200, String(r.code));
check("run checks open, ungated roles only (4 of 6)", r.body.candidates === 4 && r.body.checked === 4, JSON.stringify(r.body));
check("run counts 2 open, 1 closed, 1 unknown", r.body.open === 2 && r.body.closed === 1 && r.body.unknown === 1, JSON.stringify(r.body));
check("newly_closed names the closed role", r.body.newly_closed.length === 1 && r.body.newly_closed[0].id === "gh-gone");
check("gated and already-dead roles were never fetched", !calls.some((u) => u.startsWith("https://x.test/")));
const stored = blobs["pipeline/verify.json"];
check("results stored in their own blob, feed untouched", stored?.results?.["gh-gone"]?.state === "closed" && !blobs["pipeline/jobs.json"].jobs[1].closed);

calls.length = 0;
r = await call(verifyHandler, { headers: { authorization: "Bearer cron" } });
check("next run does not re-check a closed role", r.body.candidates === 3 && !calls.some((u) => u.includes("/jobs/404")), JSON.stringify(r.body));
check("next run reports nothing newly closed", r.body.newly_closed.length === 0);
check("history keeps both runs", blobs["pipeline/verify.json"].history.length === 2);

// --- what the page receives -------------------------------------------------------
r = await call(jobsHandler, { headers: {} });
const byId = Object.fromEntries(r.body.jobs.map((j) => [j.id, j]));
check("closed role is off the shortlist with its reason", byId["gh-gone"].actionable === false && /Greenhouse/.test(byId["gh-gone"].closed.reason));
check("refresh-dead role is closed too, with a readable reason", byId.dead.closed?.reason === "link returns HTTP 404" && !byId.dead.actionable);
check("unknown result leaves the role on the shortlist", byId.flaky.actionable === true && byId.flaky.closed === null);
check("Workday start date 45 days ago -> old posting, still shortlisted", byId["wd-old"].old_posting === true && byId["wd-old"].actionable === true && byId["wd-old"].age_days === 45, JSON.stringify(byId["wd-old"]));
check("recent posting is not old", byId["gh-open"].old_posting === false);
check("feed reports closed_count and last_verified", r.body.closed_count === 2 && r.body.last_verified?.checked === 3, JSON.stringify({ c: r.body.closed_count, v: r.body.last_verified }));

// Age from found_at alone must never flag a role as old.
blobs["pipeline/jobs.json"].jobs.push({ id: "nodate", company: "Z", title: "Consultant", url: "https://x.test/n", tier: 3, fit_score: 2, status: "new", live: true, found_at: days(60).slice(0, 10) });
r = await call(jobsHandler, { headers: {} });
check("found_at 60 days ago but no posting date -> not flagged old", r.body.jobs.find((j) => j.id === "nodate").old_posting === false);

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
process.exitCode = failed ? 1 : 0;
