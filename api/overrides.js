// His own corrections to the automatic role categories, shared across devices.
//
//   GET  /api/overrides                    -> { categories: { <job id>: <key> }, updated_at }
//   POST /api/overrides  { id, category }  -> the same, after the change
//        category null clears the override and the role goes back to its
//        automatic category.
//
// Stored in its own Blob object, not in the feed: the nightly refresh rewrites
// the feed, and an edit made while it runs must not be lost to that write, or
// wipe what the refresh added.
//
// Anyone can read, because the categories are no more private than the public
// feed they annotate. Writing needs PIPELINE_EDIT_KEY, which the page asks for
// once per device. That is a different secret from CRON_SECRET: this key is
// typed into browsers, and the cron secret never should be.

import { createHash, timingSafeEqual } from "node:crypto";
import { readBlob, writeBlob } from "./_lib.js";
import { CATEGORY_KEYS } from "./_category.js";

export const OVERRIDES_PATH = "pipeline/overrides.json";

// A generous ceiling that no real use reaches. It stops a leaked key from
// growing the object without bound.
const MAX_OVERRIDES = 5000;

function cors(res) {
  // Copies of the dashboard are served from other origins (see api/jobs.js).
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
}

// Compare digests, so the comparison takes the same time whatever the input
// length and a wrong key reveals nothing about the right one.
export function keyMatches(got, expected) {
  const a = createHash("sha256").update(String(got)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function unauthorized(req) {
  const expected = process.env.PIPELINE_EDIT_KEY;
  if (!expected) return { status: 503, error: "PIPELINE_EDIT_KEY is not configured" };
  const got = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!got || !keyMatches(got, expected)) return { status: 401, error: "bad or missing edit key" };
  return null;
}

async function load() {
  const stored = await readBlob(OVERRIDES_PATH);
  return {
    categories: stored?.categories && typeof stored.categories === "object" ? stored.categories : {},
    updated_at: stored?.updated_at || null,
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return null; }
}

export default async function handler(req, res) {
  cors(res);
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET" || !req.method) {
    return res.status(200).json(await load());
  }

  if (req.method !== "POST") return res.status(405).json({ error: "use GET or POST" });

  const denied = unauthorized(req);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const body = parseBody(req);
  const id = body?.id;
  const category = body?.category ?? null;
  if (typeof id !== "string" || !id || id.length > 200) {
    return res.status(400).json({ error: "id must be a non-empty string" });
  }
  if (category !== null && !CATEGORY_KEYS.has(category)) {
    return res.status(400).json({ error: `unknown category: ${String(category).slice(0, 40)}` });
  }

  const current = await load();
  const categories = { ...current.categories };
  if (category === null) delete categories[id];
  else categories[id] = category;
  if (Object.keys(categories).length > MAX_OVERRIDES) {
    return res.status(413).json({ error: "too many overrides" });
  }

  const next = { categories, updated_at: new Date().toISOString() };
  try {
    await writeBlob(OVERRIDES_PATH, next);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  return res.status(200).json(next);
}
