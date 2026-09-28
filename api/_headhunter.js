// Head Hunter: every role scored out of 100, in four parts.
//
//   Skills overlap   40  what a hiring manager checks first
//   Seniority fit    25  keeps him out of roles he'd be rejected from in one line
//   Domain fit       20  the same title in the wrong industry is not the same job
//   Practical fit    15  location, work mode, salary: what kills an offer late
//
// Two rules do the heavy lifting:
//
//   1. Only production evidence counts. A skill he has used in a paid role
//      (resume/experience-master.md) scores. One he has only listed, or learned
//      on a course, scores zero, the same as one he does not have.
//   2. Hidden is low, never guessed. When a posting hides the salary, the
//      seniority or the work mode, that part scores low rather than getting
//      the benefit of the doubt.
//
// Split in two so the rules can change without re-reading every posting:
// extractFeatures() runs in the daily check against the posting text and
// stores only what it found; scoreRole() runs on every read of the feed.

import { CONSULTANCY, INDUSTRY_MISMATCH } from "./_fit.js";

export const WEIGHTS = { skills: 40, seniority: 25, domain: 20, practical: 15 };

// Must match BANDS in index.html; tests/headhunter.test.mjs checks that it does.
export const BANDS = [
  { key: "strong", min: 70, label: "Strong match" },
  { key: "good",   min: 55, label: "Good match" },
  { key: "stretch", min: 40, label: "Stretch" },
  { key: "long",   min: 0,  label: "Long shot" },
];
export function bandOf(total) {
  return BANDS.find((b) => total >= b.min).key;
}

// --- 1. skills -----------------------------------------------------------------
//
// `evidence` is where the skill stands in his record:
//   production  used in a paid role; named in the experience master
//   listed      on the CV's skills line or coursework only: scores zero
//   none        not in his record at all: scores zero
// Both zero-scoring kinds still count as asked-for, so a posting built around
// tools he lacks scores low rather than being judged on what little matched.
//
// `generic` marks asks that nearly every posting makes (stakeholders,
// reporting, Excel). They say nothing about fit, so they are left out of the
// ratio entirely; counting them let an operations role score 40/40.
export const SKILLS = [
  // Production: FAB, Al-Ghurair, Deloitte
  { key: "strategy", label: "corporate / business strategy", evidence: "production",
    re: /\b(corporate strategy|business strategy|strategic planning|growth strateg\w*|strategy development|strategic initiatives?)\b/i },
  { key: "market_entry", label: "market entry and sizing", evidence: "production",
    re: /\b(market entry|market assessments?|market sizing|go-to-market|expansion strateg\w*|new markets?)\b/i },
  { key: "business_case", label: "business cases", evidence: "production", re: /\bbusiness cases?\b/i },
  { key: "modelling", label: "financial modelling and forecasting", evidence: "production",
    re: /\b(financial model\w*|forecast\w*|budget\w*|fp&a|financial planning|valuation model\w*)\b/i },
  { key: "operating_model", label: "operating model / org design", evidence: "production",
    re: /\b(operating models?|target operating|tom\b|organi[sz]ational design|org design|organi[sz]ation design)\b/i },
  { key: "process", label: "process mapping and redesign", evidence: "production",
    re: /\b(process (mapping|improvement|redesign|re-?engineering|optimi[sz]ation|design|excellence)|business process\w*|end-to-end process\w*)\b/i },
  { key: "pmo", label: "PMO and programme governance", evidence: "production",
    re: /\b(pmo|programme management|program management|project governance|programme governance|portfolio management|project management office)\b/i },
  { key: "transformation", label: "transformation delivery", evidence: "production",
    re: /\btransformation\w*\b/i },
  { key: "cost", label: "cost and procurement savings", evidence: "production",
    re: /\b(cost (reduction|optimi[sz]ation|transformation|efficiency)|savings|procurement)\b/i },
  { key: "shared_services", label: "shared services / GBS", evidence: "production",
    re: /\b(shared services?|gbs|global business services|offshoring|centre of excellence)\b/i },
  { key: "stakeholder", label: "senior stakeholder management", evidence: "production", generic: true,
    re: /\bstakeholders?\b/i },
  { key: "uat", label: "UAT and test design", evidence: "production",
    re: /\b(uat|user acceptance|test (cases|scripts|coverage|scenarios)|testing)\b/i },
  { key: "workday", label: "Workday / ERP finance systems", evidence: "production",
    re: /\b(workday|erp|adaptive planning)\b/i },
  { key: "integration", label: "system integrations and data migration", evidence: "production",
    re: /\b(integrations?|data migration|interfaces|xml|eib|apis?)\b/i },
  { key: "excel", label: "Excel / VBA", evidence: "production", generic: true, re: /\b(excel|vba|macros?)\b/i },
  { key: "reporting", label: "reporting, KPIs and dashboards", evidence: "production", generic: true,
    re: /\b(reporting|dashboards?|kpis?|scorecards?|management information)\b/i },
  { key: "analysis", label: "data and spend analysis", evidence: "production", generic: true,
    re: /\b(data analysis|analytics|analytical|spend analysis)\b/i },
  { key: "payments", label: "payments (ACH, clearing)", evidence: "production",
    re: /\b(payments?|ach|sepa|nacha|clearing)\b/i },
  { key: "banking", label: "banking, treasury and trade finance", evidence: "production",
    re: /\b(banking|corporate bank\w*|wholesale|treasury|trade finance|lending|cash management)\b/i },
  { key: "finance_transformation", label: "finance function transformation", evidence: "production",
    re: /\b(finance transformation|finance function|cfo|record to report|r2r|general ledger|financial close)\b/i },
  { key: "automation", label: "process automation", evidence: "production",
    re: /\b(automation|automat(e|ing) (processes|workflows?)|rpa)\b/i },
  { key: "presentations", label: "executive decks and storylining", evidence: "production", generic: true,
    re: /\b(powerpoint|presentations?|storyline\w*|executive (communication|materials))\b/i },

  // Listed only: on the CV or a course, never used in a paid role. Scores zero.
  { key: "python", label: "Python", evidence: "listed", re: /\bpython\b/i },
  { key: "sql", label: "SQL", evidence: "listed", re: /\bsql\b/i },
  { key: "cloud", label: "cloud platforms", evidence: "listed", re: /\b(aws|azure|gcp|google cloud|cloud (platforms?|computing|migration))\b/i },
  { key: "agile", label: "Agile / Scrum", evidence: "listed", re: /\b(agile|scrum|kanban|safe)\b/i },
  { key: "jira", label: "JIRA / DevOps tooling", evidence: "listed", re: /\b(jira|confluence|azure devops|devops)\b/i },
  { key: "lean", label: "Lean Six Sigma", evidence: "listed", re: /\b(lean|six sigma|kaizen|dmaic)\b/i },
  { key: "design_thinking", label: "design thinking", evidence: "listed", re: /\bdesign thinking\b/i },
  { key: "process_tools", label: "BPMN / Visio / Signavio", evidence: "listed", re: /\b(bpmn|visio|signavio|aris)\b/i },
  { key: "ai_ml", label: "AI / machine learning", evidence: "listed",
    re: /\b(machine learning|artificial intelligence|gen ?ai|generative ai|llms?|ai\b)/i },
  { key: "power_automate", label: "Power Automate / low-code", evidence: "listed", re: /\b(power automate|power platform|low-code|n8n)\b/i },

  // Not in his record at all.
  { key: "sap", label: "SAP", evidence: "none", re: /\b(sap|s\/4 ?hana)\b/i },
  { key: "oracle", label: "Oracle ERP", evidence: "none", re: /\boracle\b/i },
  { key: "bi_tools", label: "Power BI / Tableau", evidence: "none", re: /\b(power bi|tableau|qlik|looker)\b/i },
  { key: "regulatory", label: "regulatory and compliance", evidence: "none",
    re: /\b(regulatory|compliance|basel|crd|ifrs ?9|aml|kyc|dora|mifid)\b/i },
  { key: "risk", label: "risk management", evidence: "none", re: /\b(risk management|credit risk|market risk|operational risk)\b/i },
  { key: "deals", label: "M&A and due diligence", evidence: "none",
    re: /\b(m&a|due diligence|mergers|acquisitions|post-merger|pmi|transaction services)\b/i },
  { key: "crm", label: "CRM platforms", evidence: "none", re: /\b(crm|salesforce|dynamics 365|hubspot)\b/i },
  { key: "pricing", label: "pricing", evidence: "none", re: /\bpricing\b/i },
  { key: "supply_chain", label: "supply chain", evidence: "none", re: /\b(supply chain|logistics|s&op)\b/i },
  { key: "data_engineering", label: "data engineering", evidence: "none",
    re: /\b(data engineering|etl|data pipelines?|data warehous\w*|databricks|snowflake)\b/i },
  // Specialist banking and insurance platforms and functions. Without these a
  // "Business Analyst – Avaloq" read as a perfect match: the platform it is
  // built around was simply not a word the score knew.
  { key: "core_platforms", label: "core banking / investment platforms (Avaloq, Temenos, Murex, SimCorp …)", evidence: "none",
    re: /\b(avaloq|temenos|t24|finacle|flexcube|murex|calypso|simcorp|charles river|aladdin|bloomberg aim|summit|guidewire|duck creek)\b/i },
  { key: "securities_ops", label: "securities operations (custody, fund accounting, NAV)", evidence: "none",
    re: /\b(custody|depositary|fund (accounting|administration|services)|nav\b|net asset value|securities (settlement|operations|services)|corporate actions|trade (settlement|lifecycle|support)|middle office|back office|reconciliations?)\b/i },
  { key: "markets", label: "capital markets and trading", evidence: "none",
    re: /\b(capital markets|trading|derivatives|fixed income|equities|front office|treasury management systems?|fx (trading|products))\b/i },
  { key: "insurance_ops", label: "insurance operations (underwriting, claims, policy admin)", evidence: "none",
    re: /\b(underwriting|claims (handling|management|processing)|policy administration|actuarial|reinsurance)\b/i },
  { key: "accounting", label: "accounting qualification (ACCA, CIMA, CPA)", evidence: "none",
    re: /\b(acca|cima|cpa|chartered accountant|statutory accounts|us gaap)\b/i },
];

// Fewer asks than this and the skills part is scaled down: a posting too thin
// to name six skills has hidden what it wants, and hidden is low.
const MIN_ASKS = 6;

// --- 2. seniority ----------------------------------------------------------------

// Continuous paid experience since Sept 2021.
export const HIS_YEARS = 4;

function levelFromTitle(title) {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|graduate|junior|entry[- ]level|apprentice|praktyk|sta[żz])/.test(t)) {
    return { score: 4, note: "junior title, below his four years" };
  }
  if (/\b(director|head of|vice president|vp|principal|partner|senior manager|associate director|executive)\b/.test(t)) {
    return { score: 3, note: "executive title, well above his band" };
  }
  if (/\b(senior consultant|senior associate|experienced consultant|consultant ii|senior analyst)\b/.test(t)) {
    return { score: 25, note: "senior consultant level, exactly his band" };
  }
  // "Manager" as a level, not as a role name like Project Manager.
  if (/\bmanager\b/.test(t) && !/\b(project|programme|program|product|process|change|delivery|portfolio|business|account|office)\s+manager\b/.test(t)) {
    return { score: 12, note: "manager title, a step above his band" };
  }
  if (/\b(senior|sr\.?|lead)\b/.test(t)) return { score: 22, note: "senior title, within reach at four years" };
  if (/\b(consultant|associate|specialist)\b/.test(t)) return { score: 23, note: "consultant level, his band" };
  if (/\banalyst\b/.test(t)) return { score: 18, note: "analyst title, slightly junior for four years" };
  return null;
}

function levelFromYears(y) {
  if (!y) return null;
  const { min } = y;
  if (min <= 1) return { score: 8, note: `asks ${min}+ years, a junior role` };
  if (min <= 3) return { score: 22, note: `asks ${min}+ years; he has ${HIS_YEARS}` };
  if (min <= 5) return { score: 25, note: `asks ${min}+ years; he has ${HIS_YEARS}` };
  if (min === 6) return { score: 15, note: `asks ${min}+ years; he has ${HIS_YEARS}` };
  if (min <= 8) return { score: 7, note: `asks ${min}+ years; he has ${HIS_YEARS}` };
  return { score: 3, note: `asks ${min}+ years; he has ${HIS_YEARS}` };
}

// --- 3. domain -------------------------------------------------------------------

const FS_COMPANY = /\b(capco|bank|banking|citi|citibank|goldman|ubs|ing|nordea|santander|mastercard|visa|revolut|wise|klarna|n26|adyen|sumup|hsbc|jp ?morgan|bnp|societe generale|soci[eé]t[eé] g[eé]n[eé]rale|credit suisse|deutsche bank|commerzbank|pekao|pko|mbank|millennium|state street|northern trust|bny|lombard|allianz|axa|generali|aviva|zurich|swiss re|munich re)\b/i;
const FS_TEXT = /\b(banks?|banking|financial services|financial institutions?|payments?|capital markets|treasury|wholesale|insurance|insurers?|fintech|cards|asset management|wealth management|lending)\b/gi;
const CORE_FUNCTION = /\b(strategy|strategic|transformation|operating model|finance transformation|cfo|pmo|programme|program management|process excellence|operational excellence|management consult\w*)\b/i;
const NEAR_FUNCTION = /\b(business analy\w*|project manage\w*|change manage\w*|process)\b/i;
// Titles for jobs that run a function rather than change it.
const OFF_FUNCTION = /\b(operations (specialist|analyst|associate)|depositary|custody|fund account\w*|underwriter|developer|engineer|architect|administrator|support|accountant|auditor|sales|recruit\w*|expert)\b/i;

// --- 4. practical ----------------------------------------------------------------

const WARSAW = /\b(warsaw|warszawa|warschau)\b/i;
const OTHER_PL = /\b(krak[oó]w|cracow|wroc[lł]aw|gda[nń]sk|gdynia|sopot|tricity|pozna[nń]|[lł][oó]d[zź]|katowice|lublin|szczecin|bydgoszcz|bia[lł]ystok|rzesz[oó]w|toru[nń]|gliwice)\b/i;
const POLAND = /\b(poland|polska|pl)\b/i;

// --- language requirements ---------------------------------------------------
//
// A posting that requires a language he does not speak is out, however well
// it scores. The title-only check in _lib.js cannot see "Fluent Polish and
// strong English" in the body, and five of the first shortlist's top roles
// said exactly that. Soft wording ("an asset", "preferred", "Polish classes
// for foreign employees") and the language used as an adjective ("the Polish
// insurance market") do not count.
const LANGS = "polish|german|french|dutch|flemish|spanish|italian|portuguese|czech|slovak|hungarian|romanian|" +
  "bulgarian|croatian|serbian|slovenian|norwegian|swedish|danish|finnish|russian|ukrainian|turkish|greek|" +
  "hebrew|japanese|korean|mandarin|chinese";
const SOFT = /\b(assets?|plus|advantage\w*|nice[- ]to[- ]have|valued|preferred|beneficial|welcome\w*|bonus|classes|lessons|courses?|desirable|appreciated|optional|would help|is helpful|ideally)\b/i;
const NOT_LANGUAGE = new RegExp(`\\b(${LANGS})\\s+(market|clients?|customers?|law|companies|company|entit\\w*|offices?|z[lł]oty|regulat\\w*|accounting|gaap|tax\\w*|business|banks?|economy|subsidiar\\w*|operations?|citizens?|work permit)`, "gi");
const REQUIRED_BEFORE = new RegExp(`\\b(fluent|fluency|native|excellent|very good|good command|strong|business[- ]level|professional|proficien\\w*|advanced|c1|c2|b2)\\b[^.;•\\n]{0,50}?\\b(${LANGS})\\b`, "i");
const REQUIRED_AFTER = new RegExp(`\\b(${LANGS})\\b[^.;•\\n]{0,40}?\\b(required|mandatory|a must|is a must|essential|c1|c2|b2|native|fluent|fluency)\\b`, "i");

export function languagesRequired(text = "") {
  const found = new Set();
  if (/znajomo[sś][cć] j[eę]zyka polskiego|j[eę]zyk polski|bieg[lł]a znajomo[sś][cć] polskiego/i.test(text)) found.add("Polish");
  for (const raw of String(text).split(/\n+|(?<=[.;•])\s+/)) {
    const line = raw.replace(NOT_LANGUAGE, " ");
    if (!new RegExp(`\\b(${LANGS})\\b`, "i").test(line) || SOFT.test(line)) continue;
    for (const re of [REQUIRED_BEFORE, REQUIRED_AFTER]) {
      const m = line.match(re);
      if (!m) continue;
      const lang = (m[2] && new RegExp(`^(${LANGS})$`, "i").test(m[2]) ? m[2] : m[1]).toLowerCase();
      found.add(lang.charAt(0).toUpperCase() + lang.slice(1));
    }
  }
  return [...found];
}

// --- extraction (runs in the daily check) --------------------------------------

const MODE_RE = [
  ["remote", /\b(fully remote|100% remote|remote[- ]first|work from home|remote (role|position|work)|praca zdalna|zdalnie)\b/i],
  ["hybrid", /\b(hybrid|hybrydow\w*|\d days? (a|per) week in (the )?office)\b/i],
  ["onsite", /\b(on-?site|office[- ]based|in the office|stacjonarn\w*)\b/i],
];

// An amount with a currency, or a range of amounts. "Competitive salary"
// carries no number and does not count as disclosed.
const SALARY_RE = /((pln|zł|zl|eur|€|usd|\$|gbp|£)\s?\d{1,3}([\s.,]?\d{3})+|\d{1,3}([\s.,]?\d{3})*\s?(k)?\s?(-|–|—|to)\s?\d{1,3}([\s.,]?\d{3})*\s?(k)?\s?(pln|zł|zl|eur|€|usd|gbp|brutto|netto|gross|net)|\d{1,3}([\s.,]?\d{3})+\s?(pln|zł|zl|eur|€)|wynagrodzenie[^.]{0,40}\d{3})/i;

const YEARS_RE = /(?:(?:minimum|min\.?|at least|over)\s+)?(\d{1,2})\s*(?:\+|(?:\s*(?:-|–|to)\s*(\d{1,2})))?\s*\+?\s*(?:years?|yrs?|lat)\b(?:\s+of)?[^.]{0,80}?(?:experience|expertise|do[sś]wiadczeni)/i;

export function extractFeatures(text = "", meta = {}) {
  const body = String(text || "");
  const skills = SKILLS.filter((s) => s.re.test(body)).map((s) => s.key);
  const m = body.match(YEARS_RE);
  const years = m ? { min: Number(m[1]), max: m[2] ? Number(m[2]) : null } : null;
  let mode = meta.mode || null;
  if (!mode) for (const [k, re] of MODE_RE) if (re.test(body)) { mode = k; break; }
  const fsMentions = (body.match(FS_TEXT) || []).length;
  const mismatch = INDUSTRY_MISMATCH.filter((x) => x.re.test(body)).map((x) => x.why);
  return {
    has_text: body.trim().length >= 400,
    skills,
    years: years && years.min <= 20 ? years : null,
    mode,
    salary: !!meta.salary || SALARY_RE.test(body),
    fs_mentions: fsMentions,
    mismatch,
    warsaw: WARSAW.test(body),
    languages_required: languagesRequired(body),
    core_mentions: (body.match(new RegExp(CORE_FUNCTION.source, "gi")) || []).length,
  };
}

// --- scoring (runs on every read) ------------------------------------------------

export function scoreRole(job, features) {
  const title = job.title || "";
  const company = job.company || "";
  const location = job.location || "";
  // Without the posting text, score from the title alone: every part the text
  // would have answered is then hidden, and scores low.
  const f = features && features.has_text ? features : extractFeatures(title, {});
  const basis = features && features.has_text ? "posting" : "title only";

  // Skills. The title's own words count too: a "Finance Transformation"
  // title asks for finance transformation even if the body never repeats it.
  const asked = new Set(f.skills);
  for (const s of SKILLS) if (s.re.test(title)) asked.add(s.key);
  const bySkill = Object.fromEntries(SKILLS.map((s) => [s.key, s]));
  const matched = [], listedOnly = [], missing = [];
  let counted = 0;
  for (const k of asked) {
    const s = bySkill[k];
    if (!s || s.generic) continue;
    counted++;
    if (s.evidence === "production") matched.push(s.label);
    else if (s.evidence === "listed") listedOnly.push(s.label);
    else missing.push(s.label);
  }
  const skills = Math.round(WEIGHTS.skills * matched.length / Math.max(counted, MIN_ASKS));

  // Seniority: the stricter of what the title and the posting say. With only
  // one of them, capped below full marks; with neither, low.
  const byTitle = levelFromTitle(title);
  const byYears = levelFromYears(f.years);
  let seniority, seniorityNote;
  if (byTitle && byYears) {
    const worse = byTitle.score <= byYears.score ? byTitle : byYears;
    seniority = worse.score;
    seniorityNote = `${byYears.note}; ${byTitle.note}`;
  } else if (byTitle || byYears) {
    const one = byTitle || byYears;
    seniority = Math.min(one.score, 20);
    seniorityNote = `${one.note}; ${byTitle ? "years not stated" : "level not in the title"}`;
  } else {
    seniority = 7;
    seniorityNote = "seniority hidden: no level in the title and no years stated";
  }

  // Domain: industry (14) plus function (6).
  const titleCo = `${title} ${company}`;
  const titleMismatch = INDUSTRY_MISMATCH.filter((x) => x.re.test(titleCo)).map((x) => x.why);
  const fsSignal = FS_COMPANY.test(company) || /\b(bank|banking|payments|treasury|insurance|capital markets|financial services|fintech|cards)\b/i.test(title);
  let industry, domainNote;
  if (titleMismatch.length) {
    industry = 2; domainNote = titleMismatch[0];
  } else if (fsSignal) {
    industry = 14; domainNote = "financial services, where four years of banking delivery counts";
  } else if (f.fs_mentions >= 3 && f.fs_mentions > f.mismatch.length * 2) {
    industry = 12; domainNote = "financial-services clients named throughout the posting";
  } else if (f.mismatch.length && f.fs_mentions < 2) {
    industry = 4; domainNote = f.mismatch[0];
  } else if (CONSULTANCY.test(company)) {
    industry = 9; domainNote = "a consulting firm, industry not specified";
  } else {
    industry = basis === "posting" ? 6 : 5;
    domainNote = "industry outside his record, not a mismatch";
  }
  // Function from the title first. The body can lift a neutral title, but
  // only when it keeps coming back to strategy or transformation work.
  const fn = CORE_FUNCTION.test(title) ? 6
    : OFF_FUNCTION.test(title) ? 0
    : NEAR_FUNCTION.test(title) || (f.core_mentions || 0) >= 4 ? 4
    : 1;
  const domain = industry + fn;

  // Practical: location (8), work mode stated (3), salary stated (4).
  // Workday and several career sites carry the city in the posting URL
  // (…/job/Warsaw/…) when the location field is blank.
  let urlPath = "";
  try { urlPath = decodeURIComponent(new URL(job.url || "").pathname).replace(/[-_/]+/g, " "); } catch { urlPath = ""; }
  const where = `${location} ${title} ${urlPath}`;
  let loc, locNote;
  if (WARSAW.test(where) || (f.warsaw && !OTHER_PL.test(where))) { loc = 8; locNote = "Warsaw"; }
  else if (f.mode === "remote" && POLAND.test(where)) { loc = 8; locNote = "remote in Poland"; }
  else if (OTHER_PL.test(where)) { loc = 3; locNote = "Poland, outside Warsaw"; }
  else if (POLAND.test(where)) { loc = 5; locNote = "Poland, city not named"; }
  else { loc = 2; locNote = "location not stated"; }
  const mode = f.mode ? 3 : 1;
  const salary = f.salary ? 4 : 0;
  const practical = loc + mode + salary;
  const practicalNote = [
    locNote,
    f.mode ? `${f.mode} stated` : "work mode hidden",
    f.salary ? "salary stated" : "salary hidden",
  ].join("; ");

  const total = skills + seniority + domain + practical;
  const langs = (features && features.languages_required) || [];
  return {
    total,
    // Out regardless of score: he cannot apply to a role in a language he does not speak.
    excluded: langs.length ? `posting requires ${langs.join(" and ")}` : null,
    band: bandOf(total),
    basis,
    parts: {
      skills: { score: skills, max: WEIGHTS.skills, matched, listed_only: listedOnly, missing },
      seniority: { score: seniority, max: WEIGHTS.seniority, note: seniorityNote },
      domain: { score: domain, max: WEIGHTS.domain, note: domainNote },
      practical: { score: practical, max: WEIGHTS.practical, note: practicalNote },
    },
  };
}
