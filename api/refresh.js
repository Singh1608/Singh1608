// Scheduled refresh: sweep the ATS boards, append anything new to the feed.
//
// Triggered by the cron entry in vercel.json. Append-only by design — a role
// that disappears from a job board stays in the feed, because the page's "All"
// tab is meant to be the complete history and because a stored role may carry
// a flag the user set.
//
// Every run writes a log of itself to Blob, readable at /api/status. That is
// not decoration: Vercel Cron discards this function's HTTP response, so
// without a stored log a run where every board timed out is indistinguishable
// from a healthy one. The previous incarnation of this pipeline failed silently
// for four days for exactly that reason.

import { fetchAll, jobId, keep, readFeed, writeFeed, writeRunLog } from "./_lib.js";
import { SEED } from "./_seed.js";

// Roles found by the ATS sweep get tier 2. Tier 1 means "maps almost
// one-to-one onto his experience", which is a judgement this endpoint is not
// in a position to make — it matches keywords, it does not read a posting.
// Claiming tier 1 here would put unearned confidence in front of him.
const SWEEP_TIER = 2;

function unauthorized(req) {
  const expected = process.env.CRON_SECRET;
  // With no secret configured the endpoint would be an open trigger for
  // anyone who guessed the path. Refuse rather than run unprotected.
  if (!expected) return "CRON_SECRET is not configured";
  const got = req.headers.authorization || "";
  return got === `Bearer ${expected}` ? null : "bad or missing authorization";
}

// Persist the outcome, then answer. A failure to store the log must not mask
// the run's real result, so it is reported rather than thrown.
async function finish(res, status, run) {
  try {
    await writeRunLog(run);
  } catch (err) {
    run.run_log_error = err.message;
  }
  return res.status(status).json(run);
}

export default async function handler(req, res) {
  const denied = unauthorized(req);
  if (denied) {
    // Not logged: an unauthorized caller must not be able to overwrite the
    // record of the last real run.
    return res.status(401).json({ error: denied });
  }

  const startedAt = new Date().toISOString();

  // Fall back to the seed only when no feed exists yet. Once written, Blob is
  // authoritative: re-seeding over a real feed would drop every role the
  // sweep had added and every flag attached to them.
  const stored = await readFeed();
  const existing = stored || { jobs: SEED };
  const byId = new Map(existing.jobs.map((j) => [j.id, j]));
  const before = byId.size;

  let results;
  try {
    results = await fetchAll();
  } catch (err) {
    return finish(res, 502, {
      ok: false,
      stage: "ats_sweep",
      error: err.message,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  }

  const sources = [];
  const added = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const { platform, board, jobs } of results) {
    let matched = 0;
    for (const raw of jobs) {
      if (!raw.url || !raw.title) continue;
      if (!keep(raw)) continue;
      matched++;
      const id = jobId(raw.company, raw.url);
      if (byId.has(id)) continue; // already stored, including its flag
      const job = {
        id,
        title: raw.title,
        company: raw.company,
        url: raw.url,
        tier: SWEEP_TIER,
        why: `Matched on title and Poland location from ${board}'s ${platform} board.`,
        status: "new",
        found_at: today,
      };
      byId.set(id, job);
      added.push(job);
    }
    sources.push({
      platform,
      board,
      fetched: jobs.length,
      matched,
      // A board that returns nothing at all is either a wrong slug or a dead
      // endpoint. Either way it is doing no work and should be visible as
      // such, rather than averaging into a plausible-looking total.
      reachable: jobs.length > 0,
    });
  }

  const dead = sources.filter((s) => !s.reachable).map((s) => s.board);

  const feed = {
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    count: byId.size,
    jobs: [...byId.values()],
  };

  try {
    await writeFeed(feed);
  } catch (err) {
    return finish(res, 500, {
      ok: false,
      stage: "feed_write",
      error: err.message,
      would_have_added: added.length,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      sources,
    });
  }

  return finish(res, 200, {
    ok: true,
    stage: "complete",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    updated_at: feed.updated_at,
    seeded_from_scratch: !stored,
    before,
    after: feed.count,
    added: added.map((j) => `${j.company} — ${j.title}`),
    boards_total: sources.length,
    boards_reachable: sources.length - dead.length,
    boards_unreachable: dead,
    sources,
  });
}
