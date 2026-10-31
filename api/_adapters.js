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

// --- Phenom ------------------------------------------------------------------
// Career sites on the employer's own domain (careers.roche.com, jobs.gsk.com)
// expose the same search widget the page itself calls. Filtered to Poland
// server-side. `base` is the site root with its locale path, e.g.
// "https://careers.roche.com/global/en"; job pages live under it.
export async function fromPhenom({ name, host, base, lang = "en_global", site = "global" }) {
  const out = [];
  for (let from = 0; from < 600; from += 100) {
    const data = await request(`https://${host}/widgets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lang, deviceType: "desktop", country: site, pageName: "search-results", ddoKey: "refineSearch",
        sortBy: "", subsearch: "", from, jobs: true, counts: false, all_fields: ["country"], size: 100,
        clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: "page11", siteType: "external",
        keywords: "", global: true, selected_fields: { country: ["Poland"] },
      }),
    });
    const rs = data?.refineSearch;
    const jobs = rs?.data?.jobs || [];
    for (const j of jobs) {
      out.push({
        title: j.title,
        company: name,
        url: `${base || `https://${host}`}/job/${encodeURIComponent(j.jobId)}`,
        location: joinLoc(j.cityStateCountry || [j.city, j.country].filter(Boolean).join(", "), j.multi_location || []),
        description: stripHtml(j.descriptionTeaser || ""),
        posted_at: j.postedDate || j.dateCreated || null,
      });
    }
    if (jobs.length < 100 || out.length >= (rs?.totalHits ?? 0)) break;
  }
  return out;
}

// --- Cornerstone (CSOD) ------------------------------------------------------
// The career site page carries a short-lived bearer token and the regional API
// base; both are read fresh on every run.
function usDate(s) {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])).toISOString() : null;
}

export async function fromCornerstone({ name, slug, site }) {
  const page = await request(`https://${slug}.csod.com/ux/ats/careersite/${site}/home?c=${slug}`, { as: "text" });
  const token = page && (page.match(/"token":"([^"]+)"/) || [])[1];
  const cloud = page && (page.match(/"cloud":"([^"]+)"/) || [])[1];
  if (!token || !cloud) return [];
  const out = [];
  for (let pageNumber = 1; pageNumber <= 5; pageNumber++) {
    const data = await request(`${cloud.replace(/\/$/, "")}/rec-job-search/external/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        careerSiteId: Number(site), careerSitePageId: Number(site), pageNumber, pageSize: 100, cultureId: 1,
        searchText: "", cultureName: "en-US", states: [], countryCodes: [], cities: [], placeID: "", radius: null,
        postingsWithinDays: null, customFieldCheckboxKeys: [], customFieldDropdowns: [], customFieldRadios: [],
      }),
    });
    const reqs = data?.data?.requisitions || [];
    for (const j of reqs) {
      const locs = j.locations || [];
      out.push({
        title: j.displayJobTitle,
        company: name,
        url: `https://${slug}.csod.com/ux/ats/careersite/${site}/home/requisition/${j.requisitionId}?c=${slug}`,
        // Country arrives as an ISO code; the feed's location filter reads words.
        location: joinLoc(locs.map((l) => [l.city, l.country].filter(Boolean).join(", ")),
          locs.some((l) => l.country === "PL") ? "Poland" : ""),
        description: stripHtml(j.externalDescription || ""),
        posted_at: usDate(j.postingEffectiveDate),
      });
    }
    if (reqs.length < 100) break;
  }
  return out;
}

// --- SAP SuccessFactors career sites (RMK) ------------------------------------
// jobs.gft.com, jobsearch.alstom.com and the like. Server-rendered search
// results, 25 rows a page, location-filtered by the site itself.
export async function fromSuccessFactors({ name, host, pages = 8 }) {
  const out = [];
  const seen = new Set();
  for (let p = 0; p < pages; p++) {
    const html = await request(`https://${host}/search/?q=&locationsearch=Poland&startrow=${p * 25}`, { as: "text" });
    if (!html) break;
    const rows = html.split(/class="data-row/).slice(1);
    let fresh = 0;
    for (const row of rows) {
      const a = row.match(/class="jobTitle-link[^"]*"\s+href="([^"]+)"[^>]*>([^<]+)</);
      if (!a) continue;
      const url = new URL(a[1].replace(/&amp;/g, "&"), `https://${host}`).href;
      if (seen.has(url)) continue;
      seen.add(url);
      fresh++;
      const loc = stripHtml((row.match(/class="jobLocation"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "");
      const date = stripHtml((row.match(/class="jobDate"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "");
      const posted = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
      out.push({
        title: decodeXml(a[2]).trim(),
        company: name,
        url,
        // The URL path names the city (/job/Katowice-...), which covers rows
        // whose location cell is rendered client-side.
        location: joinLoc(loc, decodeURIComponent(new URL(url).pathname).replace(/[-/]/g, " ")),
        description: "",
        posted_at: posted,
      });
    }
    if (rows.length < 25 || !fresh) break;
  }
  return out;
}

// --- Jobvite -----------------------------------------------------------------
export async function fromJobvite({ name, slug }) {
  const html = await request(`https://jobs.jobvite.com/${slug}/jobs`, { as: "text" });
  if (!html) return [];
  const out = [];
  for (const row of html.split(/<tr\b/).slice(1)) {
    const a = row.match(/href="(\/[^"]*\/job\/[A-Za-z0-9]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const loc = stripHtml((row.match(/jv-job-list-location[^>]*>([\s\S]*?)<\/td>/) || [])[1] || "");
    out.push({
      title: stripHtml(a[2]),
      company: name,
      url: `https://jobs.jobvite.com${a[1]}`,
      location: loc,
      description: "",
      posted_at: null,
    });
  }
  return out;
}

export const EXTRA_FETCHERS = {
  phenom: fromPhenom,
  cornerstone: fromCornerstone,
  successfactors: fromSuccessFactors,
  jobvite: fromJobvite,
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
