// Daily dead-role check: runs after the refresh and opens every role still in
// the running for the shortlist.
//
// Triggered by its own cron entry in vercel.json, an hour after the refresh.
// On the Hobby plan a daily cron fires somewhere inside its hour, so a
// fifteen-minute gap could run this before the refresh it is meant to follow.
//
// Results go to their own Blob object, never into the feed. The refresh
// rewrites the feed, and two writers on one object would lose each other's
// changes. api/jobs.js merges the two when it serves the page.
//
// A role found closed stays closed and is not re-checked. Closure is recorded
// only on definite evidence (see _verify.js), and re-checking a closed posting
// every day would spend the time budget on roles that cannot come back.

import { readBlob, readFeed, writeBlob } from "./_lib.js";
import { verifyAll } from "./_verify.js";
import { keyMatches } from "./overrides.js";

export const VERIFY_PATH = "pipeline/verify.json";
const HISTORY = 14;

// The cron sends CRON_SECRET. He can also start a check on demand with the
// edit key the page already asks him for (see api/overrides.js), so a run
// "now" never needs the cron secret to leave Vercel. A check only reads
// public postings and rewrites its own results, so the edit key is enough.
function unauthorized(req) {
  const cron = process.env.CRON_SECRET;
  const edit = process.env.PIPELINE_EDIT_KEY;
  if (!cron && !edit) return "neither CRON_SECRET nor PIPELINE_EDIT_KEY is configured";
  const got = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!got) return "bad or missing authorization";
  if ((cron && keyMatches(got, cron)) || (edit && keyMatches(got, edit))) return null;
  return "bad or missing authorization";
}

export function readVerify() {
  return readBlob(VERIFY_PATH);
}

// Roles that are, or could become, shortlisted: open, not gated out, and not
// already found closed. Capped roles are included on purpose. They move up
// when a better role at the same employer closes, so they need to be known
// good before that happens.
export function candidates(jobs, results) {
  return jobs.filter((j) => j.url && j.live !== false && !j.gated_out && results[j.id]?.state !== "closed");
}

// Never-checked first, then the longest unchecked, then best fit. If the
// budget runs out, what was skipped goes first next time.
function priority(results) {
  return (a, b) => {
    const ca = results[a.id]?.checked_at || "";
    const cb = results[b.id]?.checked_at || "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return (b.fit_score ?? 0) - (a.fit_score ?? 0);
  };
}

export default async function handler(req, res) {
  const denied = unauthorized(req);
  if (denied) return res.status(401).json({ error: denied });

  const startedAt = new Date().toISOString();
  const today = startedAt.slice(0, 10);
  const [feed, stored] = await Promise.all([readFeed(), readVerify()]);
  if (!feed?.jobs) return res.status(503).json({ error: "no feed to verify yet" });

  const results = { ...(stored?.results || {}) };
  const todo = candidates(feed.jobs, results).sort(priority(results));
  const checked = await verifyAll(todo.map((j) => j.url), { concurrency: 8, budgetMs: 45000 });

  const newlyClosed = [];
  const tally = { open: 0, closed: 0, unknown: 0 };
  for (const job of todo) {
    const v = checked.get(job.url);
    if (!v) continue; // out of budget; first in line next run
    tally[v.state]++;
    const prev = results[job.id] || {};
    const entry = {
      state: v.state,
      method: v.method,
      reason: v.reason || null,
      checked_at: startedAt,
      // Keep the last good posting date if this check did not find one.
      posted_at: v.posted_at || prev.posted_at || null,
    };
    if (v.state === "closed") {
      entry.closed_at = startedAt;
      newlyClosed.push({ id: job.id, company: job.company, title: job.title, url: job.url, reason: v.reason });
    }
    results[job.id] = entry;
  }

  const run = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    date: today,
    candidates: todo.length,
    checked: checked.size,
    not_reached: todo.length - checked.size,
    ...tally,
    newly_closed: newlyClosed,
  };
  const out = {
    results,
    last_run: run,
    history: [run, ...(stored?.history || [])].slice(0, HISTORY).map((r) => ({
      date: r.date, checked: r.checked, closed: r.closed, unknown: r.unknown,
      newly_closed: (r.newly_closed || []).length,
    })),
  };
  try {
    await writeBlob(VERIFY_PATH, out);
  } catch (err) {
    return res.status(502).json({ ...run, error: `could not store results: ${err.message}` });
  }
  return res.status(200).json(run);
}
