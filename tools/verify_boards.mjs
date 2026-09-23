// Verify every ATS reference found by tools/trace_employers.mjs, using the
// PRODUCTION adapters from api/_lib.js — so a board passes only if the code
// that will run in the nightly refresh can actually read it.
//
//   node tools/verify_boards.mjs > .work/verified.json   (reads .work/trace.json)
//
// For each board it records:
//   jobs      — postings the adapter returned
//   poland    — of those, how many the feed's location filter accepts
//   keepNow   — how many pass every feed filter today (location, role,
//               exclusions, language)
//   declared  — the company name the platform itself reports, where it
//               reports one, and whether that matches the employer
//
// A board with jobs but zero Poland roles today is still reported: boards
// change, and whether to carry one is a judgement, not a rule.

import { readFileSync } from "node:fs";
import { FETCHERS, keep, matchesLocation } from "../api/_lib.js";
import { workPath } from "./_workdir.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const STRIP = /\b(sp\.?\s*z\s*o\.?\s*o\.?|s\.?a\.?|gmbh|ltd|limited|inc|llc|llp|bv|nv|poland|polska|group|holding|international|global|services|solutions|technologies|technology|consulting|company)\b/gi;

function nameMatches(declared, wanted) {
  const a = norm(declared);
  const b = norm(wanted);
  if (!a || !b) return null; // unknown, not false
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const sa = norm(String(declared).replace(STRIP, " "));
  const sb = norm(String(wanted).replace(STRIP, " "));
  return !!(sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa)));
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: "application/json" } });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function getText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA } });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

// What the platform says the board belongs to, where it says anything.
const DECLARED = {
  greenhouse: async (b) => (await getJson(`https://boards-api.greenhouse.io/v1/boards/${b.slug}`))?.name,
  workable: async (b) => (await getJson(`https://apply.workable.com/api/v1/widget/accounts/${b.slug}`))?.name,
  smartrecruiters: async (b) => (await getJson(`https://api.smartrecruiters.com/v1/companies/${b.slug}/postings?limit=1`))?.content?.[0]?.company?.name,
  recruitee: async (b) => (await getJson(`https://${b.slug}.recruitee.com/api/offers/`))?.offers?.[0]?.company_name,
  teamtailor: async (b) => {
    const x = await getText(`https://${b.slug}.teamtailor.com/jobs.rss`);
    return x ? (x.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null;
  },
  personio: async (b) => {
    const x = await getText(`https://${b.slug}.jobs.personio.${b.tld || "de"}/?language=en`);
    return x ? (x.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s*[-|–].*$/, "").trim() : null;
  },
};

// Trace reference -> board config for the production adapter.
function toBoard(ref, rec) {
  const name = rec.name;
  switch (ref.p) {
    case "workday": return { name, host: ref.host, tenant: ref.tenant, site: ref.site, recruiting: !!ref.recruiting };
    case "lever": return { name, slug: ref.slug, eu: !!ref.eu };
    case "personio": return { name, slug: ref.slug, tld: ref.tld };
    case "oracle": return { name, host: ref.host, site: ref.site };
    case "eightfold": {
      let domain = "";
      try { domain = new URL(rec.websites[0].startsWith("http") ? rec.websites[0] : `https://${rec.websites[0]}`).hostname.replace(/^www\./, ""); } catch { /* none */ }
      return domain ? { name, slug: ref.slug, domain } : null;
    }
    default: return ref.slug ? { name, slug: ref.slug } : null;
  }
}

const records = JSON.parse(readFileSync(process.argv[2] || workPath("trace.json"), "utf8"));
const tasks = [];
const unsupported = {};
const seen = new Set();

for (const rec of records) {
  for (const ref of rec.ats) {
    if (!FETCHERS[ref.p]) {
      (unsupported[ref.p] ||= new Set()).add(rec.name);
      continue;
    }
    const board = toBoard(ref, rec);
    if (!board) continue;
    const key = `${ref.p}:${JSON.stringify({ ...board, name: undefined })}`;
    if (seen.has(`${rec.name}|${key}`)) continue;
    seen.add(`${rec.name}|${key}`);
    tasks.push({ rec, ref, board, platform: ref.p });
  }
}

const results = [];
const queue = [...tasks];
await Promise.all(Array.from({ length: 8 }, async () => {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    let jobs = [];
    try { jobs = await FETCHERS[t.platform](t.board); } catch { jobs = []; }
    const poland = jobs.filter((j) => matchesLocation(j.location));
    const kept = jobs.filter(keep);
    let declared = null;
    if (DECLARED[t.platform]) { try { declared = await DECLARED[t.platform](t.board); } catch { /* none */ } }
    results.push({
      employer: t.rec.name,
      sources: t.rec.sources,
      platform: t.platform,
      board: t.board,
      evidence: t.ref.where,
      jobs: jobs.length,
      poland: poland.length,
      keepNow: kept.length,
      keepTitles: kept.slice(0, 6).map((j) => j.title),
      declared: declared || null,
      nameOk: declared ? nameMatches(declared, t.rec.name) : null,
    });
  }
}));

results.sort((a, b) => b.keepNow - a.keepNow || b.poland - a.poland || b.jobs - a.jobs);
const summary = {
  boards_checked: results.length,
  readable: results.filter((r) => r.jobs > 0).length,
  with_poland_roles: results.filter((r) => r.poland > 0).length,
  with_matching_roles_now: results.filter((r) => r.keepNow > 0).length,
  name_mismatch: results.filter((r) => r.nameOk === false).map((r) => `${r.employer} -> ${r.platform}/${r.board.slug || r.board.tenant} declared "${r.declared}"`),
  detected_without_adapter: Object.fromEntries(Object.entries(unsupported).map(([p, s]) => [p, [...s]])),
};
console.log(JSON.stringify({ summary, results }, null, 1));
