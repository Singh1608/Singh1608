// Exercise refresh.js against a fake network and a fake Blob.
const API = "../api";

const store = new Map();              // pathname -> stored object
const feed = () => store.get("pipeline/jobs.json");
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  // Write is a PUT; the list endpoint shares the same host, so match on method
  // first or the list call gets mistaken for a write.
  if (opts.method === "PUT" && url.includes("blob.vercel-storage.com")) {
    const path = url.split("blob.vercel-storage.com/")[1];
    store.set(path, JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ url: "x" }) };
  }
  if (url.includes("blob.vercel-storage.com") && url.includes("prefix=")) {
    const want = decodeURIComponent(url.split("prefix=")[1].split("&")[0]);
    return { ok: true, json: async () => ({
      blobs: store.has(want)
        ? [{ pathname: want, url: `https://BLOBBASE/${want}` }]
        : [],
    })};
  }
  if (url.includes("BLOBBASE")) {
    const path = url.split("BLOBBASE/")[1];
    return store.has(path)
      ? { ok: true, json: async () => store.get(path) }
      : { ok: false, status: 404, json: async () => null };
  }
  if (url.includes("boards-api.greenhouse.io/v1/boards/capco/")) {
    return { ok: true, json: async () => ({ jobs: [
      { title: "Senior Business Analyst", location: { name: "Warsaw, Poland" },
        absolute_url: "https://job-boards.greenhouse.io/capco/jobs/999999", content: "English role" },
      { title: "Senior Manager, Delivery", location: { name: "Warsaw, Poland" },
        absolute_url: "https://job-boards.greenhouse.io/capco/jobs/999998", content: "" },
      { title: "Business Analyst", location: { name: "London, UK" },
        absolute_url: "https://job-boards.greenhouse.io/capco/jobs/999997", content: "" },
      { title: "Consultant", location: { name: "Krak\u00f3w, Poland" },
        absolute_url: "https://job-boards.greenhouse.io/capco/jobs/999996",
        content: "Fluent Polish is required for this role." },
      // Passes the role filters, but the link is an aggregator: must be refused.
      { title: "Business Transformation Consultant", location: { name: "Warsaw, Poland" },
        absolute_url: "https://www.efinancialcareers.com/jobs-Poland-12345", content: "" },
    ]})};
  }
  return { ok: false, status: 404, json: async () => null };
};

process.env.CRON_SECRET = "s3cret";
process.env.BLOB_READ_WRITE_TOKEN = "tok";

const { default: refresh } = await import(`${API}/refresh.js`);

function mkRes() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => {};
  return r;
}

// 1. auth
let res = mkRes();
await refresh({ headers: {} }, res);
console.log(`1. no auth            -> ${res.code} ${res.code === 401 ? "PASS" : "FAIL"}`);

res = mkRes();
await refresh({ headers: { authorization: "Bearer wrong" } }, res);
console.log(`2. wrong auth         -> ${res.code} ${res.code === 401 ? "PASS" : "FAIL"}`);

// 3. first run: seeds 19, adds the one good capco role, rejects the other three
const auth = { headers: { authorization: "Bearer s3cret" } };
res = mkRes();
await refresh(auth, res);
const r1 = res.body;
console.log(`3. first run          -> before=${r1.before} after=${r1.after} added=${r1.added.length} ${r1.before === 10 && r1.after === 11 && r1.added.length === 1 ? "PASS" : "FAIL"}`);
console.log(`   added: ${r1.added[0]}`);
console.log(`   role filters kept 2 of 5 capco rows: ${r1.sources.find(s=>s.board==="Capco").matched === 2 ? "PASS" : "FAIL"}`);
console.log(`   aggregator link refused: ${r1.rejected_count === 1 && /aggregator/.test(r1.rejected[0].why) ? "PASS" : "FAIL"} (${r1.rejected[0]?.why})`);
console.log(`   tier from fit score: t${r1.added[0]?.slice(1,2)} ${/^t[123] /.test(r1.added[0] || "") ? "PASS" : "FAIL"}`);

// 4. simulate the user flagging a role, then re-running
feed().jobs.find(j => j.id === "capco-444dbc9e").status = "applying";
res = mkRes();
await refresh(auth, res);
const r2 = res.body;
const flag = feed().jobs.find(j => j.id === "capco-444dbc9e").status;
console.log(`4. second run adds 0  -> added=${r2.added.length} ${r2.added.length === 0 ? "PASS" : "FAIL"}`);
console.log(`5. flag survived      -> status="${flag}" ${flag === "applying" ? "PASS" : "FAIL"}`);
console.log(`6. count stable       -> ${r2.after} ${r2.after === 11 ? "PASS" : "FAIL"}`);

// 7. a failing blob write must not report success
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (opts.method === "PUT") return { ok: false, status: 503, text: async () => "unavailable" };
  if (url.includes("prefix=")) {
    const want = decodeURIComponent(url.split("prefix=")[1].split("&")[0]);
    return { ok: true, json: async () => ({ blobs: [{ pathname: want, url: `https://BLOBBASE/${want}` }] }) };
  }
  if (url.includes("BLOBBASE")) {
    const path = url.split("BLOBBASE/")[1];
    return { ok: true, json: async () => store.get(path) ?? null };
  }
  return { ok: false, status: 404, json: async () => null };
};
res = mkRes();
await refresh(auth, res);
console.log(`7. write failure      -> ${res.code} ${res.code === 500 && !res.body.ok ? "PASS" : "FAIL"}`);

globalThis.fetch = realFetch;

// 8-10. the run must record its own outcome, including degradation.
//
// Note test 7 took Blob down entirely, so the run log could not be written
// either — the code reports that via run_log_error rather than pretending the
// run succeeded. The stored log therefore still holds run 2, which is correct:
// an outage must not erase the record of the last real run.
console.log(`8. outage reported    -> code=${res.code} ok=${res.body.ok} log_err=${res.body.run_log_error ? "set" : "unset"} ${res.code === 500 && res.body.ok === false && res.body.run_log_error ? "PASS" : "FAIL"}`);

const log = store.get("pipeline/last-run.json");
console.log(`9. last good run kept -> ok=${log?.ok} stage=${log?.stage} ${log?.ok === true && log?.stage === "complete" ? "PASS" : "FAIL"}`);

// Only capco answers in this fixture, so every other board is unreachable —
// exactly the silent degradation the log exists to surface.
const named = Array.isArray(log?.boards_unreachable) && log.boards_unreachable.length > 0;
console.log(`10. names dead boards -> ${log?.boards_unreachable?.length ?? 0} of ${log?.boards_total ?? "?"} ${named ? "PASS" : "FAIL"}`);
