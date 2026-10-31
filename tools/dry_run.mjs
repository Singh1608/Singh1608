// Dry-run the nightly sweep: read every board in SOURCES with the production
// adapters and report what the refresh would see — without the cron secret,
// and without writing anything to Blob.
//
//   node tools/dry_run.mjs
//
// Run it in a sandbox in iad1, the production function's region, so the timing
// means something. The refresh must finish inside its 60-second limit, and
// this sweep is the largest part of it; link checks take up to 20 seconds more.

import { fetchAll, keep, SOURCES } from "../api/_lib.js";
import { assess } from "../api/_fit.js";

const LIMIT_MS = 60_000;
const LINK_CHECK_BUDGET_MS = 20_000;

const started = Date.now();
const results = await fetchAll();
const sweepMs = Date.now() - started;

const perBoard = results.map((r) => {
  const kept = r.jobs.filter(keep);
  return { board: r.board, platform: r.platform, jobs: r.jobs.length, kept: kept.length, usable: kept.filter((j) => assess(j).usable).length };
});

const total = (k) => perBoard.reduce((a, b) => a + b[k], 0);
const headroom = LIMIT_MS - sweepMs - LINK_CHECK_BUDGET_MS;

console.log(JSON.stringify({
  boards: Object.values(SOURCES).flat().length,
  sweep_ms: sweepMs,
  headroom_ms: headroom,
  verdict: headroom > 10_000 ? "fits" : headroom > 0 ? "tight" : "over the limit",
  roles_read: total("jobs"),
  roles_passing_filters: total("kept"),
  roles_usable: total("usable"),
  empty_boards: perBoard.filter((b) => !b.jobs).map((b) => `${b.platform}:${b.board}`),
  usable_by_employer: Object.fromEntries(perBoard.filter((b) => b.usable).sort((a, b) => b.usable - a.usable).map((b) => [b.board, b.usable])),
}, null, 1));
