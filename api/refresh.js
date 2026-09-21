// Scheduled refresh: sweep the ATS boards, append anything new to the feed.
//
// Triggered by the cron entry in vercel.json. Append-only by design — a role
// that disappears from a job board stays in the feed, because the page's "All"
// tab is meant to be the complete history and because a stored role may carry
// a flag the user set.

import { fetchAll, jobId, keep, readFeed, writeFeed } from "./_lib.js";
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

export default async function handler(req, res) {
  const denied = unauthorized(req);
  if (denied) {
    return res.status(401).json({ error: denied });
  }

  const startedAt = new Date().toISOString();

  // Fall back to the seed only when no feed exists yet. Once written, Blob is
  // authoritative: re-seeding over a real feed would drop every role the
  // sweep had added and every flag attached to them.
  const existing = (await readFeed()) || { jobs: SEED };
  const byId = new Map(existing.jobs.map((j) => [j.id, j]));
  const before = byId.size;

  let results;
  try {
    results = await fetchAll();
  } catch (err) {
    return res.status(502).json({ error: `ATS sweep failed: ${err.message}` });
  }

  const perSource = [];
  const added = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const { platform, board, jobs } of results) {
    let kept = 0;
    for (const raw of jobs) {
      if (!raw.url || !raw.title) continue;
      if (!keep(raw)) continue;
      kept++;
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
    perSource.push({ platform, board, fetched: jobs.length, matched: kept });
  }

  const feed = {
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    count: byId.size,
    jobs: [...byId.values()],
  };

  try {
    await writeFeed(feed);
  } catch (err) {
    // Report the failure rather than letting a cron run look successful.
    // A silent non-write is exactly how the previous pipeline went unnoticed
    // for four days.
    return res.status(500).json({
      error: err.message,
      would_have_added: added.length,
      started_at: startedAt,
    });
  }

  return res.status(200).json({
    ok: true,
    started_at: startedAt,
    updated_at: feed.updated_at,
    before,
    after: feed.count,
    added: added.map((j) => `${j.company} — ${j.title}`),
    sources: perSource,
  });
}
