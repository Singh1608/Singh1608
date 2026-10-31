# Apollo.io Recruiter Outreach Campaign

Automated recruiter outreach system for targeted companies in Warsaw, with A/B testing and approval workflow.

## Setup

### 1. Environment Variables

Add to Vercel and GitHub Secrets:
```bash
APOLLO_API_KEY=your_apollo_api_key_here
GMAIL_API_TOKEN=your_gmail_token_here  # Or use Gmail MCP tool for sending
```

### 2. Install Dependencies

```bash
npm install node-fetch
```

## Workflow

### Step 1: Configure Target Companies & Roles

Edit `config.json`:
- Add/update target companies
- Add/update target roles with their scores
- Adjust recruiter search filters (titles, departments)

### Step 2: Search Apollo.io for Recruiters

```bash
node outreach/apollo-client.mjs
```

This will:
1. Search Apollo for organizations matching your target companies
2. Search for recruiters in those organizations
3. Save results to `logs/apollo-search-YYYY-MM-DD.json`

**Output:** Raw Apollo data with recruiter contacts

### Step 3: Build Campaign with Message Variants

```bash
node outreach/campaign-builder.mjs
```

This will:
1. Load recruiters from the latest Apollo search
2. Match each recruiter to relevant target roles
3. Generate 3 message variants (A, B, C) for each contact
4. Create campaign file in `campaigns/campaign-YYYY-MM-DD.json`

**Output:** Campaign with 3 personalized message variants per recruiter

### Step 4: Review & Approve (Manual Step)

**Open the campaign file and:**

1. Review each recruiter's email and role match
2. Read all 3 message variants for each contact
3. Select your preferred variant (A, B, or C)
4. Add any notes (e.g., "found at conference", "mutual connection")
5. Set `status: "approved"` when ready to send

**Example:**
```json
{
  "contacts": [
    {
      "id": "contact-123",
      "recruiter": {
        "name": "Jane Smith",
        "email": "jane@citi.com",
        "title": "Senior Talent Manager",
        "company": "Citi"
      },
      "targetRole": {
        "title": "Senior Business Analyst / Project Manager",
        "company": "Citi",
        "score": 83
      },
      "selectedVariant": "B",  // Choose A, B, or C
      "notes": "Direct manager for this role",
      "status": "pending_review"
    }
  ]
}
```

### Step 5: Send Campaign

```bash
node outreach/send-campaign.mjs campaigns/campaign-YYYY-MM-DD.json
```

**Before running:**
- Update campaign status to `"approved"`
- Ensure all contacts have `selectedVariant` set (A, B, or C)

**What happens:**
1. Sends personalized emails via Gmail (using MCP tool)
2. Attaches your tailored resume (per company)
3. Logs all sends to `logs/send-campaign-*.log`
4. Tracks delivery status, opens, and replies

## Message Variants Explained

### Variant A: Direct + Value Prop
- **Best for:** Direct outreach to hiring managers
- **Tone:** Professional, results-focused
- **Length:** Medium
- **Hook:** Leading with your specific value proposition

### Variant B: Warm Intro + Fit
- **Best for:** Initial recruiter touch
- **Tone:** Friendly, collaborative
- **Length:** Medium-long
- **Hook:** Shows you did research on the company

### Variant C: Story-Driven + Curiosity
- **Best for:** Senior recruiters, building interest
- **Tone:** Narrative, engaging
- **Length:** Longer
- **Hook:** Personal story + clear fit to their challenges

## Campaign Files Structure

```
outreach/
├── config.json                 # Target companies, roles, filters
├── templates/
│   └── messages.json          # 3 message variants + placeholders
├── logs/
│   ├── apollo-search-*.json   # Raw Apollo.io search results
│   └── send-*.log             # Send logs with delivery status
├── campaigns/
│   └── campaign-*.json        # Campaign drafts + results
├── apollo-client.mjs          # Apollo.io search script
├── campaign-builder.mjs       # Message variant generator
├── send-campaign.mjs          # Email send script
└── README.md                  # This file
```

## A/B Testing Strategy

The system generates 3 variants for each recruiter:

1. **Variant A (Direct)** → Test with 33% of top-scoring contacts
2. **Variant B (Warm)** → Test with 33% of top-scoring contacts
3. **Variant C (Story)** → Test with 34% of top-scoring contacts

After initial sends, track:
- Open rates per variant
- Reply rates per variant
- Meeting request rate

**Adjust based on data:**
- High-performing variant → use for next batch
- Low-performing variant → rewrite or drop

## Tracking Responses

After sending, monitor:
1. **Gmail inbox** for replies
2. **LinkedIn messages** for inbound interest
3. **Calendar** for meeting requests

Log all interactions in the campaign file's `notes` field.

## Tips for Success

1. **Personalization matters** → More specific = higher response rate
2. **Timing** → Send on Tuesday–Thursday, 9am–12pm local time
3. **Follow-up** → 1-week follow-up if no reply
4. **Subject line** → They open it first—make it compelling
5. **Resume version** → Use tailored PDF, not generic version

## Troubleshooting

**Apollo API returning 401/403:**
- Check APOLLO_API_KEY is set correctly
- Verify API key has permissions for people/org search
- Check Apollo.io dashboard for rate limits

**No recruiters found:**
- Expand search to include "HR Manager", "Talent Acquisition Specialist"
- Add more target companies
- Lower seniority filters (include mid-level)

**Campaign send fails:**
- Verify Gmail API token is valid
- Check recruiter email addresses are correct
- Ensure PDF path is correct in send-campaign.mjs

## Next Steps

1. ✅ Configure `config.json` with your target companies
2. ✅ Run Apollo search
3. ✅ Build campaign
4. ✅ Review & select message variants
5. ✅ Send campaign
6. ✅ Track responses & A/B test results
7. ✅ Iterate on winning message variant

Good luck! 🚀
