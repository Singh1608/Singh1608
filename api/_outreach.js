// Apollo.io recruiter search and outreach drafts.
//
//   GET  /api/outreach                                    -> status
//   POST /api/outreach { action: "search", companies, locations, titles? }
//   POST /api/outreach { action: "enrich", id }           -> email (spends an Apollo credit)
//   POST /api/outreach { action: "variants", recruiter, targetRole }

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const APOLLO_API_URL = 'https://api.apollo.io/api/v1';

const DEFAULT_COMPANIES = ['Citi', 'Capco', 'EY', 'Accenture', 'Marsh McLennan', 'State Street'];
const DEFAULT_LOCATIONS = ['Warsaw, Poland'];
const DEFAULT_TITLES = ['Recruiter', 'Talent Acquisition', 'Talent Acquisition Partner', 'Sourcer', 'HR Business Partner'];

async function apollo(endpoint, body) {
  if (!APOLLO_API_KEY) throw new Error('APOLLO_API_KEY is not set in Vercel');
  const response = await fetch(`${APOLLO_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': APOLLO_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Apollo ${endpoint} returned ${response.status}: ${detail}`);
  }
  return response.json();
}

// Apollo's location filter on companies is HQ location, so global employers
// with Warsaw offices would be dropped; match by name and filter people by location instead.
async function findOrganization(name) {
  const data = await apollo('/mixed_companies/search', { q_organization_name: name, page: 1, per_page: 3 });
  const orgs = [...(data.organizations || []), ...(data.accounts || [])];
  const org = orgs[0];
  return org ? { query: name, id: org.organization_id || org.id, name: org.name } : { query: name, id: null };
}

async function searchRecruiters({ companies, locations, titles }) {
  const orgs = await Promise.all(companies.map(findOrganization));
  const ids = orgs.filter((o) => o.id).map((o) => o.id);
  if (ids.length === 0) return { organizations: orgs, recruiters: [] };

  const data = await apollo('/mixed_people/api_search', {
    organization_ids: ids,
    person_titles: titles,
    person_locations: locations,
    include_similar_titles: true,
    page: 1,
    per_page: 100,
  });

  const recruiters = (data.people || []).map((p) => ({
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name || p.last_name_obfuscated || '',
    title: p.title || '',
    company: p.organization?.name || '',
    has_email: p.has_email ?? null,
    linkedin_url: p.linkedin_url || null,
  }));
  return { organizations: orgs, recruiters, total: data.total_entries ?? recruiters.length };
}

async function enrichPerson(id) {
  const data = await apollo('/people/match', { id, reveal_personal_emails: false });
  const p = data.person || {};
  return {
    id: p.id || id,
    first_name: p.first_name,
    last_name: p.last_name,
    title: p.title || '',
    company: p.organization?.name || '',
    email: p.email || null,
    email_status: p.email_status || null,
    linkedin_url: p.linkedin_url || null,
  };
}

/**
 * Build message variants for a recruiter
 */
function buildMessageVariants(recruiter, targetRole, achievements) {
  const firstName = recruiter.first_name || 'there';
  const company = recruiter.company || recruiter.organization_name || 'your organization';

  const variants = {
    A: {
      id: 'A',
      name: 'Direct + Value Prop',
      subject: `Strategy transformation opportunity at ${company}`,
      body: `Hi ${firstName},

I noticed ${company}'s focus on digital transformation and your team's work on strategic initiatives. I've spent 14 months building transformation strategies—most recently ${achievements[0]}—and I believe I could accelerate your transformation roadmap.

I'm relocating to Warsaw and actively exploring roles that combine business strategy with hands-on execution. Your role caught my attention because it aligns perfectly with my transformation background.

I'd welcome a brief conversation about how my experience in business transformation could support your team. My resume is attached.

Best regards,
Chandrashekhar Singh`,
    },
    B: {
      id: 'B',
      name: 'Warm Intro + Fit',
      subject: `Quick intro - transformation BA looking to join ${company} in Warsaw`,
      body: `Hi ${firstName},

I'm Chandrashekhar, a business analyst and transformation strategist with ~18 months in financial services and operating model redesign. I'm exploring opportunities with ${company} and came across your role.

What drew me to ${company}:
• Leader in banking transformation
• Significant investment in process optimization
• Your focus on strategic initiatives

I've worked on similar initiatives where I ${achievements[1]}. I'm now relocating to Warsaw and keen to find a role where I can contribute from day one.

Might you have 15 minutes for a quick call?

Cheers,
Chandrashekhar`,
    },
    C: {
      id: 'C',
      name: 'Story-Driven + Curiosity',
      subject: `Turning Warsaw into my base — and ${company} into my next challenge`,
      body: `Hi ${firstName},

I'm making a strategic move: after 14 months delivering transformation initiatives across banking, I'm relocating to Warsaw to build my next chapter. ${company} is on my radar—specifically for ${targetRole.title}—because I'm focused on driving organizational transformation.

My background spans the exact challenges your team is likely facing:
• ${achievements[0]}
• ${achievements[1]}
• ${achievements[2]}

Your role is compelling because it bridges strategy with execution, and I can see how my experience maps directly to your needs.

I'd be grateful for a quick conversation to explore if we're a mutual fit.

Chandrashekhar`,
    },
  };

  return variants;
}

const ACHIEVEMENTS = [
  'screened ~50 growth initiatives, building FY2026 pipeline targeting AED 500mn+ value',
  'cut Treasury process count by 31% (135+ processes) in 2 months',
  'reclassified 1,500+ customer groups for sector-focused coverage',
];

const list = (v, fallback) =>
  Array.isArray(v) && v.length ? v.map((s) => String(s).trim()).filter(Boolean) : fallback;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body || {};
  try {
    if (body.action === 'search') {
      const result = await searchRecruiters({
        companies: list(body.companies, DEFAULT_COMPANIES),
        locations: list(body.locations, DEFAULT_LOCATIONS),
        titles: list(body.titles, DEFAULT_TITLES),
      });
      return res.status(200).json({ status: 'success', timestamp: new Date().toISOString(), ...result });
    }

    if (body.action === 'enrich') {
      if (!body.id) return res.status(400).json({ status: 'error', message: 'Missing Apollo person id' });
      return res.status(200).json({ status: 'success', person: await enrichPerson(body.id) });
    }

    if (body.action === 'variants') {
      const { recruiter, targetRole } = body;
      if (!recruiter || !targetRole) {
        return res.status(400).json({ status: 'error', message: 'Missing recruiter or targetRole data' });
      }
      return res.status(200).json({
        status: 'success',
        recruiter: recruiter.email || null,
        variants: buildMessageVariants(recruiter, targetRole, ACHIEVEMENTS),
      });
    }

    return res.status(200).json({
      status: 'ok',
      service: 'apollo-recruiter-outreach',
      apiKeyConfigured: !!APOLLO_API_KEY,
      actions: ['search', 'enrich', 'variants'],
    });
  } catch (error) {
    console.error('outreach error:', error.message);
    return res.status(502).json({ status: 'error', message: error.message });
  }
}
