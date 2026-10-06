# Apollo.io Recruiter Outreach System — Setup Complete ✅

You now have a complete recruiter outreach system integrated with your Poland job pipeline.

## What Was Built

A 4-stage automated outreach campaign that:

1. **Searches Apollo.io** for recruiters at target companies in Warsaw
2. **Generates 3 message variants** (A/B/C) for each recruiter
3. **Lets you review & select** your preferred variant per contact
4. **Sends personalized emails** via Gmail with your tailored resume

---

## System Components

### Scripts (in `/home/user/Singh1608/outreach/`)

| Script | Purpose | Command |
|--------|---------|---------|
| `apollo-client.mjs` | Search Apollo.io for recruiters | `npm run search` |
| `campaign-builder.mjs` | Generate 3 message variants per recruiter | `npm run build` |
| `campaign-review.mjs` | Review variants, select preferred one, approve | `npm run review` |
| `send-campaign.mjs` | Send approved campaign via Gmail | `npm run send` |

### Configuration Files

| File | Purpose |
|------|---------|
| `config.json` | Target companies, roles, recruiter search filters |
| `templates/messages.json` | 3 message variants (A/B/C) + placeholders |
| `package.json` | NPM scripts for easy command running |

### Data Folders

| Folder | Purpose |
|--------|---------|
| `campaigns/` | Your campaigns (with personalized messages) |
| `logs/` | Apollo search results & send logs |
| `templates/` | Message templates |

---

## The 4-Stage Workflow

### Stage 1: Search Apollo
```bash
npm run search
```
- Finds recruiters at target companies (Citi, Capco, EY, Accenture, Marsh, etc.)
- Saves to `logs/apollo-search-YYYY-MM-DD.json`
- Time: ~1-2 minutes

### Stage 2: Build Campaign
```bash
npm run build
```
- Takes Apollo results
- Matches each recruiter to relevant job roles
- Generates 3 personalized message variants (A, B, C) for each
- Creates `campaigns/campaign-YYYY-MM-DD.json`
- Time: < 1 minute

### Stage 3: Review & Select
```bash
npm run review
```
- Shows each recruiter's details (email, title, company)
- Displays all 3 message variants for each
- You select your preferred variant (A, B, or C)
- Saves selections to campaign file
- Time: 5-10 minutes (interactive)

### Stage 4: Send Campaign
```bash
npm run send campaigns/campaign-YYYY-MM-DD.json
```
- Sends personalized emails via Gmail MCP tool
- Attaches your tailored resume (per company)
- Logs delivery status to `logs/send-*.log`
- Time: 2-5 minutes

---

## Message Variants Explained

### Variant A: Direct + Value Prop
**Best for:** Direct outreach to hiring managers  
**Tone:** Professional, results-focused  
**Hook:** Lead with your specific value to their role

**Example opening:**
> "I noticed Citi's focus on digital transformation and your team's work on change projects. I've spent 8 years building transformation strategies—most recently driving €50M+ cost optimization—and I believe I could accelerate your initiatives."

---

### Variant B: Warm Intro + Fit
**Best for:** Initial recruiter touch  
**Tone:** Friendly, collaborative  
**Hook:** Show you did research on the company

**Example opening:**
> "I'm Chandrashekhar, a business analyst and transformation strategist with 8 years in financial services. What drew me to Citi: your focus on digital transformation, significant investment in change management, and your role's perfect fit for my background."

---

### Variant C: Story-Driven + Curiosity
**Best for:** Senior recruiters, building interest  
**Tone:** Narrative-driven, engaging  
**Hook:** Personal story + clear fit

**Example opening:**
> "I'm making a strategic move: after 4 years delivering transformation initiatives across banking, I'm relocating to Warsaw to build my next chapter. Citi is on my radar—specifically for your Senior Business Analyst role—because it combines strategy with hands-on execution."

---

## A/B Testing Strategy

The system automatically distributes variants:
- **Variant A** → ~33% of contacts
- **Variant B** → ~33% of contacts
- **Variant C** → ~34% of contacts

**After first batch (5-10 days):**
1. Check Gmail inbox for replies
2. Count opens/replies per variant
3. Identify winning variant (highest response rate)
4. Use winning variant for next batch

**Track results in campaign's `notes` field for each contact:**
```json
{
  "id": "contact-123",
  "recruiter": { ... },
  "selectedVariant": "B",
  "notes": "Replied on 2024-10-08. High interest. Call scheduled.",
  "responses": {
    "opened": true,
    "replied": true,
    "meetingRequested": true
  }
}
```

---

## Environment Setup

### API Keys Required

1. **Apollo.io API Key** ✅ Already added to Vercel & GitHub
   - Used by `apollo-client.mjs` to search recruiters

2. **Gmail API (for sending)**
   - The system uses Gmail MCP tool (already connected to Claude)
   - Alternative: Set `GMAIL_API_TOKEN` if needed

### Verify Setup
```bash
cd /home/user/Singh1608/outreach

# Check if Apollo key is accessible to scripts
echo "Testing Apollo API access..."
node -e "console.log('Apollo API Key exists:', !!process.env.APOLLO_API_KEY)"
```

---

## Target Companies & Roles

**Default target companies:**
- Citi
- Capco
- EY
- Accenture
- Marsh McLennan
- State Street
- Goldman Sachs
- JP Morgan

**Your top 8 roles (matched automatically):**
1. 83 - Citi, Senior Business Analyst / Project Manager
2. 81 - Capco, Senior Business Analyst
3. 81 - EY, Technology Strategy & Transformation Consultant
4. 80 - Capco, Business Analyst – Target Operating Model
5. 78 - Accenture, Strategy Consultant (OM&OD)
6. 77 - Accenture, Strategy Consultant (C&PR)
7. 75 - Marsh McLennan, Business Analyst - Accounting Operations
8. 70 - Accenture, Technology Digital Strategy Consultant

**Add more roles:**
- Edit `config.json` → `targetRoles` array
- Add your "interesting roles" too
- Re-run `npm run build`

---

## First Run (Full Workflow)

```bash
cd /home/user/Singh1608/outreach

# 1. Search Apollo for recruiters
npm run search
# Outputs: logs/apollo-search-2024-10-06.json

# 2. Build campaign with message variants
npm run build
# Outputs: campaigns/campaign-2024-10-06.json

# 3. Review, select variants, approve campaign
npm run review
# Interactive: Pick A/B/C for each contact

# 4. Send the campaign
npm run send campaigns/campaign-2024-10-06.json
# Outputs: logs/send-campaign-*.log
```

**Total time: ~20 minutes (includes your manual review)**

---

## Key Features

✅ **Personalization:** Each message references the recruiter's company, the specific role, and your relevant experience  
✅ **A/B Testing:** 3 message variants per contact to test what resonates  
✅ **Approval Workflow:** You review and select variants before any email is sent  
✅ **Gmail Integration:** Sends via Gmail with your tailored PDF resume  
✅ **Logging:** Tracks all sends, opens, replies, and conversions  
✅ **Iterative:** Run multiple campaigns, test variants, optimize based on response rates  

---

## Tips for Success

### Before Sending
1. **Customize placeholders** in `templates/messages.json` with your real achievements
2. **Review company context** for each target company
3. **Test 1-2 contacts** first (small batch) before sending to everyone
4. **Schedule sends** for Tuesday–Thursday, 9am–12pm Warsaw time

### Message Selection Tips
- **Direct hiring managers?** → Use **Variant A** (Direct + Value Prop)
- **Initial recruiter touch?** → Use **Variant B** (Warm Intro)
- **Senior decision-makers?** → Use **Variant C** (Story-Driven)

### Follow-up Strategy
- **No reply in 5 days?** → Send follow-up via LinkedIn
- **Saw email but no reply?** → Follow up with brief message
- **Positive reply?** → Schedule call within 24 hours

---

## Troubleshooting

**Q: "No recruiters found in Apollo search"**  
A: 
- Wait 1-2 hours (Apollo may still be indexing)
- Expand search filters in `config.json`
- Check Apollo.io dashboard for API rate limits
- Add more target companies

**Q: "Campaign review won't start"**  
A:
- Ensure `npm run build` completed successfully
- Check that `campaigns/campaign-*.json` file exists
- Verify file has valid JSON format

**Q: "Send fails with Gmail error"**  
A:
- Verify Gmail MCP tool is connected in Claude
- Check campaign `status` is `"approved"`
- Confirm all contacts have `selectedVariant` set

**Q: "Want to pause and resume later?"**  
A:
- Your progress is auto-saved during `npm run review`
- Resume anytime: `npm run review campaigns/campaign-YYYY-MM-DD.json`
- It'll pick up where you left off

---

## Next Steps

1. **Run your first search:**
   ```bash
   cd outreach && npm install && npm run search
   ```

2. **Review the results:**
   ```bash
   cat logs/apollo-search-*.json | head -50
   ```

3. **Build your campaign:**
   ```bash
   npm run build
   ```

4. **Review and select variants:**
   ```bash
   npm run review
   ```

5. **Send when ready:**
   ```bash
   npm run send campaigns/campaign-*.json
   ```

---

## Documentation

- **Full guide:** `README.md` (detailed explanations)
- **Quick start:** `QUICKSTART.md` (copy-paste commands)
- **This file:** System overview

---

## Questions?

- See `outreach/README.md` for full documentation
- Check script comments for implementation details
- Review `config.json` for configuration options

Good luck with your outreach! 🚀

You're now running a sophisticated, data-driven recruiter outreach system. Use the A/B testing data to refine your messaging and improve response rates over time.
