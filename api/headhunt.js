// The morning head-hunt: the shortlist, with each posting's text, and a place
// to store the deep score read from it.
//
//   GET  /api/headhunt[?min=55&ids=a,b&urls=u1,u2]
//        -> { roles: [{ id, company, title, url, location, score, score_parts,
//                       state, text, text_hash, deep, needs_scoring }], ... }
//   POST /api/headhunt  { results: { <id>: { score, verdict, parts, gap, summary, text_hash, ... } } }
//        -> the stored results, merged
//
// The shortlist is every open role at or above `min` on the automatic score,
// plus any role ids and posting URLs named in the request (the roles he has
// already tailored a resume for). `needs_scoring` is true when a role has no
// deep score yet or its posting text changed since the last one, so the
// morning run only reads what is new.
//
// Both methods need PIPELINE_EDIT_KEY. The postings are public, but a GET
// fetches dozens of them live, and it should not be anyone's free crawler.

import { createHash } from "node:crypto";
import { readBlob, writeBlob } from "./_lib.js";
import { keyMatches } from "./overrides.js";
import { feedView, HEADHUNT_PATH } from "./jobs.js";
import { verifyAll } from "./_verify.js";
import { classifyLink } from "./_fit.js";

const DEFAULT_MIN = 55;
const MAX_TEXT = 9000;
const MAX_EXTRA_URLS = 5;
const HISTORY = 30;
export const VERDICTS = ["APPLY + TAILOR", "APPLY", "STRETCH", "SKIP", "EXCLUDED", "CLOSED"];

function unauthorized(req) {
  const expected = process.env.PIPELINE_EDIT_KEY;
  if (!expected) return { status: 503, error: "PIPELINE_EDIT_KEY is not configured" };
  const got = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!got || !keyMatches(got, expected)) return { status: 401, error: "bad or missing edit key" };
  return null;
}

export const hashText = (t) => createHash("sha1").update(String(t || "").replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
export const extraId = (url) => `url-${createHash("sha1").update(url).digest("hex").slice(0, 10)}`;

// The lines a screener reads: requirements, experience, languages, location,
// work mode, pay. Keeps a morning run over fifty postings readable, since the
// rest is employer boilerplate. Full text is returned when brief is off.
const BRIEF_LINE = /\b(requir\w*|experience|years?|skills?|knowledge|proficien\w*|familiar\w*|degree|must|should|you will|you'll|responsib\w*|languages?|polish|german|french|english|fluent|salary|pln|eur|remote|hybrid|office|on-?site|location|warsaw|krak[oó]w|nice to have|preferred|qualif\w*|background|expertise|ability|certif\w*|we offer|contract|b2b)\b/i;
const MAX_BRIEF = 2600;
export function brief(text) {
  const lines = String(text || "").split(/\n+|(?<=[.;•])\s+(?=[A-Z•-])/).map((l) => l.trim()).filter((l) => l.length > 3);
  const intro = lines.slice(0, 3).join(" ").slice(0, 300);
  const seen = new Set();
  const keep = [];
  for (const l of lines.slice(3)) {
    const k = l.toLowerCase();
    if (!BRIEF_LINE.test(l) || seen.has(k)) continue;
    seen.add(k);
    keep.push(l.slice(0, 300));
  }
  return `${intro}\n- ${keep.join("\n- ")}`.slice(0, MAX_BRIEF);
}

function list(v) {
  return String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
}

async function shortlist(query) {
  const min = Number.isFinite(Number(query.min)) ? Number(query.min) : DEFAULT_MIN;
  const short = query.brief === "1" || query.brief === "true";
  const ids = new Set(list(query.ids));
  // Only postings on an employer's own career site or ATS: the same test the
  // pipeline applies to every link it stores.
  const urls = list(query.urls).filter((u) => classifyLink(u).ok).slice(0, MAX_EXTRA_URLS);

  const view = await feedView();
  const stored = (await readBlob(HEADHUNT_PATH))?.results || {};
  const picked = view.jobs.filter((j) => (j.actionable && j.score >= min) || ids.has(j.id));
  const known = new Set(view.jobs.map((j) => j.url));
  const extras = urls.filter((u) => !known.has(u)).map((u) => ({
    id: extraId(u), company: null, title: null, url: u, location: null,
    score: null, score_parts: null, extra: true,
  }));
  const roles = [...picked, ...extras];

  const fetched = await verifyAll(roles.map((r) => r.url), { concurrency: 8, budgetMs: 45000 });
  return {
    generated_at: new Date().toISOString(),
    min,
    last_verified: view.last_verified,
    roles: roles.map((r) => {
      const v = fetched.get(r.url);
      const text = (v?.text || "").slice(0, MAX_TEXT);
      const text_hash = text ? hashText(text) : null;
      const deep = stored[r.id] || null;
      return {
        id: r.id,
        company: r.company,
        title: r.title,
        url: r.url,
        location: r.location || null,
        extra: !!r.extra,
        score: r.score,
        band: r.band || null,
        score_parts: r.score_parts,
        posted_at: r.posted_at || null,
        found_at: r.found_at || null,
        state: v ? v.state : "not reached",
        state_reason: v?.reason || null,
        text: short ? brief(text) : text,
        text_hash,
        deep,
        needs_scoring: !!text && (!deep || deep.text_hash !== text_hash),
      };
    }),
  };
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// Keep only fields the page and the email use, bounded, so a malformed run
// cannot bloat or break the store.
export function cleanResult(r) {
  if (!r || typeof r !== "object") return null;
  const score = int(r.score, 0, 100);
  if (score === null || !VERDICTS.includes(r.verdict)) return null;
  const parts = {};
  for (const [k, max] of [["skills", 40], ["seniority", 25], ["domain", 20], ["practical", 15]]) {
    const p = r.parts?.[k];
    const s = int(p?.score, 0, max);
    if (s !== null) parts[k] = { score: s, max, note: str(p.note, 400) || "" };
  }
  return {
    score,
    verdict: r.verdict,
    parts,
    gap: str(r.gap, 300),
    summary: str(r.summary, 600),
    company: str(r.company, 120),
    title: str(r.title, 200),
    url: str(r.url, 500),
    text_hash: str(r.text_hash, 32),
    scored_at: new Date().toISOString(),
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  const denied = unauthorized(req);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  if (req.method === "GET" || !req.method) {
    return res.status(200).json(await shortlist(req.query || {}));
  }
  if (req.method !== "POST") return res.status(405).json({ error: "use GET or POST" });

  const body = parseBody(req);
  const incoming = body?.results;
  if (!incoming || typeof incoming !== "object") return res.status(400).json({ error: "results must be an object" });

  const stored = (await readBlob(HEADHUNT_PATH)) || {};
  const results = { ...(stored.results || {}) };
  const rejected = [];
  let saved = 0;
  for (const [id, r] of Object.entries(incoming).slice(0, 200)) {
    const clean = typeof id === "string" && id.length <= 200 ? cleanResult(r) : null;
    if (clean) { results[id] = clean; saved++; } else rejected.push(id);
  }
  const run = { at: new Date().toISOString(), saved, rejected: rejected.length, note: str(body.note, 300) };
  const out = { results, last_run: run, history: [run, ...(stored.history || [])].slice(0, HISTORY) };
  try {
    await writeBlob(HEADHUNT_PATH, out);
  } catch (err) {
    return res.status(502).json({ error: `could not store results: ${err.message}` });
  }
  return res.status(200).json({ saved, rejected, total: Object.keys(results).length });
}
