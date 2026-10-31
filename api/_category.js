// What kind of role a posting is, read from its title.
//
// Separate from fit (_fit.js): fit says how well a role matches his
// background, the category says what the work is. The dashboard filters on
// both, and he can override any category from the page (api/overrides.js).
//
// A title often names both a role and a domain ("Business Analyst - Market
// Risk"). The rules below run in a fixed order, and the first match wins. The
// order is the product decision:
//   1. PMO and project roles are PMO work whatever the domain.
//   2. Deal work is next.
//   3. Explicitly technology-led strategy or transformation ("AI
//      Transformation", "Technology Strategy") or built on a named CRM
//      product counts as tech.
//   4. Then the functional specialisms: risk, then finance.
//   5. Then strategy and transformation.
//   6. Then data/tech.
//   7. Plain business analysis is the fallback before "other".
// Where the order guesses wrong, the override on the page corrects it.

export const CATEGORIES = [
  { key: "strategy",       label: "Strategy & Consulting" },
  { key: "transformation", label: "Transformation & Ops" },
  { key: "finance",        label: "Finance & Markets" },
  { key: "risk",           label: "Risk & Regulatory" },
  { key: "deals",          label: "M&A & Deals" },
  { key: "ba",             label: "Business Analysis" },
  { key: "pmo",            label: "Project & PMO" },
  { key: "tech",           label: "Data, AI & Tech" },
  { key: "other",          label: "Other" },
];

export const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

const RULES = [
  ["pmo", /\b(pmo|project manager|project management|programme manager|program manager|project lead|scrum master|agile coach)\b/i],
  ["deals", /(\bm&a\b|\bmergers?\b|\bacquisitions?\b|\bdeals?\b|\btransactions? (advisory|services)\b|\bdue diligence\b|\bcorporate finance\b)/i],
  ["tech", /(\b(ai|digital|technology|tech|it|data) (transformation|strategy)\b|\b(crm|dynamics 365|salesforce)\b)/i],
  ["risk", /\b(risk|regulatory|regulation|compliance|financial crime|aml|kyc|tprm|sanctions|fraud)\b/i],
  // "Financial Services" and "Financial Crime" name an industry or a risk
  // domain, not finance work.
  // Markets and fund-operations roles (State Street, capital markets
  // consulting) sit here too: the work is finance, whatever the job family.
  ["finance", /\b(finance|financial(?! (services|crime|institutions?))|cfo|fp&a|controlling|controllership|controller|accounting|accountant|product control|valuations?|treasury|tax|audit|capital markets|investments?|portfolio|middle office|back office|nav|funds?|cash services|corporate actions|shareholder services|custody|asset management)\b/i],
  ["strategy", /(\bstrateg(y|ic|ist)|strategy&|\bmanagement consult(ant|ing)\b|\bbusiness consult(ant|ing)\b|\bchief of staff\b)/i],
  ["transformation", /\b(transformation|reinvention|operating model|tom|organi[sz]ational design|org design|change management|operations|operational|coo|process (improvement|excellence)|continuous improvement|lean|six sigma|reorgani[sz]ation|procurement|customer (service|services|support|experience))\b/i],
  ["tech", /(\.net\b|\b(data|database|analytics|reporting|ai|artificial intelligence|machine learning|ml|technology|technical|digital|industry x|it|itx|erp|sap|workday|oracle|salesforce|eloqua|crm|dynamics|pim|plm|eam|iot|cloud|iam|cyber|security|engineer|developer|architect|architecture|hadoop|gcp|aws|azure|automation|integration|implementation|solutions?|applications?|platforms?|test|testing|release|linux|python|java)\b)/i],
  ["ba", /\b(business analyst|business analysis|ba)\b/i],
];

export function categorize(title) {
  const t = String(title || "");
  for (const [key, re] of RULES) if (re.test(t)) return key;
  return "other";
}
