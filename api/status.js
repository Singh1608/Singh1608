// What the last refresh actually did.
//
// Open this to answer "is the scheduled run working?" without needing access
// to Vercel's runtime logs. It reports the stored run log next to the stored
// feed, so a disagreement between them is visible — a feed whose updated_at is
// days older than the last run means writes are failing.
//
// Deliberately unauthenticated and read-only: it exposes counts and board
// names, nothing that is not already on the public dashboard.

import { readFeed, readRunLog } from "./_lib.js";
import { readVerify } from "./verify.js";

const STALE_AFTER_HOURS = 30; // one daily run, plus slack for a late fire

export default async function handler(req, res) {
  const [run, feed, verify] = await Promise.all([readRunLog(), readFeed(), readVerify()]);

  const now = Date.now();
  const hoursSince = (iso) =>
    iso ? Math.round(((now - Date.parse(iso)) / 3_600_000) * 10) / 10 : null;

  const feedAge = hoursSince(feed?.updated_at);
  const runAge = hoursSince(run?.finished_at);

  // Say plainly whether this is working. A caller should not have to infer it
  // from timestamps, which is the mistake that let the last failure hide.
  let verdict;
  if (!run && !feed) {
    verdict = "no run has ever completed; the feed is being served from the seed";
  } else if (!run) {
    verdict = "a feed exists but no run log — it predates run logging";
  } else if (!run.ok) {
    verdict = `last run FAILED at stage "${run.stage}": ${run.error}`;
  } else if (feedAge !== null && feedAge > STALE_AFTER_HOURS) {
    verdict = `last run reported success but the feed is ${feedAge}h old — writes are not landing`;
  } else if (run.boards_unreachable?.length) {
    verdict = `working, degraded: ${run.boards_unreachable.length} of ${run.boards_total} boards returned nothing`;
  } else {
    verdict = "working";
  }

  res.setHeader("cache-control", "public, s-maxage=30");
  res.setHeader("access-control-allow-origin", "*");
  return res.status(200).json({
    verdict,
    feed: {
      updated_at: feed?.updated_at ?? null,
      hours_old: feedAge,
      count: feed?.count ?? null,
      serving_seed: !feed,
    },
    last_run: run ?? null,
    hours_since_last_run: runAge,
    next_run: "daily at 16:00 UTC (18:00 Warsaw, 17:00 once Poland moves to CET)",
    // The dead-role check that follows the refresh. newly_closed lists the
    // roles it found closed on its last run; the daily email reads this.
    last_verify: verify?.last_run ?? null,
    hours_since_last_verify: hoursSince(verify?.last_run?.finished_at),
    verify_history: verify?.history ?? [],
    next_verify: "daily at 17:00 UTC, an hour after the refresh",
  });
}
