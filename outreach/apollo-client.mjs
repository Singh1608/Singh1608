#!/usr/bin/env node
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const APOLLO_API_URL = 'https://api.apollo.io/v1';

if (!APOLLO_API_KEY) {
  console.error('Error: APOLLO_API_KEY environment variable not set');
  process.exit(1);
}

class ApolloClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async request(endpoint, method = 'GET', body = null) {
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

  async searchPeople(filters) {
    // Apollo People Search endpoint
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

  async searchOrganizations(filters) {
    // Apollo Organizations Search endpoint
    const body = {
      q_organization_name: filters.name || '',
      q_organization_locations: filters.locations || [],
      page: 1,
      per_page: 50,
    };

    return this.request('/organizations/search', 'POST', body);
  }
}

async function main() {
  const client = new ApolloClient(APOLLO_API_KEY);
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

  console.log('Starting recruiter search...\n');

  try {
    // Step 1: Search for organizations
    console.log('Step 1: Searching for target organizations...');
    const orgs = await Promise.all(
      config.targetCompanies.map((company) =>
        client.searchOrganizations({
          name: company,
          locations: config.locations,
        })
      )
    );

    const organizationIds = orgs
      .flatMap((result) => result.organizations || [])
      .map((org) => org.id);

    console.log(`Found ${organizationIds.length} organizations\n`);

    // Step 2: Search for recruiters
    console.log('Step 2: Searching for recruiters in target organizations...');
    const recruiters = await client.searchPeople({
      organizationIds,
      jobTitles: config.recruiterSearchFilters.titles,
      departments: config.recruiterSearchFilters.departments,
      locations: config.locations,
    });

    console.log(`Found ${recruiters.people?.length || 0} recruiters\n`);

    // Step 3: Save raw results
    const timestamp = new Date().toISOString().split('T')[0];
    const resultsFile = path.join(__dirname, 'logs', `apollo-search-${timestamp}.json`);
    fs.writeFileSync(
      resultsFile,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          config,
          organizations: orgs.flatMap((r) => r.organizations || []),
          recruiters: recruiters.people || [],
        },
        null,
        2
      )
    );

    console.log(`Results saved to: ${resultsFile}`);
    console.log(`\nRecruiters found: ${recruiters.people?.length || 0}`);
  } catch (error) {
    console.error('Error during search:', error.message);
    process.exit(1);
  }
}

main();
