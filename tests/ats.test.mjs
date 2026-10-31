// The ATS keyword match: exact posting terms, exact title, his resume vocabulary.
import { findTerms, postingTerms, headlineTitle, atsMatch, VOCAB, TARGET } from "../api/_ats.js";
import { extractFeatures } from "../api/_headhunter.js";
import { RESUME_TERMS, EVIDENCE_TERMS } from "../api/_resume_terms.js";

let n = 0, failed = 0;
function check(name, ok, detail = "") {
  n++;
  if (!ok) failed++;
  console.log(`${String(n).padStart(2)}. ${name.padEnd(62)} ${ok ? "PASS" : "FAIL " + detail}`);
}

const JD = `We are looking for a Senior Business Analyst to join our Target Operating Model team.
You will run process mapping workshops with stakeholders, write user stories and support UAT.
Experience with Business Process Modeling and JIRA; stakeholder management in Wholesale Banking.
Nice to have: Avaloq, SQL, Power BI. The analyst will own the TOM design.`;
const terms = findTerms(JD);
const byTerm = Object.fromEntries(terms.map((t) => [t.term, t]));

check("vocabulary has no duplicates", new Set(VOCAB.map((v) => v.toLowerCase())).size === VOCAB.length);
check("posting spelling is kept", byTerm["target operating model"]?.form === "Target Operating Model", JSON.stringify(byTerm["target operating model"]));
check("longest phrase wins over its parts", !!byTerm["business process modeling"] && !byTerm["process modeling"], Object.keys(byTerm).join(","));
check("plural matches the singular term", !!byTerm["workshops"] && !!byTerm["user stories"]);
check("acronyms match case-sensitively", !!byTerm["TOM"] && !findTerms("tom and the team").some((t) => t.term === "TOM"));
check("'stakeholder management' counted once, not also 'stakeholders'", byTerm["stakeholder management"]?.count === 1);
check("'Jira' in a posting matches the JIRA term", findTerms("Experience with Jira").some((t) => t.term === "JIRA"));
check("ordinary words are not tool names", !findTerms("Plan your workday and excel at lean delivery").some((t) => ["Workday", "Excel", "Lean"].includes(t.term)));
check("a capitalised heading does not set the spelling", findTerms("TRANSFORMATION\nLead the transformation").find((t) => t.term === "transformation")?.form === "transformation");
check("UK and US spellings are different strings",
  findTerms("process modelling").map((t) => t.term).join() === "process modelling");
check("postingTerms is compact [term, form, count]", postingTerms(JD).every((x) => x.length === 3 && typeof x[2] === "number"));
check("extractFeatures stores the posting terms", Array.isArray(extractFeatures(JD.repeat(3)).ats_terms));

check("pronoun tag is dropped from the headline", headlineTitle("Technology Digital Strategy Consultant (She/He/They)") === "Technology Digital Strategy Consultant");
check("gender tag is dropped from the headline", headlineTitle("Business Analyst (m/f/d)") === "Business Analyst");
check("the rest of the title is kept exactly", headlineTitle("Senior Business Analyst / Project Manager (Change Projects)") === "Senior Business Analyst / Project Manager (Change Projects)");

const a = atsMatch({ title: "Senior Business Analyst" }, { ats_terms: postingTerms(JD) });
check("terms split three ways with nothing lost", a.on_resume.length + a.can_add.length + a.missing.length === a.total);
check("a term on his resume is found (JIRA)", a.on_resume.includes("JIRA"), JSON.stringify(a));
check("a supported term is offered to add (stakeholder management)", a.can_add.includes("stakeholder management"), JSON.stringify(a.can_add));
check("a term he lacks is missing (Power BI)", a.missing.includes("Power BI"), JSON.stringify(a.missing));
check("no features means pending, headline still given", atsMatch({ title: "Analyst" }, null).pending === true);
check("resume and evidence lists do not overlap", [...EVIDENCE_TERMS].every((t) => !RESUME_TERMS.has(t)));
check("every listed term is in the vocabulary", [...RESUME_TERMS, ...EVIDENCE_TERMS].every((t) => VOCAB.some((v) => v.toLowerCase() === t)));
check("target band is 25-35", TARGET[0] === 25 && TARGET[1] === 35);

console.log(failed ? `\n${failed} of ${n} FAILED` : `\nall ${n} passed`);
if (failed) process.exitCode = 1;
