// Industry penalties. Each pattern is closed by \b, so a stem or a singular
// noun silently fails to match the longer word — two penalties never fired at
// all. These cases pin the forms that were missed.
import { scoreFit } from "../api/_fit.js";

let failures = 0;
function penalised(title, want) {
  const { penalties, score } = scoreFit({ title, company: "Accenture" });
  const got = penalties.length > 0;
  if (got !== want) failures++;
  console.log(`${got === want ? "PASS" : "FAIL"}  ${want ? "penalised" : "clean    "}  s${score}  ${title}`);
}

console.log("-- the forms that slipped through --");
penalised("Strategy Consultant – Life Sciences", true);
penalised("Pharmaceutical Strategy Consultant", true);
penalised("Biotechnology Operations Consultant", true);
penalised("Medical Devices Transformation Consultant", true);
penalised("Manufacturing Transformation Consultant", true);
penalised("Management Consultant – Utilities", true);
penalised("Talent Strategy Consultant (18 months contract)", true);
penalised("People Strategy Consultant", true);
penalised("HR Transformation Consultant", true);
penalised("Total Rewards Consultant", true);

console.log("\n-- his roles stay clean --");
penalised("Strategy Consultant — Operating Model & Organizational Design", false);
penalised("Business Transformation Consultant, Warsaw", false);
penalised("(Senior) Consultant | Finance Transformation", false);
penalised("Change Management Consultant", false);
penalised("Strategy Consultant (GN) – M&A and Private Equity", false);
penalised("Business Analyst – Target Operating Model", false);

console.log("\n-- the penalty lands where it should --");
const ls = scoreFit({ title: "Strategy Consultant – Life Sciences", company: "Accenture" }).score;
const core = scoreFit({ title: "Strategy Consultant — Operating Model", company: "Accenture" }).score;
const ok = ls < core;
if (!ok) failures++;
console.log(`${ok ? "PASS" : "FAIL"}  life-sciences strategy role (s${ls}) now ranks below his core role (s${core})`);

console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
process.exit(failures ? 1 : 0);
