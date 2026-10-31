// The curated roles that survive both quality gates in _fit.js.
//
// Trimmed from 19 to 10 on 2026-09-22. What went, and why:
//   - Deloitte — Consultant — CFO Advisory, Finance Strategy & Operations, Warsaw
//     link is aggregator (jobs.accaglobal.com)
//   - PwC — (Senior) Consultant — Finance Transformation, Warsaw
//     link is aggregator (workopia.io)
//   - BCG — Associate or Consultant, Warsaw
//     link is aggregator (jobs.managementconsulted.com)
//   - Accenture — M&A Strategy Analyst / Consultant — Accenture Strategy
//     link is aggregator (en.wizbii.com)
//   - EY — Technology Strategy & Transformation Consultant
//     link is aggregator (workopia.io)
//   - Accenture — Business Strategy Consultant — ICH Europe
//     link is aggregator (www.efinancialcareers.com)
//   - Xebia — Poland & CEE job board
//     link is a board root, not a posting; fit score 0 is below the threshold
//   - eFinancialCareers — Lead Operational Excellence Specialist, Warsaw
//     link is aggregator (www.efinancialcareers.com)
//   - VML Enterprise Solutions — Senior Project Manager — Poland
//     fit score 1 is below the threshold
//
// Six of those nine were real, well-fitting roles lost purely to the link
// gate: their URLs pointed at ACCA's board, workopia.io, wizbii, eFinancial-
// Careers or managementconsulted rather than the employer's own application
// system. The roles may still exist; the links were not usable.
//
// Used only when the Blob feed does not yet exist. After the first write the
// Blob copy is authoritative and this file is never read again.

export const SEED = [
  {
    "id": "accenture-74ec6229",
    "title": "Strategy Consultant — Operating Model & Organizational Design",
    "company": "Accenture",
    "url": "https://www.accenture.com/be-en/careers/jobdetails?id=R00291171_en",
    "tier": 1,
    "fit_score": 7,
    "why": "Transformation and operating-model design — the FAB coverage redesign and Al-Ghurair TOM. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "employer",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "ey-2e51af70",
    "title": "Business Transformation Consultant, Warsaw",
    "company": "EY",
    "url": "https://careers.ey.com/ey/job/Warszawa-Business-Transformation-Consultant-MZ-01-208/697111101/",
    "tier": 1,
    "fit_score": 7,
    "why": "Transformation and operating-model design — the FAB coverage redesign and Al-Ghurair TOM. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "employer",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "accenture-0d4f8d5b",
    "title": "S&C Poland — Strategy Analyst, Warsaw",
    "company": "Accenture",
    "url": "https://accenture.wd103.myworkdayjobs.com/AccentureCareers/job/Warsaw/S-C-GN-Poland---Strategy---Analyst_R00285728-1/apply",
    "tier": 1,
    "fit_score": 6,
    "why": "Strategy and corporate development — the Kazakhstan market-entry case is exactly this shape. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "ats",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "mastercard-683b568e",
    "title": "Consultant, Advisors & Consulting Services — Strategy & Transformation",
    "company": "Mastercard",
    "url": "https://careers.mastercard.com/us/en/job/R-265030/Consultant-Advisors-Consulting-Services-Strategy-Transformation",
    "tier": 1,
    "fit_score": 6,
    "why": "Management/strategy consulting, which is his current title. financial services, where four years of banking delivery is a differentiator.",
    "link_kind": "employer",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "capco-444dbc9e",
    "title": "Business Analyst — Product Control",
    "company": "Capco",
    "url": "https://job-boards.greenhouse.io/capco/jobs/8146866",
    "tier": 2,
    "fit_score": 4,
    "why": "Business analysis. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "ats",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "capco-14f10e97",
    "title": "Senior Business Analyst",
    "company": "Capco",
    "url": "https://job-boards.greenhouse.io/capco/jobs/7383078",
    "tier": 2,
    "fit_score": 4,
    "why": "Business analysis. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "ats",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "capco-83bd1ad1",
    "title": "Senior Business Analyst — Cards",
    "company": "Capco",
    "url": "https://job-boards.greenhouse.io/capco/jobs/8081357",
    "tier": 2,
    "fit_score": 4,
    "why": "Business analysis. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "ats",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "capco-9a4df712",
    "title": "Business Analyst — Payments",
    "company": "Capco",
    "url": "https://job-boards.greenhouse.io/capco/jobs/5236287",
    "tier": 2,
    "fit_score": 4,
    "why": "Business analysis. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "ats",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "capco-4ab243a3",
    "title": "Business Analyst — BCIM/TPM",
    "company": "Capco",
    "url": "https://job-boards.greenhouse.io/capco/jobs/7962951",
    "tier": 2,
    "fit_score": 4,
    "why": "Business analysis. financial services, where four years of banking delivery is a differentiator; a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "ats",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  },
  {
    "id": "pwc-strategy-964bc868",
    "title": "Team Member — Strategy&, Warsaw",
    "company": "PwC Strategy&",
    "url": "https://jobs-cee.pwc.com/ce/en/job/528973WD/Team-Member-Strategy",
    "tier": 3,
    "fit_score": 3,
    "why": "Financial services, where four years of banking delivery is a differentiator. a consulting firm, so his consulting record reads as directly relevant.",
    "link_kind": "employer",
    "status": "new",
    "found_at": "2026-09-17",
    "last_seen": "2026-09-17",
    "live": true
  }
];
