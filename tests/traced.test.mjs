// Guards for the boards traced from aggregator employers. Each case is a
// mistake that would have hidden real roles or let noise through.
import { excludedByTitle, SOURCES } from "../api/_lib.js";
import { classifyLink, isBoardRoot } from "../api/_fit.js";

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} -> ${got}`);
}

console.log("-- postings with short or alphanumeric ids are not board roots --");
check("workable /j/ shortcode", isBoardRoot("https://apply.workable.com/j/8F2A1C3D9E", "Business Analyst"), false);
check("recruitee /o/ slug", isBoardRoot("https://addepto.recruitee.com/o/business-analyst", "Business Analyst"), false);
check("breezy /p/ id", isBoardRoot("https://cronoseuropa.breezy.hr/p/a1b2c3d4e5f6-consultant", "Consultant"), false);
check("phenom job path", isBoardRoot("https://careers.roche.com/global/en/job/202509-123", "Consultant"), false);
console.log("-- real board roots still are --");
check("greenhouse board", isBoardRoot("https://job-boards.greenhouse.io/xebiacee", "Consultant"), true);
check("careers listing", isBoardRoot("https://example.com/company/careers", "Consultant"), true);

console.log("-- employer-domain career sites are first-party, even with 3-letter names --");
check("jobs.gft.com for GFT", classifyLink("https://jobs.gft.com/Poland/job/Warszawa-Consultant/1433938333", "GFT").ok, true);
check("jobs.gsk.com for GSK", classifyLink("https://jobs.gsk.com/gb/en/job/123456", "GSK").ok, true);
check("EU Lever host", classifyLink("https://jobs.eu.lever.co/xtb/abc-123", "XTB").ok, true);
check("aggregator still refused", classifyLink("https://www.glassdoor.com/job-listing/x", "GFT").ok, false);

console.log("-- programming-stack titles are out, banking terms are not --");
check("Expert iOS Consultant", excludedByTitle("Expert iOS Consultant"), true);
check("Java Consultant", excludedByTitle("Senior Java Consultant"), true);
check("SWIFT Payments Consultant", excludedByTitle("SWIFT Payments Consultant"), false);
check("Embedded Finance Consultant", excludedByTitle("Embedded Finance Consultant"), false);
check("Business Analyst (SQL)", excludedByTitle("Business Analyst (SQL)"), false);
check("Community Manager not 'unity'", excludedByTitle("Community Operations Analyst"), false);

console.log("-- discovered boards are merged and unique --");
const keys = Object.entries(SOURCES).flatMap(([p, bs]) => bs.map((b) => `${p}:${b.slug || b.host + "/" + (b.site || "")}`));
check("no duplicate boards", keys.length === new Set(keys).size, true);
check("Citi present", SOURCES.workday.some((b) => b.tenant === "citi"), true);
check("existing Capco untouched", SOURCES.greenhouse.filter((b) => b.slug === "capco").length, 1);

console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
process.exit(failures ? 1 : 0);
