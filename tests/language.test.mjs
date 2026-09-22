// A language requirement is a hard screen-out, and the title is the only place
// it can be detected: Workday and SmartRecruiters return no description, and
// those are the platforms Accenture and PwC roles arrive on.
//
// The case that matters most is the near-miss. "Consultant - Germany" is a
// location and must stay; "... with German" is a requirement and must go.
import { requiresOtherLanguage } from "../api/_lib.js";
import { assess } from "../api/_fit.js";

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${got ? "block" : "allow"}  ${label}`);
}

console.log("-- real PwC titles that cost him three of the top ten --");
for (const t of [
  "Risk Management Consultant with German | FS Consulting",
  "Credit Risk Management Consultant with German",
  "Senior Project Specialist with German | PMO Consulting",
  "Data Management Team Member with German | FS Consulting",
  "Market Risk& Treasury Team Member with German | FS Consulting",
  "Risk & Capital Management Team Member with German | FS Consulting",
]) check(t.slice(0, 58), requiresOtherLanguage(t), true);

console.log("\n-- other phrasings --");
for (const t of [
  "German-speaking Business Analyst",
  "Consultant (French)",
  "Fluent Dutch Consultant",
  "Business Analyst - Czech speaker",
  "Senior Consultant, native Italian",
  "Business Analyst, Polish required",
]) check(t, requiresOtherLanguage(t), true);

console.log("\n-- must NOT be blocked --");
for (const t of [
  "Consultant - Germany",                                   // a place, not a language
  "Strategy Consultant — Operating Model & Organizational Design",
  "(Senior) Consultant | Finance Transformation",
  "Business Analyst – Target Operating Model",
  "Business Transformation Consultant, Warsaw",
  "Senior Business Analyst — Cards",
]) check(t.slice(0, 58), requiresOtherLanguage(t), false);

console.log("\n-- assess() reports it and marks the role unusable --");
const URL_OK = "https://pwc.wd3.myworkdayjobs.com/Global_Experienced_Careers/job/Warszawa/X_752280WD";
const gated = assess({
  title: "Credit Risk Management Consultant with German",
  company: "PwC",
  url: URL_OK,
});
const clean = assess({
  title: "(Senior) Consultant | Finance Transformation",
  company: "PwC",
  url: URL_OK,
});

const reason = gated.problems.find((p) => /language/.test(p));
console.log(`${gated.usable === false ? "PASS" : "FAIL"}  gated role is unusable`);
console.log(`${reason ? "PASS" : "FAIL"}  reason recorded: "${reason || "(none)"}"`);
console.log(`${clean.usable === true ? "PASS" : "FAIL"}  clean PwC role still passes (t${clean.fit.tier} s${clean.fit.score})`);
if (gated.usable !== false || !reason || clean.usable !== true) failures++;

// The gated role must still score well — it is excluded for the language, not
// because the work is a poor match. Conflating the two would hide why.
console.log(`${gated.fit.score >= 6 ? "PASS" : "FAIL"}  still scores on merit (s${gated.fit.score}), excluded only on language`);
if (gated.fit.score < 6) failures++;

console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
process.exit(failures ? 1 : 0);
