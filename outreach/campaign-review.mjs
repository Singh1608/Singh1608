#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CampaignReviewer {
  constructor(campaignFile) {
    this.campaignFile = campaignFile;
    this.campaign = JSON.parse(fs.readFileSync(campaignFile, 'utf8'));
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  displayVariant(variant) {
    console.log(`\n📧 ${variant.variantName} (${variant.variantId})`);
    console.log('─'.repeat(80));
    console.log(`Subject: ${variant.subject}`);
    console.log('\n' + variant.body);
    console.log('─'.repeat(80));
  }

  async reviewContact(index) {
    const contact = this.campaign.contacts[index];
    console.clear();
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 Contact ${index + 1}/${this.campaign.contacts.length}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    console.log(`\n👤 Recruiter: ${contact.recruiter.name}`);
    console.log(`📧 Email: ${contact.recruiter.email}`);
    console.log(`🏢 Company: ${contact.recruiter.company}`);
    console.log(`📍 Title: ${contact.recruiter.title}`);

    console.log(`\n🎯 Target Role: ${contact.targetRole.title}`);
    console.log(`   Company: ${contact.targetRole.company}`);
    console.log(`   Relevance Score: ${contact.targetRole.score}/100`);

    if (contact.selectedVariant) {
      const selected = contact.variants.find((v) => v.variantId === contact.selectedVariant);
      console.log(`\n✅ Selected Variant: ${contact.selectedVariant} (${selected.variantName})`);
    } else {
      console.log(`\n⚠️  No variant selected yet`);
    }

    // Show all variants
    contact.variants.forEach((variant, idx) => {
      console.log(`\n\n>>> Variant ${idx + 1}/3: ${variant.variantName} (${variant.variantId})`);
      this.displayVariant(variant);
    });

    // Get selection
    while (true) {
      const selection = await this.question(
        `\n✏️  Select variant (A/B/C), skip (S), or notes (N)? [A/B/C/S/N]: `
      );

      if (['A', 'B', 'C'].includes(selection.toUpperCase())) {
        contact.selectedVariant = selection.toUpperCase();
        console.log(`✅ Selected: ${selection.toUpperCase()}`);
        break;
      } else if (selection.toUpperCase() === 'S') {
        console.log(`⊘ Skipped`);
        break;
      } else if (selection.toUpperCase() === 'N') {
        const notes = await this.question('Notes: ');
        contact.notes = notes;
        console.log(`📝 Notes saved`);
        // Loop to select variant after notes
      } else {
        console.log(`❌ Invalid selection. Use A, B, C, S, or N.`);
      }
    }

    this.saveProgress();
  }

  saveProgress() {
    fs.writeFileSync(this.campaignFile, JSON.stringify(this.campaign, null, 2));
  }

  async start() {
    console.log(`\n🚀 Campaign Review: ${this.campaign.id}`);
    console.log(`Total contacts: ${this.campaign.contacts.length}\n`);

    const startIndex = await this.question('Start from contact number (default: 1): ');
    let index = parseInt(startIndex) - 1 || 0;

    while (index < this.campaign.contacts.length) {
      const contact = this.campaign.contacts[index];

      if (!contact.selectedVariant) {
        await this.reviewContact(index);
      }

      const next = await this.question(`\n👉 Next contact (press Enter) or exit (E)? `);
      if (next.toUpperCase() === 'E') {
        break;
      }
      index++;
    }

    // Summary
    const selected = this.campaign.contacts.filter((c) => c.selectedVariant).length;
    const total = this.campaign.contacts.length;

    console.log(`\n${'━'.repeat(80)}`);
    console.log(`📊 Review Summary`);
    console.log(`${'━'.repeat(80)}`);
    console.log(`✅ Selected variants: ${selected}/${total}`);

    if (selected === total) {
      const approval = await this.question(
        `\n🎯 Ready to approve campaign for sending? (yes/no): `
      );
      if (approval.toLowerCase() === 'yes') {
        this.campaign.status = 'approved';
        this.saveProgress();
        console.log(`\n✅ Campaign approved!`);
        console.log(`Next: node outreach/send-campaign.mjs ${path.basename(this.campaignFile)}`);
      }
    } else {
      console.log(`\n⚠️  Complete all selections before approving (${total - selected} remaining)`);
      console.log(`Resume review later with: node outreach/campaign-review.mjs ${path.basename(this.campaignFile)}`);
    }

    console.log(`\n📁 Campaign saved: ${this.campaignFile}`);
    this.rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let campaignFile = args[0];

  if (!campaignFile) {
    // Find latest campaign
    const campaignsDir = path.join(__dirname, 'campaigns');
    const campaigns = fs
      .readdirSync(campaignsDir)
      .filter((f) => f.startsWith('campaign-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (campaigns.length === 0) {
      console.error('No campaigns found. Run: node outreach/campaign-builder.mjs');
      process.exit(1);
    }

    campaignFile = path.join(campaignsDir, campaigns[0]);
    console.log(`Using latest campaign: ${campaigns[0]}`);
  }

  const fullPath = path.resolve(campaignFile);
  if (!fs.existsSync(fullPath)) {
    console.error(`Campaign file not found: ${fullPath}`);
    process.exit(1);
  }

  const reviewer = new CampaignReviewer(fullPath);
  await reviewer.start();
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
