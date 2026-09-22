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
import { assess, explain } from "./_fit.js";
import { SEED } from "./_seed.js";

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
  const rejected = [];
  const seenNow = new Set();
  const today = new Date().toISOString().slice(0, 10);

  // Entries stored before the gates existed carry a flat tier and boilerplate
  // rationale. Re-assess them so the feed reads as one shortlist rather than
  // two eras of it. `status` is his — a flag he set is never touched — and
  // nothing is deleted; a failure is recorded on the entry instead.
  let regraded = 0;
  let gatedOut = 0;
  for (const job of byId.values()) {
    if (job.fit_score !== undefined) continue; // already gated
    const verdict = assess(job);
    job.tier = verdict.fit.tier;
    job.fit_score = verdict.fit.score;
    job.why = explain(job, verdict.fit);
    job.link_kind = verdict.link.kind;
    if (!verdict.usable) {
      job.gated_out = verdict.problems.join("; ");
      gatedOut++;
    }
    regraded++;
  }

  for (const { platform, board, jobs } of results) {
    let matched = 0;
    for (const raw of jobs) {
      if (!raw.url || !raw.title) continue;
      if (!keep(raw)) continue;
      matched++;

      const id = jobId(raw.company, raw.url);
      seenNow.add(id);

      // Still listed today: refresh liveness without touching anything the
      // user owns. `status` holds his flag and must never be rewritten here.
      const already = byId.get(id);
      if (already) {
        already.last_seen = today;
        already.live = true;
        continue;
      }

      // Both gates, before anything enters the feed: the link must reach the
      // employer's own application system, and the role must actually suit
      // him. A near-miss is not worth a place on a shortlist.
      const verdict = assess({ ...raw, company: raw.company });
      if (!verdict.usable) {
        rejected.push({
          company: raw.company,
          title: raw.title,
          why: verdict.problems.join("; "),
        });
        continue;
      }

      const job = {
        id,
        title: raw.title,
        company: raw.company,
        url: raw.url,
        tier: verdict.fit.tier,
        fit_score: verdict.fit.score,
        why: explain(raw, verdict.fit),
        link_kind: verdict.link.kind,
        status: "new",
        found_at: today,
        last_seen: today,
        live: true,
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

  // Anything not returned by a board this run is no longer listed. It stays in
  // the feed — the history is the point, and it may carry a flag — but it is
  // marked so a dead posting cannot pass for a live one. Only entries from
  // boards that actually answered are judged, or an unreachable board would
  // mark its whole roster dead.
  const answered = new Set(
    sources.filter((s) => s.reachable).map((s) => s.board)
  );
  let wentStale = 0;
  for (const job of byId.values()) {
    if (seenNow.has(job.id)) continue;
    if (!answered.has(job.company)) continue; // board silent; verdict unknown
    if (job.live !== false) {
      job.live = false;
      job.last_seen = job.last_seen ?? job.found_at ?? null;
      wentStale++;
    }
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
    added: added.map((j) => `t${j.tier} ${j.company} — ${j.title}`),
    // Roles the gates turned away, with the reason. Without this the run looks
    // like it found nothing, when in fact it found things and refused them.
    rejected_count: rejected.length,
    rejected: rejected.slice(0, 20),
    regraded,
    gated_out: gatedOut,
    went_stale: wentStale,
    live_count: [...byId.values()].filter((j) => j.live !== false).length,
    boards_total: sources.length,
    boards_reachable: sources.length - dead.length,
    boards_unreachable: dead,
    sources,
  });
}
