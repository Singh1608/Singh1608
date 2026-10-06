# Apollo Recruiter Outreach — Vercel Deployment Guide

Your recruiter outreach system is now integrated into your Vercel deployment. This guide shows you how to deploy and use it.

## What's Deployed

**New API Endpoints:**
- `POST /api/outreach` — Recruiter search and campaign building
- `GET /api/outreach` — System status

**New Dashboard:**
- `/public/outreach.html` — Campaign management UI

**Updated Configuration:**
- `vercel.json` — Added outreach function config

## Deployment Steps

### 1. Set Environment Variables in Vercel

Your Vercel project: `prj_DhAdvPln1ZTZgXPqiOk08gWIV1Qe`

1. Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**
2. Add these variables:

```
APOLLO_API_KEY = AOSj1yDAEL_xI9z-zPMOvA
```

*Note: This is already set in GitHub Secrets; Vercel will need it too.*

### 2. Deploy to Vercel

Option A: **Auto-deploy from GitHub**
```bash
git push origin claude/job-scraper-polish-companies-3n0xb0
```
Vercel automatically deploys on push.

Option B: **Manual deploy via Vercel CLI**
```bash
npm install -g vercel
vercel --prod
```

### 3. Verify Deployment

Once deployed, test the endpoints:

**Check service status:**
```bash
curl https://your-project.vercel.app/api/outreach
```

**Search for recruiters:**
```bash
curl -X POST https://your-project.vercel.app/api/outreach \
  -H "Content-Type: application/json" \
  -d '{
    "action": "search",
    "companies": ["Citi", "Capco", "EY"],
    "locations": ["Warsaw", "Poland"]
  }'
```

**Get message variants:**
```bash
curl -X POST https://your-project.vercel.app/api/outreach \
  -H "Content-Type: application/json" \
  -d '{
    "action": "variants",
    "recruiter": {
      "first_name": "John",
      "organization_name": "Citi"
    },
    "targetRole": {
      "title": "Senior Business Analyst"
    }
  }'
```

## How to Use

### From Dashboard

1. Open `https://your-project.vercel.app/outreach.html`
2. Enter target companies and locations
3. Click **🚀 Launch Recruiter Search & Build Campaign**
4. System will:
   - Search Apollo.io for recruiters
   - Match them to your top 8 roles
   - Generate 3 message variants per recruiter
5. Select preferred variant (A/B/C) for each contact
6. Send campaigns with your tailored resume

### From CLI (Local Development)

```bash
cd /home/user/Singh1608/outreach

# Search for recruiters
npm run search

# Build campaign
npm run build

# Review and select variants
npm run review

# Send campaign
npm run send campaigns/campaign-YYYY-MM-DD.json
```

### From API (Programmatically)

```javascript
// Search recruiters
const response = await fetch('/api/outreach', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'search',
    companies: ['Citi', 'Capco', 'EY'],
    locations: ['Warsaw', 'Poland'],
  }),
});

const { recruiters } = await response.json();
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│          Vercel Deployment                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  Public Dashboard                            │  │
│  │  /public/outreach.html                       │  │
│  │  - Campaign builder UI                       │  │
│  │  - Recruiter list display                    │  │
│  │  - Status monitoring                         │  │
│  └──────────────────────────────────────────────┘  │
│                      ↓                              │
│  ┌──────────────────────────────────────────────┐  │
│  │  API Layer                                   │  │
│  │  /api/outreach                               │  │
│  │  - Search: recruiter discovery               │  │
│  │  - Variants: message generation              │  │
│  │  - Status: system health                     │  │
│  └──────────────────────────────────────────────┘  │
│                      ↓                              │
│  ┌──────────────────────────────────────────────┐  │
│  │  Core Engine                                 │  │
│  │  /api/_outreach.js                           │  │
│  │  - Apollo.io client                          │  │
│  │  - Message variants (A/B/C)                  │  │
│  │  - Campaign builder logic                    │  │
│  └──────────────────────────────────────────────┘  │
│                      ↓                              │
│  ┌──────────────────────────────────────────────┐  │
│  │  External Services                           │  │
│  │  - Apollo.io API (recruiter data)            │  │
│  │  - Gmail API (email sending)                 │  │
│  │  - Vercel Blob (campaign storage)            │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Features

✅ **Recruiter Search** — Find hiring managers and recruiters at target companies  
✅ **Message Variants** — 3 options (Direct, Warm, Story-driven) per contact  
✅ **Personalization** — Real achievements, companies, roles embedded  
✅ **A/B Testing** — Automatically distributes variants to test what works  
✅ **Dashboard UI** — Visual campaign builder and recruiter list  
✅ **API-First** — Programmatic access for automation  
✅ **Vercel Integration** — Serverless, scales automatically  

## Configuration

### Target Companies (in api/_outreach.js)

Default companies searched:
- Citi
- Capco
- EY
- Accenture
- Marsh McLennan
- State Street

To change, edit the `searchRecruiters()` function in `api/_outreach.js`.

### Message Templates (in api/_outreach.js)

The 3 message variants are hardcoded in `buildMessageVariants()`. To customize:
1. Edit your achievements in the function
2. Adjust tone/language per variant
3. Deploy to Vercel

### Recruiter Search Filters (in api/_outreach.js)

Currently searches for:
- **Job Titles**: Recruiter, Talent Acquisition, Hiring Manager, HR Manager
- **Departments**: HR, Talent Acquisition, Human Resources
- **Locations**: Warsaw, Poland

To change filters, edit the `jobTitles` and `departments` arrays in `searchRecruiters()`.

## Monitoring

### Check API Status
```bash
curl https://your-project.vercel.app/api/outreach
```

Response example:
```json
{
  "status": "ok",
  "service": "apollo-recruiter-outreach",
  "apiKeyConfigured": true,
  "actions": ["search", "variants"]
}
```

### View Vercel Logs
```bash
vercel logs --prod
```

### Monitor Errors
Check Vercel Dashboard → **Deployments** → **Runtime Logs** for any errors.

## Troubleshooting

**Q: Apollo API returns 403 Forbidden**  
A: Check that APOLLO_API_KEY is set correctly in Vercel environment variables.

**Q: Recruiter search returns no results**  
A: Apollo.io may be rate-limited or the API key doesn't have search permissions. Contact Apollo support.

**Q: Email sending not working**  
A: Gmail API integration requires additional setup. See instructions in `/api/send-campaign.js` (not yet deployed).

**Q: Dashboard shows "No recruiters found"**  
A: This is expected after first deployment. Run a search to populate the list.

## Next Steps

1. ✅ Deploy to Vercel (via GitHub push)
2. ✅ Set APOLLO_API_KEY in Vercel environment
3. ✅ Test `/api/outreach` endpoint
4. ✅ Open `/public/outreach.html` dashboard
5. ✅ Run recruiter search
6. ✅ Build campaign
7. ✅ Review and send (local CLI or API)

## Integration Points

Your outreach system connects with:

- **`/api/jobs`** — Top 8 roles feed
- **`/api/headhunt`** — Job scoring (same rubric)
- **`/api/status`** — Pipeline health
- **`/dashboard`** — Main pipeline UI

All share the same Vercel project and can read/write to Vercel Blob storage.

## Support

For issues or feature requests:
- Check `/outreach/README.md` for detailed documentation
- See `/OUTREACH_SETUP.md` for local CLI workflows
- Review `/api/_outreach.js` for API implementation details

---

**Deployed by:** Claude Haiku 4.5  
**Deployment branch:** `claude/job-scraper-polish-companies-3n0xb0`  
**Project:** `prj_DhAdvPln1ZTZgXPqiOk08gWIV1Qe`
