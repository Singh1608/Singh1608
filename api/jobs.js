// The feed the dashboard reads.
//
// Kept separate from refresh.js so the page never depends on a sweep running,
// and so a failing board can never make the page go blank.

import { readFeed } from "./_lib.js";
import { SEED } from "./_seed.js";

// How old a posting is, in the terms that matter when deciding whether it is
// worth applying. A role posted three months ago that is still open is usually
// either a pipeline advert or a stalled requisition.
function bucketOf(days) {
  if (days === null) return "unknown";
  if (days <= 7) return "this week";
  if (days <= 30) return "this month";
  if (days <= 90) return "1-3 months";
  return "over 3 months";
}

const BUCKET_ORDER = ["this week", "this month", "1-3 months", "over 3 months", "unknown"];

export default async function handler(req, res) {
  const feed = await readFeed();

  // Before the first successful sweep there is no Blob object yet. Serving the
  // seed keeps the page populated rather than showing an empty list that looks
  // like everything was lost.
  const body = feed || {
    updated_at: null,
    count: SEED.length,
    jobs: SEED,
    seeded: true,
  };

  const now = Date.now();
  const jobs = body.jobs.map((j) => {
    const stamp = j.posted_at || j.found_at || null;
    const days = stamp ? Math.floor((now - Date.parse(stamp)) / 86_400_000) : null;
    return {
      ...j,
      age_days: Number.isFinite(days) ? days : null,
      age_bucket: bucketOf(Number.isFinite(days) ? days : null),
      // A single field the page can trust: worth showing, or not.
      actionable: j.live !== false && !j.gated_out,
    };
  });

  // Freshest and best-fitting first. Dead and gated-out roles sink rather than
  // disappearing — the history is deliberate, but it should not lead.
  jobs.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    if ((b.fit_score ?? 0) !== (a.fit_score ?? 0)) return (b.fit_score ?? 0) - (a.fit_score ?? 0);
    return (a.age_days ?? 9999) - (b.age_days ?? 9999);
  });

  const byBucket = {};
  for (const b of BUCKET_ORDER) byBucket[b] = 0;
  for (const j of jobs) if (j.actionable) byBucket[j.age_bucket]++;

  res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=600");
  res.setHeader("content-type", "application/json; charset=utf-8");
  // Copies of the dashboard served from other origins fetch this same feed.
  // The data is already public, so a wildcard costs nothing and keeps those
  // copies from silently failing CORS.
  res.setHeader("access-control-allow-origin", "*");
  return res.status(200).json({
    ...body,
    jobs,
    actionable_count: jobs.filter((j) => j.actionable).length,
    by_age: byBucket,
  });
}
