// Turn the trace (tools/trace_employers.mjs) into SOURCES entries, keeping only
// boards the PRODUCTION adapters can read and that carry roles in Poland today.
//
//   node tools/build_sources.mjs > .work/sources.json   (reads .work/trace.json)
//
// Every candidate is fetched with the same code the nightly refresh runs. A
// board is kept only when it returns at least one posting the feed's location
// filter accepts. Candidates whose board identifier does not resemble the
// employer's name are kept but flagged `review`, because the trace showed that
// shape of mistake is real: "Capco" once resolved to a US credit union's
// Workday, "Emerson" to Emerson College's.

import { readFileSync } from "node:fs";
import { FETCHERS, keep, matchesLocation, SOURCES } from "../api/_lib.js";
import { workPath } from "./_workdir.mjs";

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const LEGAL = /\b(sp\.?\s*z\s*o\.?\s*o\.?|s\.?\s?a\.?|sp\.?\s*k\.?|sp\.?\s*j\.?|spółka.*|gmbh|ltd\.?|limited|inc\.?|llc|llp|b\.?v\.?|n\.?v\.?|ag|kft\.?|oddział.*)$/i;

function cleanName(n) {
  let s = String(n).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) s = s.replace(LEGAL, "").replace(/[,\s]+$/, "").trim();
  return s.replace(/\s+(Poland|Polska)$/i, "").trim() || String(n).trim();
}

// Where a board belongs to a parent company, or the discovering name was
// ambiguous, label the board by who actually owns it. Found by reading the
// verification table, not guessed.
const OWNER = {
  "mmc": "Marsh McLennan (Oliver Wyman)",
  "msd": "MSD",
  "dover": "Dover",
  "tsys": "Global Payments (TSYS)",
  "flextronics": "Flex (Anord Mardix)",
  "Salomon": "Salomon (Amer Sports)",
  "beigene": "BeOne Medicines",
  "kcura": "Relativity",
};

// Already in SOURCES — never duplicated.
const existing = new Set();
for (const [p, boards] of Object.entries(SOURCES)) {
  for (const b of boards) existing.add(`${p}:${(b.slug || b.tenant || b.host || "").toLowerCase()}`);
}

const whereUrl = (w) => (String(w).match(/https?:\/\/[^\s]+/) || [])[0];

function phenomBase(u) {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/^\/((?:[a-z]{2}|global)\/[a-z]{2})(?:\/|$)/);
    return { host: url.host, base: `${url.origin}${m ? "/" + m[1] : ""}` };
  } catch { return null; }
}

function candidates(rec) {
  const out = [];
  for (const a of rec.ats) {
    const w = whereUrl(a.where);
    switch (a.p) {
      case "workday":
        // Internal career sites are for existing employees and cannot be
        // applied to from outside.
        if (/internal/i.test(a.site)) break;
        out.push({ platform: "workday", board: { host: a.host, tenant: a.tenant, site: a.site, recruiting: !!a.recruiting }, id: a.tenant });
        break;
      case "lever": out.push({ platform: "lever", board: { slug: a.slug, eu: !!a.eu }, id: a.slug }); break;
      case "personio": out.push({ platform: "personio", board: { slug: a.slug, tld: a.tld }, id: a.slug }); break;
      case "oracle": out.push({ platform: "oracle", board: { host: a.host, site: a.site }, id: a.host }); break;
      case "eightfold": {
        let domain = "";
        try { domain = new URL(/^https?:/.test(rec.websites[0]) ? rec.websites[0] : `https://${rec.websites[0]}`).hostname.replace(/^www\./, ""); } catch { /* none */ }
        if (domain) out.push({ platform: "eightfold", board: { slug: a.slug, domain }, id: a.slug });
        break;
      }
      case "teamtailor":
        // The fingerprint catches Teamtailor's script host (tt.teamtailor.com)
        // on employer-domain career sites; the board is that employer domain.
        if (a.slug === "tt" || !a.slug) {
          if (w) { try { out.push({ platform: "teamtailor", board: { host: new URL(w).host }, id: new URL(w).host }); } catch { /* skip */ } }
        } else out.push({ platform: "teamtailor", board: { slug: a.slug }, id: a.slug });
        break;
      case "phenom": {
        const pb = w && phenomBase(w);
        if (pb) out.push({ platform: "phenom", board: pb, id: pb.host });
        break;
      }
      case "successfactors":
      case "jobs2web":
        // The career site is the page that referenced SuccessFactors.
        if (w) { try { const h = new URL(w).host; out.push({ platform: "successfactors", board: { host: h }, id: h }); } catch { /* skip */ } }
        break;
      case "csod": out.push({ platform: "cornerstone", board: { slug: a.slug, site: a.site }, id: a.slug }); break;
      default:
        if (a.slug && FETCHERS[a.p]) out.push({ platform: a.p, board: { slug: a.slug }, id: a.slug });
    }
  }
  return out;
}

const records = JSON.parse(readFileSync(process.argv[2] || workPath("trace.json"), "utf8"));
const byKey = new Map();
for (const rec of records) {
  for (const c of candidates(rec)) {
    const key = `${c.platform}:${JSON.stringify(c.board)}`;
    if (existing.has(`${c.platform}:${String(c.id).toLowerCase()}`)) continue;
    if (!byKey.has(key)) byKey.set(key, { ...c, employers: new Set() });
    byKey.get(key).employers.add(rec.name);
  }
}

const tasks = [...byKey.values()];
const results = [];
await Promise.all(Array.from({ length: 8 }, async () => {
  for (;;) {
    const t = tasks.shift();
    if (!t) return;
    const employer = [...t.employers][0];
    const label = OWNER[t.id] || cleanName(employer);
    let jobs = [];
    try { jobs = await FETCHERS[t.platform]({ name: label, ...t.board }); } catch { jobs = []; }
    const poland = jobs.filter((j) => matchesLocation(j.location)).length;
    const keepNow = jobs.filter(keep).length;
    const idn = norm(t.id);
    const en = norm(cleanName(employer));
    const review = !(idn.includes(en.slice(0, 5)) || en.includes(idn.slice(0, 5)) || OWNER[t.id]);
    results.push({ name: label, platform: t.platform, board: t.board, employers: [...t.employers], jobs: jobs.length, poland, keepNow, review });
  }
}));

// One employer on Phenom *and* Workday/Oracle is the same postings twice —
// State Street's Phenom jobs apply through its Workday. Keep the ATS.
const atsEmployers = new Set(results.filter((r) => r.poland > 0 && ["workday", "oracle"].includes(r.platform)).flatMap((r) => r.employers));
const kept = results
  .filter((r) => r.poland > 0)
  .filter((r) => !(r.platform === "phenom" && r.employers.some((e) => atsEmployers.has(e))))
  .sort((a, b) => b.keepNow - a.keepNow || b.poland - a.poland);

const dropped = {
  unreadable: results.filter((r) => r.jobs === 0).map((r) => `${r.platform}:${r.name}`),
  no_poland_roles: results.filter((r) => r.jobs > 0 && r.poland === 0).map((r) => `${r.platform}:${r.name}`),
  phenom_duplicate_of_ats: results.filter((r) => r.poland > 0 && r.platform === "phenom" && r.employers.some((e) => atsEmployers.has(e))).map((r) => r.name),
};
console.log(JSON.stringify({ kept, dropped }, null, 1));
