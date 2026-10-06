/**
 * Apollo.io Recruiter Outreach Engine
 *
 * Integrated into Poland job-scraper pipeline
 * Searches for recruiters, builds campaigns, and prepares outreach
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const APOLLO_API_URL = 'https://api.apollo.io/v1';

if (!APOLLO_API_KEY) {
  console.warn('⚠️  APOLLO_API_KEY not set - outreach searches will be disabled');
}

/**
 * Apollo.io API Client
 */
class ApolloClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async request(endpoint, method = 'GET', body = null) {
    if (!this.apiKey) {
      throw new Error('Apollo API key not configured');
    }

    const url = `${APOLLO_API_URL}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': this.apiKey,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`Apollo API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Request to ${endpoint} failed:`, error.message);
      throw error;
    }
  }

  async searchOrganizations(filters) {
    const body = {
      q_organization_name: filters.name || '',
      q_organization_locations: filters.locations || [],
      page: 1,
      per_page: 50,
    };
    return this.request('/organizations/search', 'POST', body);
  }

  async searchPeople(filters) {
    const body = {
      q_organization_ids: filters.organizationIds || [],
      q_job_titles: filters.jobTitles || [],
      q_person_departments: filters.departments || [],
      q_organization_locations: filters.locations || [],
      page: 1,
      per_page: 100,
    };
    return this.request('/people/search', 'POST', body);
  }
}

/**
 * Search for recruiters at target companies
 */
async function searchRecruiters(companies, locations) {
  if (!APOLLO_API_KEY) {
    return { error: 'Apollo API key not configured', recruiters: [] };
  }

  const client = new ApolloClient(APOLLO_API_KEY);
  const allRecruiters = [];

  try {
    // Search for each company
    const orgResults = await Promise.all(
      companies.map((company) =>
        client.searchOrganizations({
          name: company,
          locations,
        })
      )
    );

    const organizationIds = orgResults
      .flatMap((result) => result.organizations || [])
      .map((org) => org.id);

    if (organizationIds.length === 0) {
      return { error: 'No organizations found', recruiters: [] };
    }

    // Search for recruiters in those organizations
    const recruiterResults = await client.searchPeople({
      organizationIds,
      jobTitles: ['Recruiter', 'Talent Acquisition', 'Hiring Manager', 'HR Manager'],
      departments: ['HR', 'Talent Acquisition', 'Human Resources'],
      locations,
    });

    return {
      recruiters: recruiterResults.people || [],
      organizations: organizationIds.length,
    };
  } catch (error) {
    return { error: error.message, recruiters: [] };
  }
}

/**
 * Build message variants for a recruiter
 */
function buildMessageVariants(recruiter, targetRole, achievements) {
  const firstName = recruiter.first_name || 'there';
  const company = recruiter.organization_name || 'your organization';

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

/**
 * Main outreach API handler
 */
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action, companies, locations } = req.body || {};

  try {
    if (action === 'search') {
      // Search for recruiters
      const targetCompanies = companies || [
        'Citi',
        'Capco',
        'EY',
        'Accenture',
        'Marsh McLennan',
        'State Street',
      ];
      const targetLocations = locations || ['Warsaw', 'Poland'];

      const result = await searchRecruiters(targetCompanies, targetLocations);
      return res.status(200).json({
        status: 'success',
        action: 'recruiter_search',
        timestamp: new Date().toISOString(),
        ...result,
      });
    }

    if (action === 'variants') {
      // Generate message variants for a recruiter
      const { recruiter, targetRole } = req.body;

      if (!recruiter || !targetRole) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing recruiter or targetRole data',
        });
      }

      const achievements = [
        'screened ~50 growth initiatives, building FY2026 pipeline targeting AED 500mn+ value',
        'cut Treasury process count by 31% (135+ processes) in 2 months',
        'reclassified 1,500+ customer groups for sector-focused coverage',
      ];

      const variants = buildMessageVariants(recruiter, targetRole, achievements);

      return res.status(200).json({
        status: 'success',
        action: 'message_variants',
        recruiter: recruiter.email,
        variants,
      });
    }

    // Default: return outreach system status
    res.status(200).json({
      status: 'ok',
      service: 'apollo-recruiter-outreach',
      apiKeyConfigured: !!APOLLO_API_KEY,
      actions: ['search', 'variants'],
      docs: 'See /api/_outreach.js for integration details',
    });
  } catch (error) {
    console.error('Outreach API error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      service: 'apollo-recruiter-outreach',
    });
  }
}
