// The per-company cap must keep the BEST five, not the first five it meets.
import handler from "../api/jobs.js";

const mk = (company, i, score, age) => ({
  id: `${company}-${i}`, company, title: `${company} role ${i}`,
  url: `https://job-boards.greenhouse.io/${company}/jobs/${1000 + i}`,
  fit_score: score, tier: 2, status: "new",
  posted_at: new Date(Date.now() - age * 86400000).toISOString(),
  live: true,
});

// Capco: 8 roles with ascending fit, deliberately worst-first in the array.
const jobs = [];
for (let i = 0; i < 8; i++) jobs.push(mk("Capco", i, i, 0));
jobs.push(mk("Accenture", 0, 7, 1));
jobs.push(mk("PwC", 0, 6, 2));
// one dead Capco role with a top score: must not consume a slot
jobs.push({ ...mk("Capco", 99, 9, 0), live: false });

globalThis.__feed = { updated_at: "2026-09-22T00:00:00Z", count: jobs.length, jobs };

const res = { code: 0, body: null, setHeader(){}, status(c){this.code=c;return this;}, json(b){this.body=b;return this;} };

// Stub the blob read by pre-seeding module state via fetch mock.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes("prefix=")) return { ok: true, json: async () => ({ blobs: [{ pathname: "pipeline/jobs.json", url: "https://B/pipeline/jobs.json" }] }) };
  if (url.includes("https://B/")) return { ok: true, json: async () => globalThis.__feed };
  return { ok: false, status: 404, json: async () => null };
};
process.env.BLOB_READ_WRITE_TOKEN = "t";

await handler({}, res);
const d = res.body;
const capcoShown = d.jobs.filter(j => j.actionable && j.company === "Capco");
const scores = capcoShown.map(j => j.fit_score).sort((a,b)=>b-a);

console.log(`1. cap respected      -> Capco shows ${capcoShown.length} ${capcoShown.length === 5 ? "PASS" : "FAIL"}`);
console.log(`2. keeps BEST five    -> scores ${scores.join(",")} ${JSON.stringify(scores) === JSON.stringify([7,6,5,4,3]) ? "PASS" : "FAIL"}`);
console.log(`3. other firms kept   -> Accenture+PwC ${d.jobs.filter(j=>j.actionable && j.company!=="Capco").length} ${d.jobs.filter(j=>j.actionable && j.company!=="Capco").length === 2 ? "PASS" : "FAIL"}`);
console.log(`4. dead role no slot  -> capped reasons ${d.capped_count} ${d.capped_count === 3 ? "PASS" : "FAIL"}`);
console.log(`5. by_company report  -> ${JSON.stringify(d.by_company)} ${d.by_company.Capco === 5 ? "PASS" : "FAIL"}`);
console.log(`6. best overall leads -> ${d.jobs[0].company} s${d.jobs[0].fit_score} ${d.jobs[0].fit_score === 7 ? "PASS" : "FAIL"}`);
globalThis.fetch = realFetch;
