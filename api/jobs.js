// The feed the dashboard reads.
//
// Kept separate from refresh.js so the page never depends on a sweep running,
// and so a failing board can never make the page go blank.

import { readBlob, readFeed } from "./_lib.js";
import { categorize } from "./_category.js";
import { scoreRole } from "./_headhunter.js";
import { atsMatch } from "./_ats.js";
import { readVerify } from "./verify.js";
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

// A role still open but first posted this long ago is flagged on the page. It
// stays on the shortlist, because old is not the same as closed.
const OLD_AFTER_DAYS = 30;

// Why the refresh marked a role dead, in words, for the page's Closed tag.
function refreshReason(j) {
  if (j.http_status === 404 || j.http_status === 410) return `link returns HTTP ${j.http_status}`;
  if (j.redirected_to) return "link now redirects to the careers home page";
  return "no longer listed on the employer's job board";
}

// No employer may occupy more than this many slots on the shortlist.
const MAX_PER_COMPANY = 5;

const BUCKET_ORDER = ["this week", "this month", "1-3 months", "over 3 months", "unknown"];

// Deep Head Hunter results, written by the 7:00 Dubai run through
// api/headhunt.js. Kept apart from the feed for the same reason as the
// daily check's results: one writer per Blob object.
export const HEADHUNT_PATH = "pipeline/headhunt.json";

// The feed as the page sees it: every role scored, capped and sorted. Shared
// with api/headhunt.js so the morning run ranks roles exactly as the page does.
export async function feedView() {
  const [feed, verify, deepStore] = await Promise.all([readFeed(), readVerify(), readBlob(HEADHUNT_PATH)]);
  const checks = verify?.results || {};
  const deep = deepStore?.results || {};

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
    const check = checks[j.id];
    // The daily check reads the posting date from the platform itself, which
    // beats the refresh's copy (Workday only gives "Posted 30+ Days Ago").
    const posted = check?.posted_at || j.posted_at || null;
    const stamp = posted || j.found_at || null;
    const days = stamp ? Math.floor((now - Date.parse(stamp)) / 86_400_000) : null;
    // Closed on either count: the daily check found a closure notice, or the
    // refresh found the link dead. Both are kept, never deleted.
    const closed = check?.state === "closed"
      ? { reason: check.reason, since: (check.closed_at || check.checked_at || "").slice(0, 10), by: "daily check" }
      : j.live === false
        ? { reason: refreshReason(j), since: j.checked_at || j.last_seen || null, by: "refresh" }
        : null;
    // Head Hunter score out of 100. Scored from the posting text the daily
    // check stored, or from the title alone until the first check has run.
    const hh = scoreRole(j, check?.features || null);
    return {
      ...j,
      score: hh.total,
      band: hh.band,
      score_basis: hh.basis,
      score_parts: hh.parts,
      excluded: hh.excluded,
      // Exact-title headline and the posting's keywords against his resume.
      ats: atsMatch(j, check?.features || null),
      // The morning head-hunt's reading of the full posting, when it has run.
      deep: deep[j.id] || null,
      posted_at: posted,
      age_days: Number.isFinite(days) ? days : null,
      age_bucket: bucketOf(Number.isFinite(days) ? days : null),
      // Only a real posting date counts. found_at is when WE first saw the
      // role, which says nothing about how old the posting is.
      old_posting: !closed && !!posted && Number.isFinite(days) && days >= OLD_AFTER_DAYS,
      closed,
      verified_at: check?.checked_at || null,
      // Derived on every read rather than stored, so a change to the rules
      // reaches every stored role at once. His overrides are applied by the
      // page, from api/overrides.js.
      category: categorize(j.title),
      // A single field the page can trust: worth showing, or not.
      actionable: !closed && !j.gated_out && !hh.excluded,
    };
  });

  // Best Head Hunter score first, then the title-based fit score as a
  // tie-break, then freshest. Dead and gated-out roles sink rather than
  // disappearing — the history is deliberate, but it should not lead.
  const byMerit = (a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.fit_score ?? 0) !== (a.fit_score ?? 0)) return (b.fit_score ?? 0) - (a.fit_score ?? 0);
    return (a.age_days ?? 9999) - (b.age_days ?? 9999);
  };

  // One employer must not own the shortlist. Capco alone matched nineteen
  // roles, which buries every other company however well they fit — and a
  // reader scanning the top of the list learns nothing from the fifth
  // near-identical Business Analyst posting.
  //
  // Applied here rather than at storage on purpose: the feed keeps everything,
  // the cap is a view over it, and a role held back today surfaces on its own
  // if a better one at that employer closes.
  const perCompany = new Map();
  for (const job of [...jobs].filter((j) => j.actionable).sort(byMerit)) {
    const seen = perCompany.get(job.company) ?? 0;
    if (seen >= MAX_PER_COMPANY) {
      job.actionable = false;
      job.capped = `beyond the top ${MAX_PER_COMPANY} at ${job.company} on fit`;
    } else {
      perCompany.set(job.company, seen + 1);
    }
  }

  jobs.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    return byMerit(a, b);
  });

  const byBucket = {};
  for (const b of BUCKET_ORDER) byBucket[b] = 0;
  for (const j of jobs) if (j.actionable) byBucket[j.age_bucket]++;

  return {
    ...body,
    jobs,
    actionable_count: jobs.filter((j) => j.actionable).length,
    closed_count: jobs.filter((j) => j.closed).length,
    old_after_days: OLD_AFTER_DAYS,
    last_verified: verify?.last_run
      ? { at: verify.last_run.finished_at, checked: verify.last_run.checked, newly_closed: verify.last_run.newly_closed.length }
      : null,
    capped_count: jobs.filter((j) => j.capped).length,
    scored_from_posting: jobs.filter((j) => j.score_basis === "posting").length,
    max_per_company: MAX_PER_COMPANY,
    by_company: Object.fromEntries(
      [...perCompany.entries()].sort((a, b) => b[1] - a[1])
    ),
    by_age: byBucket,
    last_headhunt: deepStore?.last_run || null,
  };
}

export default async function handler(req, res) {
  const view = await feedView();
  res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=600");
  res.setHeader("content-type", "application/json; charset=utf-8");
  // Copies of the dashboard served from other origins fetch this same feed.
  // The data is already public, so a wildcard costs nothing and keeps those
  // copies from silently failing CORS.
  res.setHeader("access-control-allow-origin", "*");
  return res.status(200).json(view);
}
