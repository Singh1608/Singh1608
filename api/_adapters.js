// Adapters for the applicant tracking systems found by tracing employers back
// from the aggregators to their own careers pages (tools/trace_employers.mjs).
//
// Every adapter returns the same shape as the ones in _lib.js:
//   { title, company, url, location, description, posted_at }
// and every one returns [] rather than throwing — a board that is down, slow
// or changed shape must never take the whole refresh with it.
//
// Each was written against a live board and checked with
// tools/verify_boards.mjs before any board on that platform was added to
// SOURCES. None of them is written from documentation alone.

const TIMEOUT_MS = 8000;
const UA = "Mozilla/5.0 (compatible; poland-pipeline/1.0)";

async function request(url, { method = "GET", body, headers = {}, as = "json" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "*/*", ...headers },
    });
    if (!res.ok) return null;
    return as === "json" ? await res.json() : await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s) {
  return decodeXml(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const joinLoc = (...parts) => parts.flat().filter(Boolean).join(" | ");

// --- Recruitee ---------------------------------------------------------------
// Public, unauthenticated, and the only one here that ships the full
// description, so the Polish-fluency filter works on these roles.
export async function fromRecruitee({ name, slug }) {
  const data = await request(`https://${slug}.recruitee.com/api/offers/`);
  if (!Array.isArray(data?.offers)) return [];
  return data.offers.map((j) => ({
    title: j.title,
    company: name,
    url: j.careers_url || `https://${slug}.recruitee.com/o/${j.slug}`,
    location: joinLoc(
      j.location, j.city, j.country,
      (j.locations || []).map((l) => [l.city, l.country].filter(Boolean).join(", "))
    ),
    description: `${stripHtml(j.description)} ${stripHtml(j.requirements)}`.trim(),
    posted_at: j.published_at || j.created_at || null,
  }));
}

// --- Personio ----------------------------------------------------------------
// XML feed. Offices are split across <office> and <additionalOffices>.
export async function fromPersonio({ name, slug, tld = "de" }) {
  const xml = await request(`https://${slug}.jobs.personio.${tld}/xml?language=en`, { as: "text" });
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
    const body = m[1];
    const tag = (t) => decodeXml((body.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || "").trim();
    const id = tag("id");
    if (!id) continue;
    const offices = [...body.matchAll(/<office>([\s\S]*?)<\/office>/g)].map((x) => decodeXml(x[1]).trim());
    out.push({
      title: tag("name"),
      company: name,
      url: `https://${slug}.jobs.personio.${tld}/job/${id}?language=en`,
      location: joinLoc(offices),
      description: stripHtml(tag("jobDescriptions")),
      posted_at: tag("createdAt") || null,
    });
  }
  return out;
}

// --- Workable ----------------------------------------------------------------
// The widget endpoint is public and returns the account name with the jobs.
export async function fromWorkable({ name, slug }) {
  const data = await request(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
  if (!Array.isArray(data?.jobs)) return [];
  return data.jobs.map((j) => ({
    title: j.title,
    company: name,
    url: j.url || j.application_url || `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
    location: joinLoc(
      j.city, j.state, j.country,
      (j.locations || []).map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "))
    ),
    description: "",
    posted_at: j.published_on || j.created_at || null,
  }));
}

// --- Teamtailor --------------------------------------------------------------
// The JSON API needs a key; the career site's RSS feed does not.
export async function fromTeamtailor({ name, slug, host }) {
  const base = host ? `https://${host}` : `https://${slug}.teamtailor.com`;
  const xml = await request(`${base}/jobs.rss`, { as: "text" });
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const tag = (t) => decodeXml((body.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "").trim();
    const cities = [...body.matchAll(/<tt:city>([\s\S]*?)<\/tt:city>/g)].map((x) => decodeXml(x[1]).trim());
    const countries = [...body.matchAll(/<tt:country>([\s\S]*?)<\/tt:country>/g)].map((x) => decodeXml(x[1]).trim());
    const link = tag("link");
    if (!link) continue;
    out.push({
      title: tag("title"),
      company: name,
      url: link,
      location: joinLoc(cities, countries, tag("tt:remote-status")),
      description: stripHtml(tag("description")),
      posted_at: tag("pubDate") ? new Date(tag("pubDate")).toISOString() : null,
    });
  }
  return out;
}

// --- Traffit (Polish ATS) ----------------------------------------------------
export async function fromTraffit({ name, slug }) {
  const data = await request(`https://${slug}.traffit.com/public/job_posts/published`, {
    headers: { "x-request-page-size": "100", "x-request-current-page": "1" },
  });
  if (!Array.isArray(data)) return [];
  return data.map((j) => {
    const values = Object.fromEntries((j.advert?.values || []).map((v) => [v.field_id, v.value]));
    let geo = values.geolocation;
    if (typeof geo === "string") { try { geo = JSON.parse(geo); } catch { /* leave as text */ } }
    const where = typeof geo === "object" && geo
      ? [geo.locality, geo.region1, geo.country].filter(Boolean).join(", ")
      : String(geo || "");
    return {
      title: j.advert?.name || "",
      company: name,
      url: j.url || `https://${slug}.traffit.com/public/an/${j.id}`,
      location: joinLoc(where, j.options?.job_location, values.remote ? "remote" : ""),
      description: stripHtml(values.description || ""),
      posted_at: j.valid_start ? new Date(j.valid_start.replace(" ", "T") + "Z").toISOString() : null,
    };
  });
}

// --- BambooHR ----------------------------------------------------------------
export async function fromBambooHR({ name, slug }) {
  const data = await request(`https://${slug}.bamboohr.com/careers/list`);
  if (!Array.isArray(data?.result)) return [];
  return data.result.map((j) => ({
    title: j.jobOpeningName,
    company: name,
    url: `https://${slug}.bamboohr.com/careers/${j.id}`,
    location: joinLoc(
      j.location?.city, j.location?.state, j.location?.country,
      j.atsLocation?.city, j.atsLocation?.country, j.isRemote ? "remote" : ""
    ),
    description: "",
    posted_at: null,
  }));
}

// --- Breezy ------------------------------------------------------------------
export async function fromBreezy({ name, slug }) {
  const data = await request(`https://${slug}.breezy.hr/json`);
  if (!Array.isArray(data)) return [];
  return data.map((j) => ({
    title: j.name,
    company: name,
    url: j.url,
    location: joinLoc(j.location?.name, j.location?.city, j.location?.country?.name, j.location?.is_remote ? "remote" : ""),
    description: "",
    posted_at: j.published_date || null,
  }));
}

// --- Pinpoint ----------------------------------------------------------------
export async function fromPinpoint({ name, slug }) {
  const data = await request(`https://${slug}.pinpointhq.com/postings.json`);
  if (!Array.isArray(data?.data)) return [];
  return data.data.map((j) => ({
    title: j.title,
    company: name,
    url: j.url,
    location: joinLoc(j.location?.name, j.location?.city, j.location?.province, j.workplace_type),
    description: stripHtml(j.description || ""),
    posted_at: null,
  }));
}

// --- Eightfold ---------------------------------------------------------------
// Needs the employer's own domain as a parameter; the trace records it from the
// careers page that embeds the widget.
export async function fromEightfold({ name, slug, domain }) {
  const out = [];
  for (let start = 0; start < 300; start += 100) {
    const data = await request(
      `https://${slug}.eightfold.ai/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&location=Poland&num=100&start=${start}`
    );
    const batch = data?.positions || [];
    for (const j of batch) {
      out.push({
        title: j.name,
        company: name,
        url: j.canonicalPositionUrl || `https://${slug}.eightfold.ai/careers/job/${j.id}`,
        location: joinLoc(j.location, j.locations || []),
        description: "",
        posted_at: j.t_create ? new Date(j.t_create * 1000).toISOString() : null,
      });
    }
    if (batch.length < 100) break;
  }
  return out;
}

// --- Oracle HCM Cloud (Recruiting CE) ---------------------------------------
// Banks and large corporates use this. No description in the list call.
export async function fromOracle({ name, host, site, pages = 3 }) {
  const out = [];
  for (let page = 0; page < pages; page++) {
    const finder = `findReqs;siteNumber=${site},limit=100,offset=${page * 100},sortBy=POSTING_DATES_DESC,keyword=Poland`;
    const data = await request(
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`
    );
    const list = data?.items?.[0]?.requisitionList || [];
    for (const j of list) {
      out.push({
        title: j.Title,
        company: name,
        url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`,
        location: joinLoc(j.PrimaryLocation, j.PrimaryLocationCountry, (j.secondaryLocations || []).map((l) => l.Name)),
        description: stripHtml(j.ShortDescriptionStr || ""),
        posted_at: j.PostedDate || null,
      });
    }
    if (list.length < 100) break;
  }
  return out;
}

export const EXTRA_FETCHERS = {
  recruitee: fromRecruitee,
  personio: fromPersonio,
  workable: fromWorkable,
  teamtailor: fromTeamtailor,
  traffit: fromTraffit,
  bamboohr: fromBambooHR,
  breezy: fromBreezy,
  pinpoint: fromPinpoint,
  eightfold: fromEightfold,
  oracle: fromOracle,
};
