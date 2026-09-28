// ATS keyword match: which of a posting's searchable terms his resume already
// carries, which he can truthfully add, and which he does not have.
//
// Recruiters search an ATS like a database: exact job title, exact skill
// strings. A resume that says "process modelling" is not found by a search for
// "process mapping". So terms are kept in the posting's own spelling, and the
// resume is judged on exact phrases, not synonyms.
//
//   postingTerms(text)       -> [[canonical, form as written in the posting, count], ...]
//   atsMatch(job, features)  -> { headline, total, on_resume, can_add, missing, reachable, target }
//
// The target is 25-35 posting terms on the tailored resume: fewer and it does
// not surface in enough searches, more and it reads as stuffing.

import { RESUME_TERMS, EVIDENCE_TERMS } from "./_resume_terms.js";

export const TARGET = [25, 35];

// Terms a recruiter types into an ATS search for the roles he targets. US and
// UK spellings are separate entries on purpose: they are different strings.
// Matching ignores case, as ATS search does, except for the names below that
// are also ordinary words ("your workday", "excel at", "a lean team").
export const VOCAB = [
  // business analysis and delivery
  "business analysis", "business analyst", "requirements gathering", "requirements elicitation",
  "business requirements", "functional requirements", "user stories", "acceptance criteria",
  "process mapping", "process modeling", "process modelling", "business process modeling",
  "business process modelling", "process improvement", "process optimization", "process optimisation",
  "process redesign", "process re-engineering", "process automation", "gap analysis", "root cause analysis",
  "current state", "future state", "BPMN", "use cases", "documentation", "UAT", "user acceptance testing",
  "test cases", "testing", "data analysis", "data mapping", "data migration", "reporting", "dashboards",
  "KPI", "KPIs", "scorecard", "stakeholder management", "stakeholder engagement", "stakeholders",
  "workshops", "facilitation", "change management", "change delivery", "change projects",
  "project management", "program management", "programme management", "PMO", "portfolio management",
  "governance", "project governance", "RAID", "dependency management", "roadmap", "implementation",
  "go-live", "hypercare", "agile", "scrum", "waterfall", "kanban",
  // tools
  "JIRA", "Confluence", "Visio", "Excel", "PowerPoint", "MS Office", "SQL", "Python", "VBA",
  "Power BI", "Tableau", "Power Automate", "RPA", "n8n", "ERP", "Workday", "Workday Financials",
  "Workday Adaptive", "SAP", "Oracle", "Salesforce", "integrations", "APIs",
  // finance and operations
  "automation", "intelligent automation", "workflow automation", "payments", "ACH", "NACHA",
  "reconciliation", "reconciliations", "general ledger", "accounting", "financial accounting",
  "month-end close", "financial reporting", "financial analysis", "financial modeling", "financial modelling",
  "forecasting", "budgeting", "FP&A", "cost reduction", "cost savings", "procurement", "sourcing",
  "shared services", "operational efficiency",
  // strategy
  "business case", "ROI", "market entry", "market sizing", "growth strategy", "strategy",
  "corporate strategy", "commercial strategy", "go-to-market", "due diligence", "M&A",
  "operating model", "target operating model", "TOM", "operating model design", "organizational design",
  "organisational design", "org design", "transformation", "business transformation",
  "digital transformation", "finance transformation", "operations transformation", "technology strategy",
  "digital strategy", "IT strategy", "enterprise architecture", "cloud", "AI", "generative AI",
  "machine learning", "analytics", "data analytics", "business intelligence", "prioritization",
  "prioritisation", "benchmarking", "Lean", "lean six sigma", "six sigma", "design thinking",
  "continuous improvement", "problem solving", "structured problem solving", "presentations",
  "consulting", "management consulting", "strategy consulting", "cross-functional",
  // industry
  "banking", "wholesale banking", "corporate banking", "commercial banking", "retail banking",
  "investment banking", "capital markets", "financial services", "insurance", "treasury", "trade finance",
  "cash management", "lending", "credit", "credit risk", "liquidity", "ALM", "regulatory", "compliance",
  "Basel", "IFRS", "KYC", "AML", "risk management", "operational risk",
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CASED = new Set(["Workday", "Workday Financials", "Workday Adaptive", "Excel", "Oracle", "SAP", "Lean",
  "RAID", "TOM", "AI", "ACH", "ALM", "AML", "KYC", "ROI", "M&A"]);
// Whitespace and hyphens are interchangeable inside a phrase; a trailing plural
// "s" is allowed (ATS search does light stemming for plurals and nothing more).
const MATCHERS = VOCAB.map((t) => {
  const body = t.split(/[\s-]+/).map(esc).join("[\\s-]+");
  const plural = /[a-z]$/i.test(t) && !/s$/i.test(t) ? "(?:s|es)?" : "";
  return { term: t, re: new RegExp(`(?<![\\w&])${body}${plural}(?![\\w&])`, CASED.has(t) ? "g" : "gi") };
});

const shouting = (f) => f.length > 4 && f === f.toUpperCase();

// Every vocabulary term in the text, longest first, with overlaps removed so
// "business process modeling" is not also counted as "process modeling".
export function findTerms(text) {
  const body = String(text || "");
  const hits = [];
  for (const { term, re } of MATCHERS) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) hits.push({ term, form: m[0], start: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const taken = [];
  const out = new Map();
  for (const h of hits) {
    if (taken.some(([s, e]) => h.start < e && s < h.end)) continue;
    taken.push([h.start, h.end]);
    const form = h.form.replace(/\s+/g, " ");
    const prev = out.get(h.term);
    if (!prev) out.set(h.term, { term: h.term, form, count: 1, first: h.start });
    else {
      prev.count++;
      // A heading in capitals is not how the posting spells the term in a sentence.
      if (shouting(prev.form) && !shouting(form)) prev.form = form;
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count || a.first - b.first);
}

// Stored at verify time, next to the other posting features. Compact on purpose.
export function postingTerms(text, max = 60) {
  return findTerms(text).slice(0, max).map((t) => [t.term, t.form, t.count]);
}

// The title as the posting states it, without pronoun or gender tags, which
// are not part of the job title a recruiter searches for.
export function headlineTitle(title) {
  return String(title || "")
    .replace(/\((?:she|he|they|m\/?[fwkd]\/?[dwxm]?|k\/?m|f\/?m\/?d|m\/?w\/?d|all genders?)[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,)])/g, "$1")
    .trim();
}

export function atsMatch(job, features) {
  const terms = features?.ats_terms;
  const headline = headlineTitle(job?.title);
  if (!Array.isArray(terms) || !terms.length) return { headline, total: 0, pending: true };
  const on = [], add = [], miss = [];
  for (const [canon, form] of terms) {
    const key = canon.toLowerCase();
    if (RESUME_TERMS.has(key)) on.push(form);
    else if (EVIDENCE_TERMS.has(key)) add.push(form);
    else miss.push(form);
  }
  return {
    headline,
    total: terms.length,
    on_resume: on,
    can_add: add,
    missing: miss,
    reachable: on.length + add.length,
    target: TARGET,
  };
}
