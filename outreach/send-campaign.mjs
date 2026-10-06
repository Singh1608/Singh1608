#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CampaignSender {
  constructor(gmailApiToken) {
    this.gmailApiToken = gmailApiToken;
  }

  async sendEmail(to, subject, body, attachments = []) {
    // This will be integrated with the Gmail MCP tool
    // For now, we'll prepare the email data
    return {
      to,
      subject,
      body,
      attachments,
      status: 'prepared',
      timestamp: new Date().toISOString(),
    };
  }

  async processCampaign(campaignFile) {
    if (!fs.existsSync(campaignFile)) {
      throw new Error(`Campaign file not found: ${campaignFile}`);
    }

    const campaign = JSON.parse(fs.readFileSync(campaignFile, 'utf8'));

    if (campaign.status !== 'approved') {
      throw new Error(`Campaign status is '${campaign.status}', expected 'approved'`);
    }

    const results = [];
    const logFile = path.join(__dirname, 'logs', `send-${campaign.id}-${Date.now()}.log`);

    for (const contact of campaign.contacts) {
      if (!contact.selectedVariant) {
        console.warn(`⚠️  Skipping ${contact.recruiter.email} - no variant selected`);
        results.push({
          email: contact.recruiter.email,
          status: 'skipped',
          reason: 'no_variant_selected',
        });
        continue;
      }

      const variant = contact.variants.find((v) => v.variantId === contact.selectedVariant);
      if (!variant) {
        console.warn(`⚠️  Variant not found for ${contact.recruiter.email}`);
        results.push({
          email: contact.recruiter.email,
          status: 'error',
          reason: 'variant_not_found',
        });
        continue;
      }

      try {
        const emailResult = await this.sendEmail(
          contact.recruiter.email,
          variant.subject,
          variant.body,
          [
            {
              filename: `chandrashekhar-singh-${contact.targetRole.company}.pdf`,
              // Path to tailored resume PDF
            },
          ]
        );

        results.push({
          email: contact.recruiter.email,
          name: contact.recruiter.name,
          company: contact.recruiter.company,
          targetRole: contact.targetRole.title,
          variant: contact.selectedVariant,
          status: 'sent',
          timestamp: emailResult.timestamp,
        });

        console.log(`✓ Sent to ${contact.recruiter.email} (${contact.recruiter.name})`);
      } catch (error) {
        console.error(`✗ Error sending to ${contact.recruiter.email}:`, error.message);
        results.push({
          email: contact.recruiter.email,
          status: 'error',
          reason: error.message,
        });
      }
    }

    // Save log
    fs.writeFileSync(
      logFile,
      JSON.stringify(
        {
          campaignId: campaign.id,
          sent: results.filter((r) => r.status === 'sent').length,
          failed: results.filter((r) => r.status === 'error').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
          results,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );

    console.log(`\nCampaign Results:`);
    console.log(`✓ Sent: ${results.filter((r) => r.status === 'sent').length}`);
    console.log(`✗ Failed: ${results.filter((r) => r.status === 'error').length}`);
    console.log(`⊘ Skipped: ${results.filter((r) => r.status === 'skipped').length}`);
    console.log(`Log saved: ${logFile}`);

    return results;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const campaignFile = args[0];

  if (!campaignFile) {
    console.error('Usage: node send-campaign.mjs <campaign-file>');
    console.error('Example: node send-campaign.mjs ./campaigns/campaign-2024-10-06.json');
    process.exit(1);
  }

  const sender = new CampaignSender(process.env.GMAIL_API_TOKEN);

  try {
    await sender.processCampaign(campaignFile);
  } catch (error) {
    console.error('Campaign send failed:', error.message);
    process.exit(1);
  }
}

main();
