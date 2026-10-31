// checkLive must distinguish three outcomes: gone, open, and unknown.
// Conflating "unknown" with "gone" would delete live roles on a flaky network.
const real = globalThis.fetch;
const cases = {
  "https://job-boards.greenhouse.io/capco/jobs/111": { ok: true, status: 200, url: "https://job-boards.greenhouse.io/capco/jobs/111" },
  "https://job-boards.greenhouse.io/capco/jobs/404": { ok: false, status: 404, url: "https://job-boards.greenhouse.io/capco/jobs/404" },
  "https://job-boards.greenhouse.io/capco/jobs/302": { ok: true, status: 200, url: "https://job-boards.greenhouse.io/capco/jobs" },
  "https://timeout.test/x": "THROW",
  "https://headless.test/x": { ok: false, status: 405 },
};
globalThis.fetch = async (url, opts = {}) => {
  const c = cases[String(url)];
  if (c === "THROW") { const e = new Error("timed out"); e.name = "AbortError"; throw e; }
  if (c.status === 405 && opts.method === "HEAD") return c;
  if (c.status === 405) return { ok: true, status: 200, url: String(url) };
  return c;
};
const { checkLive } = await import("../api/_lib.js");
const expect = [
  ["https://job-boards.greenhouse.io/capco/jobs/111", true,  "open posting"],
  ["https://job-boards.greenhouse.io/capco/jobs/404", false, "404 = gone"],
  ["https://job-boards.greenhouse.io/capco/jobs/302", false, "redirected to board root = retired"],
  ["https://timeout.test/x",                          null,  "timeout = UNKNOWN, not dead"],
  ["https://headless.test/x",                         true,  "HEAD 405 falls through to GET"],
];
for (const [url, want, label] of expect) {
  const r = await checkLive(url);
  console.log(`${r.live === want ? "PASS" : "FAIL"}  live=${String(r.live).padEnd(5)} status=${String(r.status).padEnd(4)} ${label}`);
}
globalThis.fetch = real;
