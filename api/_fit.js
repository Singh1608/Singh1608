// Link legitimacy and fit scoring.
//
// Two separate questions, deliberately kept apart:
//
//   1. Does this link go to the employer's own application system?
//      An aggregator link means an extra hop, often a stale copy, and
//      sometimes an application that never reaches the employer's funnel.
//      This is binary — a role with an aggregator link is not usable.
//
//   2. Would this role screen his CV in?
//      A score, because fit is a matter of degree.

import { excludedByTitle } from "./_lib.js";

// --- 1. link legitimacy -----------------------------------------------------

// Hosts that ARE an employer's own applicant tracking system.
const FIRST_PARTY_ATS = [
  "boards.greenhouse.io", "job-boards.greenhouse.io",
  "jobs.lever.co", "jobs.ashbyhq.com",
  "myworkdayjobs.com", "myworkdaysite.com",
  "smartrecruiters.com", "recruitee.com", "personio.de", "teamtailor.com",
  "icims.com", "taleo.net", "successfactors.com", "oraclecloud.com",
  "eightfold.ai", "avature.net", "workable.com", "jobvite.com",
  "bamboohr.com", "phenompeople.com", "brassring.com", "csod.com",
];

// Employer career domains that the company-name heuristic misses — short
// names ("EY") or sub-brands ("PwC Strategy&") that do not appear as a
// recognisable stem in their own hostname.
const KNOWN_EMPLOYER_HOSTS = [
  "careers.ey.com", "jobs-cee.pwc.com", "jobs.deloittece.com",
  "apply.deloitte.com", "careers.bcg.com", "talent.bain.com",
  "mckinsey.com", "careers.mastercard.com", "accenture.com",
  "jobs.kpmg.com", "careers.pwc.com", "jobs.ey.com",
];

// Job boards and aggregators. Every one of these was found in the feed or is
// a common Poland/consulting board, and none of them is an employer.
const AGGREGATORS = [
  "workopia.io", "wizbii.com", "efinancialcareers.com", "accaglobal.com",
  "managementconsulted.com", "linkedin.com", "indeed.", "glassdoor",
  "jooble", "neuvoo", "talent.com", "ziprecruiter", "monster.",
  "totaljobs", "reed.co.uk", "jobtome", "careerjet", "adzuna", "simplyhired",
  "pracuj.pl", "nofluffjobs", "justjoin.it", "bulldogjob", "englishjobs.pl",
  "jobs.pl", "gowork.pl", "olx.pl", "google.com/search",
];

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// A board root rather than one posting — applying to it is impossible.
export function isBoardRoot(url, title) {
  if (/job board|all (open )?roles|careers page/i.test(title || "")) return true;
  try {
    const { pathname, search } = new URL(url);
    const segments = pathname.split("/").filter(Boolean);
    // e.g. job-boards.greenhouse.io/xebiacee  -> board, no job id
    if (!search && segments.length <= 2 && !/\d{4,}/.test(pathname)) return true;
  } catch {
    return false;
  }
  return false;
}

export function classifyLink(url, company = "") {
  const h = hostOf(url);
  if (!h) return { ok: false, kind: "broken", host: h };
  for (const a of AGGREGATORS) {
    if (h.includes(a)) return { ok: false, kind: "aggregator", host: h };
  }
  for (const p of FIRST_PARTY_ATS) {
    if (h.includes(p)) return { ok: true, kind: "ats", host: h };
  }
  for (const e of KNOWN_EMPLOYER_HOSTS) {
    if (h.includes(e)) return { ok: true, kind: "employer", host: h };
  }
  const stem = company.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6);
  if (stem.length >= 4 && h.replace(/[^a-z]/g, "").includes(stem)) {
    return { ok: true, kind: "employer", host: h };
  }
  // Unrecognised host, unrecognisable as the employer's. Treated as unusable
  // rather than given the benefit of the doubt: the whole point is that a link
  // he clicks should land on the employer's own form.
  return { ok: false, kind: "unknown", host: h };
}

// --- 2. fit scoring ---------------------------------------------------------
//
// Weighted to what actually gets a CV through a screen for this profile:
// four years post-MiM, management consulting inside a bank, operating-model
// and finance-transformation delivery. Signals are additive and each one
// records why it fired, so a role can explain its own score.

// Ordered strongest first. Only the BEST match counts, not the sum: a
// "Strategy Consultant — Operating Model Design" should not out-score a
// genuinely better role just by matching two overlapping phrases for the same
// single job.
const TITLE_SIGNALS = [
  { re: /\b(finance transformation|cfo advisory|finance strategy|financial transformation|finance operating model)\b/i,
    pts: 4, why: "finance transformation — his Deloitte practice and the Al-Ghurair treasury redesign" },
  { re: /\b(business transformation|transformation consultant|operating model|target operating model|organi[sz]ational design|org design)\b/i,
    pts: 4, why: "transformation and operating-model design — the FAB coverage redesign and Al-Ghurair TOM" },
  { re: /\b(management consultant|strategy consultant|strategy (and|&) transformation|transformation (and|&) strategy)\b/i,
    pts: 4, why: "management/strategy consulting, which is his current title" },
  { re: /\b(strategy analyst|senior associate|corporate strategy|business strategy|commercial strategy|strategy (and|&) operations|corporate development|market entry|m&a|due diligence)\b/i,
    pts: 3, why: "strategy and corporate development — the Kazakhstan market-entry case is exactly this shape" },
  { re: /\b(chief of staff|business management|business manager)\b/i,
    pts: 3, why: "chief-of-staff shape, matching the Group Head of Wholesale Banking's Office" },
  { re: /\b(senior consultant|consultant|consulting)\b/i,
    pts: 2, why: "consulting role at his band" },
  { re: /\b(pmo|programme manage|program manage|portfolio manage|programme lead)\b/i,
    pts: 2, why: "PMO / programme management, which he has run at both FAB and Al-Ghurair" },
  { re: /\b(process excellence|operational excellence|process improvement|continuous improvement|lean|six sigma|process (re)?design)\b/i,
    pts: 2, why: "process excellence — Lean Six Sigma plus the 31% Treasury process cut" },
  { re: /\b(business analyst|business analysis|transformation analyst)\b/i,
    pts: 1, why: "business analysis" },
  { re: /\b(project manager|project management)\b/i,
    pts: 1, why: "project delivery" },
];

// Firms where consulting IS the product, so his consulting record is read as
// directly relevant rather than as adjacent industry experience.
const CONSULTANCY = /\b(capco|deloitte|pwc|strategy&|ey|ernst|kpmg|accenture|bcg|boston consulting|bain|mckinsey|oliver wyman|alvarez|roland berger|kearney|zs associates|simon-kucher)\b/i;

// Financial services is where he screens best: four years of banking and
// insurance-adjacent delivery is a differentiator there and irrelevant
// elsewhere.
const FS_EMPLOYER = /\b(capco|bank|banking|citi|goldman|ubs|ing|nordea|santander|mastercard|visa|revolut|wise|klarna|n26|adyen|sumup|deloitte|pwc|ey|kpmg|accenture|bcg|bain|mckinsey|strategy&|oliver wyman|alvarez)\b/i;
const FS_ROLE = /\b(bank|banking|financial services|payments|capital markets|treasury|wholesale|insurance|fintech|cards)\b/i;

// Industries where his four years read as irrelevant to a screener, however
// well the verbs match.
const INDUSTRY_MISMATCH = [
  { re: /\b(life science|healthcare|clinical|pharma|biotech|medical device)\b/i, why: "life sciences / healthcare industry" },
  { re: /\b(marketing|advertising|creative agency|brand experience)\b/i, why: "marketing / agency industry" },
  { re: /\b(retail store|hospitality|travel|logistics warehouse)\b/i, why: "industry unrelated to his record" },
];

export function scoreFit({ title = "", company = "", why = "", location = "" }) {
  const haystack = `${title} ${why}`;
  const reasons = [];
  let score = 0;

  // Best single title match only — see the note on TITLE_SIGNALS.
  const best = TITLE_SIGNALS.find((s) => s.re.test(title));
  if (best) {
    score += best.pts;
    reasons.push(best.why);
  }

  if (FS_EMPLOYER.test(company) || FS_ROLE.test(haystack)) {
    score += 2;
    reasons.push("financial services, where four years of banking delivery is a differentiator");
  }

  if (CONSULTANCY.test(company)) {
    score += 1;
    reasons.push("a consulting firm, so his consulting record reads as directly relevant");
  }

  const penalties = [];
  for (const m of INDUSTRY_MISMATCH) {
    if (m.re.test(haystack)) {
      score -= 3;
      penalties.push(m.why);
    }
  }

  // tier 1 is reserved for roles where the mapping is close to one-to-one.
  const tier = score >= 6 ? 1 : score >= 4 ? 2 : score >= 2 ? 3 : 0;
  return { score, tier, reasons, penalties };
}

// One gate for both questions, so nothing enters the feed that fails either.
//
// The title exclusions are applied here as well as in keep(). keep() only runs
// against postings arriving from a board sweep; anything already stored is
// re-judged through this function, so without the check here a role that got
// in under looser rules would survive every later tightening.
export function assess(job) {
  const link = classifyLink(job.url, job.company);
  const fit = scoreFit(job);
  const problems = [];
  if (!link.ok) problems.push(`link is ${link.kind} (${link.host})`);
  if (isBoardRoot(job.url, job.title)) problems.push("link is a board root, not a posting");
  if (excludedByTitle(job.title)) problems.push("title is outside his track");
  if (fit.tier === 0) problems.push(`fit score ${fit.score} is below the threshold`);
  return { link, fit, usable: problems.length === 0, problems };
}

// Explain the role in his terms rather than the pipeline's. Replaces the
// "Matched on title and Poland location from X's greenhouse board" text,
// which told him nothing about whether to apply.
export function explain(job, fit) {
  const parts = [];
  if (fit.reasons.length) {
    parts.push(fit.reasons[0].charAt(0).toUpperCase() + fit.reasons[0].slice(1));
    if (fit.reasons.length > 1) parts.push(fit.reasons.slice(1).join("; "));
  }
  if (fit.penalties.length) parts.push(`Against it: ${fit.penalties.join("; ")}`);
  return parts.join(". ") + ".";
}
