// Role categories: the title classifier, the page's copy of the list, and the
// synced override endpoint.
import { readFileSync } from "node:fs";
import { CATEGORIES, categorize } from "../api/_category.js";
import overrides from "../api/overrides.js";
import jobsHandler from "../api/jobs.js";

let n = 0;
let failed = 0;
function check(label, ok, detail = "") {
  n++;
  if (!ok) failed++;
  console.log(`${n}. ${label.padEnd(58)} ${detail} ${ok ? "PASS" : "FAIL"}`);
}

// --- classifier, on titles the live feed has actually carried ---------------
const CASES = [
  ["Strategy Consultant — Operating Model & Organizational Design", "strategy"],
  ["Team Member — Strategy&, Warsaw", "strategy"],
  ["Business Transformation Consultant, Warsaw", "transformation"],
  ["Business Analyst – Target Operating Model", "transformation"],
  ["Lead Operational Excellence Specialist, Warsaw", "transformation"],
  ["(Senior) Consultant | Finance Transformation", "finance"],
  ["Business Analyst — Product Control", "finance"],
  ["Business Analyst - Market Risk", "risk"],
  ["Credit Risk Management Consultant with German", "risk"],
  ["Consulting Manager | Financial Crime and Managed Services Technology", "risk"],
  ["M&A Strategy Analyst / Consultant — Accenture Strategy", "deals"],
  ["Business Analyst — Payments", "ba"],
  ["Senior Business Analyst", "ba"],
  ["Lead PMO", "pmo"],
  ["PMO Non-Financial Risk (She/He/They)", "pmo"],
  ["Project Manager (Banking)", "pmo"],
  ["Senior AI Consultant – AI Transformation & Delivery", "tech"],
  ["Technology Strategy & Transformation Consultant", "tech"],
  ["Business IT Consultant – Financial Services / Insurance Team", "tech"],
  ["Data Business Analyst – GCP / Hadoop", "tech"],
  ["Associate or Consultant, Warsaw", "other"],
];
const wrong = CASES.filter(([t, want]) => categorize(t) !== want)
  .map(([t, want]) => `${t} -> ${categorize(t)} (want ${want})`);
check("classifier sorts real titles", wrong.length === 0, wrong.join("; "));
check("'Financial Services' is not finance work", categorize("Business IT Consultant – Financial Services") !== "finance");
check("empty title is other", categorize("") === "other" && categorize(undefined) === "other");

// --- the page carries its own copy of the list; it must not drift -----------
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const pageList = html.match(/var CATEGORIES = (\[[\s\S]*?\]);/);
const pageCats = pageList ? Function(`return ${pageList[1]}`)() : null;
check("page CATEGORIES match api/_category.js", JSON.stringify(pageCats) === JSON.stringify(CATEGORIES));
const pub = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
check("public/index.html is the same page", pub === html);

// --- /api/overrides ----------------------------------------------------------
let blob = null;          // what is stored at pipeline/overrides.json
let feed = null;          // what is stored at pipeline/jobs.json
let writes = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("?prefix=")) {
    const p = decodeURIComponent(url.split("prefix=")[1].split("&")[0]);
    const has = (p === "pipeline/overrides.json" && blob) || (p === "pipeline/jobs.json" && feed);
    return { ok: true, json: async () => ({ blobs: has ? [{ pathname: p, url: `https://B/${p}` }] : [] }) };
  }
  if (url === "https://B/pipeline/overrides.json") return { ok: true, json: async () => blob };
  if (url === "https://B/pipeline/jobs.json") return { ok: true, json: async () => feed };
  if (url === "https://blob.vercel-storage.com/pipeline/overrides.json" && init.method === "PUT") {
    writes++;
    blob = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) };
  }
  return { ok: false, status: 404, json: async () => null, text: async () => "" };
};
process.env.BLOB_READ_WRITE_TOKEN = "t";

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      code: 0, body: null, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
      end() { resolve(this); return this; },
    };
    handler(req, res);
  });
}
const post = (body, key) => call(overrides, {
  method: "POST", body, headers: key ? { authorization: `Bearer ${key}` } : {},
});

let r = await call(overrides, { method: "GET", headers: {} });
check("GET with nothing stored is an empty map", r.code === 200 && JSON.stringify(r.body.categories) === "{}");
check("GET is never cached", r.headers["cache-control"] === "no-store");

delete process.env.PIPELINE_EDIT_KEY;
r = await post({ id: "a", category: "finance" }, "anything");
check("write refused when no edit key is configured", r.code === 503, String(r.code));

process.env.PIPELINE_EDIT_KEY = "right-key";
r = await post({ id: "a", category: "finance" });
check("write refused without a key", r.code === 401, String(r.code));
r = await post({ id: "a", category: "finance" }, "wrong-key");
check("write refused with the wrong key", r.code === 401 && writes === 0, String(r.code));

r = await post({ id: "a", category: "astrology" }, "right-key");
check("unknown category rejected", r.code === 400, String(r.code));
r = await post({ id: "", category: "finance" }, "right-key");
check("empty id rejected", r.code === 400, String(r.code));

r = await post({ id: "a", category: "finance" }, "right-key");
check("valid write stored", r.code === 200 && blob.categories.a === "finance" && writes === 1);
r = await post(JSON.stringify({ id: "b", category: "pmo" }), "right-key");
check("string body accepted, earlier override kept", r.code === 200 && blob.categories.a === "finance" && blob.categories.b === "pmo");
r = await post({ id: "a", category: null }, "right-key");
check("null clears the override", r.code === 200 && !("a" in blob.categories) && blob.categories.b === "pmo");

r = await call(overrides, { method: "GET", headers: {} });
check("GET returns what was stored", r.body.categories.b === "pmo" && !!r.body.updated_at);
r = await call(overrides, { method: "OPTIONS", headers: {} });
check("CORS preflight answered", r.code === 204 && r.headers["access-control-allow-headers"].includes("authorization"));
r = await call(overrides, { method: "DELETE", headers: {} });
check("other methods refused", r.code === 405);

// --- /api/jobs carries the automatic category ---------------------------------
feed = { updated_at: "2026-09-24T00:00:00Z", jobs: [
  { id: "x", company: "PwC", title: "(Senior) Consultant | Finance Transformation", url: "https://x", tier: 1, fit_score: 7, status: "new", live: true },
  { id: "y", company: "Capco", title: "Lead PMO", url: "https://y", tier: 2, fit_score: 5, status: "new", live: true },
] };
r = await call(jobsHandler, { method: "GET", headers: {} });
const byId = Object.fromEntries(r.body.jobs.map((j) => [j.id, j.category]));
check("feed roles carry their automatic category", byId.x === "finance" && byId.y === "pmo", JSON.stringify(byId));

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
process.exitCode = failed ? 1 : 0;
