#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load templates and config
const templates = JSON.parse(fs.readFileSync(path.join(__dirname, 'templates/messages.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// Company-specific context for personalization
const companyContext = {
  Citi: {
    companyFocus: 'digital transformation in banking',
    companyReason1: 'Leading global financial institution',
    companyReason2: 'Significant investment in change management',
    whyCompanyMatters: 'Citi is pioneering next-gen banking transformation',
  },
  Capco: {
    companyFocus: 'target operating model and strategic consulting',
    companyReason1: 'Specialized consulting in business transformation',
    companyReason2: 'Strong focus on operating models and organizational design',
    whyCompanyMatters: 'Capco is shaping how enterprises restructure for competitive advantage',
  },
  EY: {
    companyFocus: 'digital strategy and technology transformation',
    companyReason1: 'Global leader in transformation consulting',
    companyReason2: 'Deep expertise in complex organizational change',
    whyCompanyMatters: 'EY is driving the next wave of digital-enabled business transformation',
  },
  Accenture: {
    companyFocus: 'strategy consulting and digital reinvention',
    companyReason1: 'Thought leader in operating model transformation',
    companyReason2: 'Focus on cost optimization and organizational design',
    whyCompanyMatters: 'Accenture is reshaping how organizations operate globally',
  },
  'Marsh McLennan': {
    companyFocus: 'risk and financial services consulting',
    companyReason1: 'Deep expertise in operations and controls',
    companyReason2: 'Strong presence in financial services transformation',
    whyCompanyMatters: 'Marsh is at the forefront of financial services innovation',
  },
};

function personalizeMessage(template, recruiter, role, context = {}) {
  let subject = template.subjectTemplate;
  let body = template.bodyTemplate;
  const company = recruiter.company || 'your organization';
  const firstName = recruiter.first_name || 'there';

  // Basic replacements
  subject = subject.replace(/{company}/g, company).replace(/{role}/g, role.title);

  body = body
    .replace(/{firstName}/g, firstName)
    .replace(/{company}/g, company)
    .replace(/{role}/g, role.title)
    .replace(/{roleBrief}/g, role.title)
    .replace(/{yearsRelevant}/g, context.yearsRelevant || '8')
    .replace(/{yearsExperience}/g, context.yearsExperience || '8')
    .replace(/{yearsInCurrent}/g, context.yearsInCurrent || '4');

  // Company-specific context
  const cCtx = companyContext[company] || companyContext.Citi; // default to Citi
  Object.keys(cCtx).forEach((key) => {
    body = body.replace(new RegExp(`{${key}}`, 'g'), cCtx[key]);
  });

  // Achievement replacements
  const achievements = [
    'stakeholder alignment across 10+ divisions',
    '€50M+ cost optimization initiatives',
    'organizational redesigns affecting 500+ people',
  ];

  body = body
    .replace(/{achievement1}/g, achievements[0])
    .replace(/{achievement2}/g, achievements[1])
    .replace(/{achievement3}/g, achievements[2])
    .replace(/{keyAchievement}/g, achievements[0])
    .replace(/{specificAchievement}/g, achievements[1]);

  // Role-specific replacements
  body = body
    .replace(/{roleGoal}/g, 'transformation roadmap')
    .replace(/{reasonWhyRole}/g, 'it aligns perfectly with my transformation background')
    .replace(/{domain}/g, 'business strategy and organizational transformation')
    .replace(/{keyResponsibility}/g, 'driving change across complex organizations')
    .replace(/{roleCompellingReason}/g, 'it combines strategy with hands-on execution')
    .replace(/{previousCompanyExample}/g, 'top-tier financial institutions')
    .replace(/{companyFocus}/g, cCtx.companyFocus)
    .replace(/{roleContext}/g, 'strategic initiatives');

  return { subject, body };
}

function generateCampaign(recruiters, roles) {
  const campaign = {
    id: `campaign-${new Date().toISOString().split('T')[0]}`,
    createdAt: new Date().toISOString(),
    status: 'draft',
    contacts: [],
  };

  // Match recruiters to roles
  recruiters.forEach((recruiter) => {
    const recruiterCompany = recruiter.organization_name || '';

    roles.forEach((role) => {
      if (recruiterCompany.toLowerCase().includes(role.company.toLowerCase())) {
        const variants = templates.variants.map((template) => {
          const personalized = personalizeMessage(template, recruiter, role);
          return {
            variantId: template.id,
            variantName: template.name,
            subject: personalized.subject,
            body: personalized.body,
          };
        });

        campaign.contacts.push({
          id: `contact-${recruiter.id || Math.random().toString(36).substr(2, 9)}`,
          recruiter: {
            name: `${recruiter.first_name} ${recruiter.last_name}`,
            email: recruiter.email,
            title: recruiter.headline,
            company: recruiter.organization_name,
            linkedinUrl: recruiter.linkedin_url,
          },
          targetRole: {
            id: role.id,
            title: role.title,
            company: role.company,
            score: role.score,
          },
          variants,
          selectedVariant: null,
          status: 'pending_review',
          notes: '',
        });
      }
    });
  });

  return campaign;
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0] || path.join(__dirname, 'logs', 'apollo-search-latest.json');

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file not found: ${inputFile}`);
    console.error('First run: node apollo-client.mjs');
    process.exit(1);
  }

  console.log('Building campaign...\n');

  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const recruiters = data.recruiters || [];
  const roles = config.targetRoles || [];

  const campaign = generateCampaign(recruiters, roles);

  // Save campaign
  const timestamp = new Date().toISOString().split('T')[0];
  const campaignFile = path.join(__dirname, 'campaigns', `campaign-${timestamp}.json`);
  fs.writeFileSync(campaignFile, JSON.stringify(campaign, null, 2));

  console.log(`Campaign created: ${campaign.id}`);
  console.log(`Contacts: ${campaign.contacts.length}`);
  console.log(`File: ${campaignFile}`);
  console.log('\nNext steps:');
  console.log('1. Review each contact and message variant');
  console.log('2. Select preferred variant (A, B, or C) for each');
  console.log('3. Run: node send-campaign.mjs <campaign-file>');
}

main();
