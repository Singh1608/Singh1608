// api/headhunt.js: the shortlist the 7:00 Dubai run reads, and the store it writes.
import handler, { cleanResult, hashText } from "../api/headhunt.js";

let n = 0, failed = 0;
function check(name, ok, detail = "") {
  n++;
  if (!ok) failed++;
  console.log(`${String(n).padStart(2)}. ${name.padEnd(58)} ${ok ? "PASS" : "FAIL " + detail}`);
}

const POSTING = "<p>Strategy and transformation for banks. Operating model design, PMO, business cases. 3-5 years of experience. Hybrid, Warsaw.</p>".repeat(6);
const days = (d) => new Date(Date.now() - d * 86400000).toISOString();
const mk = (id, title, company, extra = {}) => ({
  id, title, company, location: "Warsaw, Poland", status: "new", live: true, found_at: days(2),
  url: `https://job-boards.greenhouse.io/${company.toLowerCase()}/jobs/${id.replace(/\D/g, "") || 1}`,
  fit_score: 5, tier: 2, ...extra,
});
const feed = {
  updated_at: days(0),
  jobs: [
    mk("c-101", "Senior Consultant, Strategy & Transformation", "Capco"),
    mk("c-102", "Data Analytics Consultant", "Acme"),
    mk("c-103", "Strategy Consultant, Banking", "Capco", { live: false }),
  ],
};
// Features that give c-101 a high score, c-102 a low one.
const verify = { results: {
  "c-101": { state: "open", checked_at: days(0), features: {
    has_text: true, skills: ["strategy", "operating_model", "pmo", "business_case", "transformation", "banking"],
    years: { min: 3, max: 5 }, mode: "hybrid", salary: true, fs_mentions: 4, mismatch: [], warsaw: true, core_mentions: 5 } },
} };
let store = { results: { "c-101": { score: 70, verdict: "APPLY", text_hash: "old" } } };
let written = null;

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const ok = (body) => ({ ok: true, status: 200, url, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.startsWith("https://blob.vercel-storage.com/?prefix=")) {
    const p = decodeURIComponent(url.split("prefix=")[1].split("&")[0]);
    return ok({ blobs: [{ pathname: p, url: `https://B/${p}` }] });
  }
  if (url === "https://B/pipeline/jobs.json") return ok(feed);
  if (url === "https://B/pipeline/verify.json") return ok(verify);
  if (url === "https://B/pipeline/headhunt.json") return ok(store);
  if (url.startsWith("https://blob.vercel-storage.com/pipeline/headhunt.json") && opts.method === "PUT") {
    written = JSON.parse(opts.body);
    return ok({ url: "https://B/pipeline/headhunt.json" });
  }
  if (url.startsWith("https://boards-api.greenhouse.io/")) return ok({ first_published: days(5), content: POSTING });
  return { ok: false, status: 404, url, json: async () => ({}), text: async () => "not found" };
};
process.env.BLOB_READ_WRITE_TOKEN = "t";
process.env.PIPELINE_EDIT_KEY = "k3y";

const call = async (req) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ headers: {}, ...req }, res);
  return res;
};
const auth = { authorization: "Bearer k3y" };

// Auth
check("GET without the edit key is refused", (await call({ method: "GET" })).code === 401);
check("POST with a wrong key is refused", (await call({ method: "POST", headers: { authorization: "Bearer nope" }, body: {} })).code === 401);

// Shortlist
const r = await call({ method: "GET", headers: auth, query: { min: "55", ids: "c-102" } });
const ids = r.body.roles.map((x) => x.id);
check("GET returns 200", r.code === 200, JSON.stringify(r.body).slice(0, 200));
check("high-scoring open role is on the shortlist", ids.includes("c-101"), JSON.stringify(ids));
check("a named id joins the shortlist whatever its score", ids.includes("c-102"));
check("a closed role is left off", !ids.includes("c-103"));
const top = r.body.roles.find((x) => x.id === "c-101");
check("posting text is returned as plain text", top.text.startsWith("Strategy and transformation"), top.text.slice(0, 60));
check("changed text is flagged for re-scoring", top.needs_scoring === true && top.text_hash === hashText(top.text));
const extra = await call({ method: "GET", headers: auth, query: { min: "101", urls: "https://evil.example.com/x,https://careers.ey.com/ey/job/Warszawa-X/1371182333/" } });
check("only employer career-site URLs are fetched", extra.body.roles.length === 1 && extra.body.roles[0].extra,
  JSON.stringify(extra.body.roles.map((x) => x.url)));

// Store
const bad = cleanResult({ score: 140, verdict: "APPLY" });
check("an out-of-range score is rejected", bad === null);
check("an unknown verdict is rejected", cleanResult({ score: 60, verdict: "MAYBE" }) === null);
const good = cleanResult({ score: 81, verdict: "APPLY + TAILOR", parts: { skills: { score: 33, note: "x".repeat(900) }, domain: { score: 99 } }, gap: "Avaloq" });
check("notes are bounded and bad parts dropped", good.parts.skills.note.length === 400 && !good.parts.domain);
const post = await call({ method: "POST", headers: auth, body: { results: {
  "c-101": { score: 81, verdict: "APPLY + TAILOR", text_hash: top.text_hash, gap: "no salary stated" },
  "c-999": { score: "high", verdict: "APPLY" },
} } });
check("POST saves the valid result and rejects the bad one", post.body.saved === 1 && post.body.rejected[0] === "c-999", JSON.stringify(post.body));
check("stored result replaces the old one", written?.results["c-101"]?.score === 81 && written.results["c-101"].scored_at);
store = written;
const again = await call({ method: "GET", headers: auth, query: {} });
check("an unchanged posting does not need re-scoring", again.body.roles.find((x) => x.id === "c-101").needs_scoring === false);

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
if (failed) process.exitCode = 1;
