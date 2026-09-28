// The Head Hunter score: four parts out of 100 and the two rules behind them.
import { readFileSync } from "node:fs";
import { scoreRole, extractFeatures, BANDS, bandOf, SKILLS, WEIGHTS, languagesRequired } from "../api/_headhunter.js";
import { plainText } from "../api/_verify.js";

let n = 0, failed = 0;
function check(name, ok, detail = "") {
  n++;
  if (!ok) failed++;
  console.log(`${String(n).padStart(2)}. ${name.padEnd(62)} ${ok ? "PASS" : "FAIL " + detail}`);
}

const STRONG = `
About the role
Join our Financial Services strategy and transformation team in Warsaw, serving banks and insurers.
You will design target operating models, lead process redesign and run the PMO for large transformation
programmes, build business cases and financial models, and work with senior stakeholders.
Requirements
- 3-5 years of experience in management consulting or banking transformation
- Strong Excel and PowerPoint; experience with ERP (Workday or similar) is a plus
- Reporting and KPI design, data analysis
We offer a hybrid model (2 days a week in the office) and a salary of 18 000 - 24 000 PLN gross per month.
`.repeat(1);

// 1. Weights add up.
check("weights total 100", Object.values(WEIGHTS).reduce((a, b) => a + b, 0) === 100);

// 2. A near-perfect posting scores high on every part.
const strong = scoreRole(
  { title: "Senior Consultant, Strategy & Transformation", company: "Capco", location: "Warsaw, Poland" },
  extractFeatures(STRONG),
);
check("strong posting scores 70+", strong.total >= 70, JSON.stringify(strong));
check("strong posting is scored from the posting", strong.basis === "posting");
check("salary stated gets full salary marks", strong.parts.practical.score === 15, strong.parts.practical.note);
check("years 3-5 read as min 3", extractFeatures(STRONG).years?.min === 3, JSON.stringify(extractFeatures(STRONG).years));
check("hybrid work mode detected", extractFeatures(STRONG).mode === "hybrid");
check("FS employer gets top industry marks", strong.parts.domain.score === 20, strong.parts.domain.note);

// 3. Rule one: a tool only listed on the CV or learned on a course scores zero.
const toolsOnly = "We need Python, SQL, Agile, JIRA, Lean Six Sigma and design thinking skills. ".repeat(8);
const tools = scoreRole({ title: "Consultant", company: "Acme", location: "Warsaw" }, extractFeatures(toolsOnly));
check("course/listed-only tools score zero on skills", tools.parts.skills.score === 0, JSON.stringify(tools.parts.skills));
check("listed-only tools are reported as such", tools.parts.skills.listed_only.includes("Python"));
const sap = scoreRole({ title: "Consultant", company: "Acme", location: "Warsaw" },
  extractFeatures("SAP S/4HANA, Power BI, regulatory reporting under Basel. ".repeat(10)));
check("skills he lacks are reported missing", sap.parts.skills.missing.includes("SAP"));

// 4. Rule two: hidden is low, never guessed.
const hidden = scoreRole({ title: "Business Analyst", company: "Acme", location: "" },
  extractFeatures("We are a great company with a great culture and you will do great work here. ".repeat(10)));
check("hidden salary scores zero", !hidden.parts.practical.note.includes("salary stated") && hidden.parts.practical.score <= 3,
  hidden.parts.practical.note);
check("hidden seniority is capped low", hidden.parts.seniority.score <= 20, hidden.parts.seniority.note);
const noLevel = scoreRole({ title: "Transformation Office", company: "Acme", location: "Warsaw" },
  extractFeatures("Help us run things. ".repeat(40)));
check("no level and no years scores 7", noLevel.parts.seniority.score === 7, noLevel.parts.seniority.note);
check("'competitive salary' does not count as stated",
  !extractFeatures("We offer a competitive salary and benefits. ".repeat(20)).salary);

// 5. Seniority keeps him out of roles he'd be rejected from.
const senior = scoreRole({ title: "Senior Manager, Strategy", company: "Acme", location: "Warsaw" },
  extractFeatures("Minimum 10 years of experience in consulting. ".repeat(20)));
check("senior manager with 10 years scores <= 3", senior.parts.seniority.score <= 3, senior.parts.seniority.note);
const intern = scoreRole({ title: "Strategy Intern", company: "Acme", location: "Warsaw" }, null);
check("intern title scores low", intern.parts.seniority.score <= 4);
const pm = scoreRole({ title: "Project Manager", company: "Acme", location: "Warsaw" },
  extractFeatures("4+ years of experience managing projects. ".repeat(20)));
check("'Project Manager' is a role name, not a level", pm.parts.seniority.score >= 20, pm.parts.seniority.note);

// 6. Domain: the same title in the wrong industry is not the same job.
const pharma = scoreRole({ title: "Strategy Consultant — Life Sciences", company: "Accenture", location: "Warsaw" }, null);
const bank = scoreRole({ title: "Strategy Consultant — Banking", company: "Accenture", location: "Warsaw" }, null);
check("life sciences title scores low on domain", pharma.parts.domain.score <= 8, pharma.parts.domain.note);
check("banking title beats life sciences on domain", bank.parts.domain.score > pharma.parts.domain.score + 8);

// 7. Practical: Warsaw in any mode is full location marks.
const krakow = scoreRole({ title: "Consultant", company: "Acme", location: "Kraków, Poland" }, null);
const warsaw = scoreRole({ title: "Consultant", company: "Acme", location: "Warszawa, Poland" }, null);
check("Warsaw beats Kraków on location", warsaw.parts.practical.score - krakow.parts.practical.score === 5);
const remote = scoreRole({ title: "Consultant", company: "Acme", location: "Remote, Poland" },
  extractFeatures("Fully remote role. ".repeat(40), {}));
check("remote in Poland counts as Warsaw", remote.parts.practical.note.startsWith("remote in Poland"), remote.parts.practical.note);

const wd = scoreRole({ title: "Strategy Consultant", company: "Accenture", location: "",
  url: "https://accenture.wd103.myworkdayjobs.com/AccentureCareers/job/Warsaw/Strategy-Consultant_R001" }, null);
check("city in a Workday URL counts as the location", wd.parts.practical.note.startsWith("Warsaw"), wd.parts.practical.note);

// 8. Without the posting text, the title alone scores low on skills.
const titleOnly = scoreRole({ title: "Business Transformation Consultant", company: "EY", location: "Warsaw" }, null);
check("title-only scoring is marked as such", titleOnly.basis === "title only");
check("title-only skills are scaled down", titleOnly.parts.skills.score <= 14, JSON.stringify(titleOnly.parts.skills));

// 8b. Calibration found on the live feed.
const avaloq = scoreRole({ title: "Business Analyst - Avaloq", company: "Capco", location: "Warsaw" },
  extractFeatures("Implement Avaloq core banking for private banks. Business process analysis, requirements, testing, stakeholders. ".repeat(6)));
check("a platform he never used counts as missing", avaloq.parts.skills.missing.some((m) => /Avaloq/.test(m)), JSON.stringify(avaloq.parts.skills));
const generic = scoreRole({ title: "Consultant", company: "Acme", location: "Warsaw" },
  extractFeatures("Stakeholder management, reporting, Excel, PowerPoint presentations and data analysis. ".repeat(8)));
check("generic asks (stakeholders, Excel, reporting) are not credited", generic.parts.skills.score === 0, JSON.stringify(generic.parts.skills));
const ops = scoreRole({ title: "Depositary Operations Specialist, Senior Associate", company: "State Street", location: "Kraków" },
  extractFeatures("Depositary oversight, NAV checks, fund accounting and reconciliations. Strategy. ".repeat(8)));
check("an operations-run role gets no function credit", ops.parts.domain.score === 14, ops.parts.domain.note + " " + ops.parts.domain.score);
check("securities operations counts as missing", ops.parts.skills.missing.some((m) => /securities operations/.test(m)));
const opsX = scoreRole({ title: "Operations Transformation Expert", company: "Acme", location: "Warsaw" }, null);
check("a transformation title outranks the 'expert' ops rule", opsX.parts.domain.score >= 6 + 5, String(opsX.parts.domain.score));

// 8c. Language requirements read from the posting (wording from the live feed).
const REQ = [
  "3–6 years of professional experience.\nFluent Polish and strong English\nStrong structured problem-solving skills",
  "Professional working proficiency in Polish and English at C1 level or above",
  "Excellent English and Polish communication skills (written & spoken) required",
  "Fluent English and Polish, with readiness to travel between our offices in Poland",
  "Fluency in written and spoken Polish and English",
  "Znajomość języka polskiego w stopniu biegłym",
];
const SOFTS = [
  "Fluency in English , any other languages (German, French, Spanish, Italian, Nordics) would be an asset",
  "German and other European languages are highly valued",
  "Polish language classes for foreign employees",
  "Polish language skills preferred.",
  "At least basic understanding of the Polish insurance market, including relevant market trends",
  "Additional European language skills such as Italian, French, Spanish, or German",
  "Strong communicator with fluency in English.",
  "A strong understanding of Polish accounting and tax regulations",
];
check("every real 'Polish required' wording is caught", REQ.every((t) => languagesRequired(t).includes("Polish")),
  JSON.stringify(REQ.map((t) => languagesRequired(t))));
check("soft or adjectival language mentions are not", SOFTS.every((t) => languagesRequired(t).length === 0),
  JSON.stringify(SOFTS.map((t) => languagesRequired(t))));
const pl = scoreRole({ title: "Management Consultant", company: "Adaptovate", location: "Warsaw" },
  extractFeatures("Fluent Polish and strong English. ".repeat(20)));
check("a required language excludes the role", pl.excluded === "posting requires Polish", String(pl.excluded));

// 9. Bands.
check("bands cover 0-100 in order", bandOf(100) === "strong" && bandOf(0) === "long" && bandOf(BANDS[1].min) === BANDS[1].key);

// 10. Every skill has a known evidence kind.
check("skill evidence kinds are valid", SKILLS.every((s) => ["production", "listed", "none"].includes(s.evidence)));

// 11. Posting text extraction.
check("Greenhouse's escaped HTML becomes text",
  plainText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Excel&lt;/li&gt;&lt;/ul&gt;") === "Hello & welcome\nExcel");
check("meta salary counts even without an amount in the text",
  extractFeatures("A role. ".repeat(60), { salary: true }).salary === true);

// 12. The page's bands match the module's.
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const pub = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const m = page.match(/var BANDS = (\[[\s\S]*?\]);/);
let pageBands = null;
try { pageBands = m && Function(`return ${m[1]}`)(); } catch { pageBands = null; }
check("index.html BANDS match api/_headhunter.js",
  !!pageBands && JSON.stringify(pageBands.map((b) => [b.key, b.min, b.label])) === JSON.stringify(BANDS.map((b) => [b.key, b.min, b.label])),
  JSON.stringify(pageBands));
check("public/index.html is identical to index.html", page === pub);

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
if (failed) process.exitCode = 1;
