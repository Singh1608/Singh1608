/**
 * Outreach API Endpoint
 *
 * POST /api/outreach?action=search
 * POST /api/outreach?action=variants
 *
 * Integrated with Poland job-scraper pipeline
 * Provides recruiter search, campaign building, and message generation
 */

import handler from './_outreach.js';

export default handler;
