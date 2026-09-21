// The feed the dashboard reads.
//
// Kept separate from refresh.js so the page never depends on a sweep running,
// and so a failing board can never make the page go blank.

import { readFeed } from "./_lib.js";
import { SEED } from "./_seed.js";

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

  // Short shared cache: the data changes twice a day, so re-reading Blob on
  // every page load is waste, but a stale-for-a-minute feed is harmless.
  res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=600");
  res.setHeader("content-type", "application/json; charset=utf-8");
  // Copies of the dashboard served from other origins fetch this same feed.
  // The data is already public, so a wildcard costs nothing and keeps those
  // copies from silently failing CORS.
  res.setHeader("access-control-allow-origin", "*");
  return res.status(200).json(body);
}
