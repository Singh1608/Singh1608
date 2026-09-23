# Enterprise assumptions & business logic

This document records the decisions built into Tender AI, so that a bid
committee, finance, legal and IT can each check the parts they own.

## 1. Enterprise assumptions

| Area | Assumption | Where it lives |
|---|---|---|
| **Tenancy** | One deployment serves several business units or customers. Every business row carries `org_id`, and every query filters on the caller's org. A tender in another org returns 404, not 403, so the API never confirms it exists. | `models.py`, `api/*` |
| **Identity** | Callers authenticate with an API key, stored only as a SHA-256 hash and shown once when issued. In production the platform sits behind the corporate IdP (OIDC/SAML at the gateway), with IdP groups mapped onto the same `role` field. | `security.py` |
| **Roles (RBAC)** | `viewer`, `analyst`, `bid_manager`, `finance`, `legal`, `executive`, `admin`. `admin` manages users and data but **cannot approve bids**. Approval authority is never implied by seniority in IT. | `domain/workflow.py` |
| **Human in the loop** | AI output is advisory. Nothing is submitted automatically, and every state change is a named person's action. | `domain/rules.py` |
| **Segregation of duties** | Whoever sets the bid price cannot approve it. Overriding an AI "No bid" hard stop needs the `executive` role and a written justification. | `services/workflow_service.py` |
| **Auditability** | Every state change writes an append-only `audit_log` row (actor, action, before/after state, comment). Analyses are immutable: re-analysing appends a new version and never overwrites. | `audit.py`, `TenderAnalysis` |
| **Concurrency** | Tenders use optimistic locking (`version_id_col`). Two people editing the same tender get a 409, not a silent overwrite. | `models.Tender` |
| **AI resilience** | Claude is used when credentials are present. On a missing key, network error, rate limit, refusal or oversize document, the service falls back to the deterministic offline extractor and records why. The procurement workflow never blocks on the AI. Documents are **never silently truncated**: over-limit text goes to the offline extractor in full. | `services/llm.py`, `services/pipeline.py` |
| **Model governance** | Win-probability predictions are versioned (`model_version`, `model_source`, `training_samples`) and explainable (per-feature log-odds contributions). An org model replaces the industry prior only once the org has ≥ 40 outcomes that include both wins and losses. | `services/win_probability.py` |
| **Configuration** | Every policy threshold (hurdle margin, risk appetite, DoA limits, cost of capital) is an environment variable, so a policy change is a config change, not a release. | `config.py`, `.env.example` |
| **Data residency / retention** | Tender text is stored in the platform's own database. When Claude is enabled, the text is sent to the Anthropic API for extraction. Organisations with residency constraints can set `TENDER_LLM_ENABLED=off`. | — |
| **Money** | Amounts are stored in the tender's currency as floats and rounded to 2 dp at the edges. That is adequate for forecasting; a general-ledger integration would switch to `Decimal` and add FX conversion to the org's base currency. | — |
| **Public demo** | `TENDER_DEMO_MODE=1` seeds well-known demo keys. It is meant for sandboxes only: anyone with the URL can act as any role. `TENDER_LLM_MAX_CALLS_PER_HOUR` caps Claude spend per instance. | `config.py`, `services/llm.py` |
| **Operations** | Stateless API (scale horizontally), `/health` for liveness, `/ready` (DB check) for readiness, `x-request-id` correlation on every response, non-root container, Postgres in production and SQLite for development and tests. | `main.py`, `Dockerfile` |

## 2. Business logic

### 2.1 Extraction (what the tender says)
Both engines produce the same `TenderExtraction` schema: header data, value
and currency, deadline and key dates, duration, bid security, performance
guarantee %, advance %, retention %, payment days, LD cap %, evaluation
method (L1 / QCBS with technical weight / QBS), eligibility thresholds, scope
items, and risk flags with evidence quotes.

### 2.2 Eligibility (can we bid?)
Each quantified threshold (turnover, net worth, years, largest similar
project) is compared with the company profile. The result is PASS, FAIL, or
NOT_STATED when the document is silent. Certifications are matched after
normalisation (`ISO-27001` = `ISO 27001`). The check also confirms that bid
security plus the performance guarantee fit within the available
bank-guarantee limit. A FAIL on any line is a **hard stop**. The weakest
headroom ratio feeds the win model.

### 2.3 Contract risk (score 0–100)
Each clause in the risk catalogue has a weight: unlimited liability 22, LD
cap above 10% 14, broad indemnity 12, no price adjustment 10, short timeline
9, and so on. The weight is multiplied by a severity factor (LOW 0.5,
MEDIUM 0.8, HIGH 1.0). The score also adds deadline pressure (under 2× the
minimum preparation days) and a small penalty when no value is disclosed.
Bands: LOW < 30 ≤ MEDIUM < 60 ≤ HIGH.

### 2.4 Win probability
The model is a logistic regression on nine features: price ÷ estimate; the
same ratio again for lowest-price awards, where price matters more; expected
technical score; number of competitors; incumbency; buyer relationship;
sector fit; qualification headroom; and contract risk.

- The **buyer relationship** is derived from past outcomes with the same
  buyer and shrunk towards zero (`wins / (bids + 2)`), so one win out of one
  bid does not look like a strategic account.
- **Cold start:** until an org has enough history, the model trains on a
  seeded synthetic prior. Its data-generating equation is written out in
  code (`_prior_logit`), so it is reproducible and open to challenge.
- **Feedback loop:** recording a WON/LOST outcome stores that bid's feature
  vector as training data. The org model then takes over automatically.

### 2.5 Profit forecast (Monte Carlo, default 5 000 runs)
For a candidate price:

```
profit = price − direct cost × (1 + overrun) − overhead
         − liquidated damages − working-capital financing
         − retention financing − bank-guarantee commissions − tax
```

- **Overrun** follows a triangular distribution (−5%, 2%+5%·r, 10%+35%·r),
  where r is the risk score ÷ 100. Higher risk fattens the right tail.
- **Delay:** P(delay) = 5% + 50%·r, capped at 80%. A delay costs a uniform
  10–100% of the LD cap × price.
- **Working capital** = cost × payment-days/365 × (1 − advance%) × cost of
  capital.
- **Retention** is financed over half the contract plus a 12-month
  defect-liability period.
- **Guarantees:** the bank-guarantee commission is charged on bid security
  for about 3 months, and on the performance guarantee for the contract
  duration plus 12 months.

The output is the expected profit and margin, P10/P50/P90, P(loss), and the
expected cost build-up.

### 2.6 Price optimisation
The optimiser sweeps markups from −5% to +40% on the cost base (direct cost
× (1 + overhead + contingency)). For each price:
`EV = P(win at price) × E[profit | won] − bid preparation cost`.
It recommends the price with the highest EV among prices whose P(loss) is
within the policy limit. When no estimate is published, the price reference
is assumed at cost base +15%, and the UI flags this.

### 2.7 Bid / no-bid recommendation
- **Hard stops → NO_BID:** failed eligibility, deadline passed or under the
  minimum preparation days, or bid team at capacity (active bids ≥ profile
  limit).
- **Concerns → REVIEW:** risk above appetite, P(win) below threshold,
  expected margin below hurdle, P(loss) above limit, sector or region
  mismatch, eligibility criteria not found, or no cost estimate yet.
- **Otherwise → BID.** Strengths are listed alongside.

### 2.8 Workflow & delegation of authority

```
INTAKE → ANALYZED → (decide) → PRICING → (submit) → PENDING_APPROVAL → APPROVED → SUBMITTED → WON | LOST
                       └→ NO_BID            ▲──────── any reject ─────┘
withdraw: from any active state → WITHDRAWN
```

| Bid value | Approvers |
|---|---|
| < finance threshold (1 M) | a bid manager (not the pricer) |
| ≥ finance threshold | finance |
| ≥ executive threshold (10 M) | finance + executive |
| risk ≥ 50, or unlimited liability | + legal |

A rejection requires a comment and returns the tender to PRICING. A
resubmission supersedes any open approvals. `mark_submitted` is refused after
the deadline. The dashboard flags a tender **at risk** when approvals are
still pending within 3 days of its deadline.
