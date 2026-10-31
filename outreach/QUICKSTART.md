# Apollo.io Recruiter Outreach — Quick Start

## 5-Minute Setup

### 1. Install Dependencies
```bash
cd /home/user/Singh1608/outreach
npm install
```

### 2. Verify Apollo API Key
Your Apollo API key is already set in Vercel and GitHub. The scripts will use it automatically.

### 3. Search Apollo for Recruiters
```bash
npm run search
# or: node apollo-client.mjs
```

**What happens:**
- Searches 8 target companies (Citi, Capco, EY, Accenture, Marsh, State Street, Goldman Sachs, JP Morgan)
- Finds recruiters in Warsaw, Poland
- Saves results to `logs/apollo-search-YYYY-MM-DD.json`

**Time:** 1-2 minutes
**Output:** List of recruiter emails/contacts

---

## Build Campaign (Generate Message Variants)
```bash
npm run build
# or: node campaign-builder.mjs
```

**What happens:**
- Takes recruiters from Apollo search
- Matches them to your top 8 roles (83, 81, 81, 80, 78, 77, 75, 70 scores)
- Generates 3 message variants (A, B, C) for each recruiter
- Creates campaign file in `campaigns/campaign-YYYY-MM-DD.json`

**Time:** < 1 minute
**Output:** Campaign with 3 personalized messages per contact

---

## Review & Approve Campaign
```bash
npm run review
# or: node campaign-review.mjs
```

**What you'll do:**
1. See each recruiter's details (name, email, title, company)
2. See which role they match to (+ relevance score)
3. Read all 3 message variants (A, B, C)
4. **Select your preferred variant** (A, B, or C)
5. Add notes if needed
6. Move to next contact

**Tips:**
- **Variant A (Direct):** Professional, results-focused. Best for direct hiring managers.
- **Variant B (Warm):** Friendly, research-heavy. Best for initial recruiter touch.
- **Variant C (Story):** Narrative-driven, engaging. Best for senior recruiters.

**Time:** 5-10 minutes (depending on number of contacts)
**Output:** Campaign with selected variants, ready to send

---

## Send Campaign via Gmail
```bash
npm run send campaigns/campaign-YYYY-MM-DD.json
```

**What happens:**
1. Loads your approved campaign
2. Sends personalized emails to each recruiter
3. Attaches your tailored resume (per company)
4. Logs all sends to `logs/send-*.log`
5. Tracks delivery status

**Requirements:**
- Campaign must have `status: "approved"`
- All contacts must have `selectedVariant` (A, B, or C)

**Time:** 2-5 minutes (depending on number of emails)
**Output:** Send log with delivery status

---

## The Full Workflow in 3 Commands

```bash
# 1. Search for recruiters
npm run search

# 2. Build campaign with message variants
npm run build

# 3. Review, select variants, and approve
npm run review

# 4. Send the campaign
npm run send campaigns/campaign-YYYY-MM-DD.json
```

**Total time:** ~15-20 minutes (includes your manual review)

---

## A/B Testing

The system generates **3 variants for each contact**:
- **Variant A** → ~33% of contacts
- **Variant B** → ~33% of contacts  
- **Variant C** → ~34% of contacts

**After first batch:**
1. Check Gmail for replies/opens
2. Count response rates per variant
3. Note which variant performed best
4. Use winning variant for next batch

---

## Tracking Responses

**Monitor:**
- Gmail inbox for replies
- LinkedIn for connection requests/messages
- Calendar for meeting requests

**Log responses in campaign:**
- Update contact `notes` field with replies
- Track who converted to meeting
- Document feedback

---

## Troubleshooting

**"No recruiters found"**
- Apollo may need time to index (wait 1-2 hours)
- Try expanding search to other locations
- Check Apollo dashboard for rate limits

**"Campaign send fails"**
- Verify campaign `status` is `"approved"`
- Check all contacts have `selectedVariant` set
- Verify Gmail API token is valid

**"Want to resume review?"**
```bash
npm run review campaigns/campaign-YYYY-MM-DD.json
```
It'll pick up where you left off.

---

## Next Steps

1. ✅ Run `npm run search`
2. ✅ Review Apollo results in `logs/`
3. ✅ Run `npm run build` to generate variants
4. ✅ Run `npm run review` and select messages
5. ✅ Run `npm run send` when campaign is approved
6. ✅ Monitor responses and track A/B results
7. ✅ Iterate on winning message variant

---

## File Structure

```
outreach/
├── apollo-client.mjs         # Step 1: Search Apollo
├── campaign-builder.mjs      # Step 2: Build variants
├── campaign-review.mjs       # Step 3: Review & approve
├── send-campaign.mjs         # Step 4: Send emails
├── config.json              # Target companies & roles
├── templates/
│   └── messages.json        # 3 message variants
├── campaigns/               # Your campaigns (with emails)
├── logs/                    # Search results & send logs
├── package.json
├── README.md               # Full documentation
└── QUICKSTART.md          # This file
```

---

Happy recruiting! 🚀

Questions? See `README.md` for full details.
