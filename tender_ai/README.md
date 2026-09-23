# Tender AI: tender analysis & procurement automation

Tender AI turns a tender document (RFP / ITT / NIT) into a governed bid
decision:

1. **Analysis & summarisation.** An executive summary plus structured
   extraction of value, deadlines, guarantees, payment terms, LDs,
   evaluation method, eligibility thresholds, scope and risk clauses (with
   evidence quotes). Uses Claude when configured and falls back to a
   deterministic offline extractor.
2. **Eligibility & risk.** Checks the tender's qualification criteria
   against your company profile, including bank-guarantee capacity, and
   scores contract risk from 0 to 100.
3. **Win-probability prediction.** An explainable logistic model. It learns
   from your own bid history once you have enough outcomes, and until then
   starts from a documented industry prior.
4. **Profit forecasting.** A Monte Carlo P&L covering cost overrun, delay
   penalties, working capital, retention and guarantee costs. It reports
   P10/P50/P90 and P(loss), and recommends the price with the highest
   risk-adjusted expected value.
5. **Procurement workflow automation.** A bid/no-bid recommendation, a
   role-based state machine, a delegation-of-authority approval matrix,
   segregation of duties, SLA alerts and a full audit trail. Recorded
   outcomes feed back into the win model.

The enterprise assumptions and every formula are written out in
[`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md).

## Quick start

```bash
cd tender_ai
pip install -r requirements.txt
python -m app.cli seed-demo          # demo org, one user per role, sample tender
uvicorn app.main:app --reload
```

Open http://localhost:8000 and connect with a demo key such as
`demo-bid_manager-key`. Demo keys follow the pattern `demo-<role>-key` and
are for local use only. The interactive API docs are at `/docs`.

To enable Claude for summarisation and extraction:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without a key, everything runs on the offline extractor. `/ready` reports
which engine is active.

### Docker (Postgres)

```bash
cp .env.example .env    # set TENDER_BOOTSTRAP_ADMIN_KEY and optionally ANTHROPIC_API_KEY
docker compose up --build
```

## API overview (`X-API-Key` header on every call)

| Method & path | Purpose | Roles |
|---|---|---|
| `POST /api/v1/tenders` | Create from text (analyses by default) | analyst, bid_manager, admin |
| `POST /api/v1/tenders/upload` | Create from `.pdf` / `.txt` / `.md` | analyst, bid_manager, admin |
| `GET /api/v1/tenders[?status=]` | List, ordered by deadline | any |
| `GET /api/v1/tenders/{id}` | Detail, latest analysis, approvals, allowed actions | any |
| `POST /api/v1/tenders/{id}/analyze` | Re-run with bid context and pricing (`reuse_extraction` skips the AI call) | analyst, bid_manager, admin |
| `POST /api/v1/tenders/{id}/actions/{action}` | `decide`, `submit_for_approval`, `approve`, `reject`, `mark_submitted`, `record_outcome`, `withdraw` | per workflow |
| `GET /api/v1/tenders/{id}/analyses` · `/audit` | Version history · audit trail | any |
| `GET/PUT /api/v1/company-profile` | Capabilities used for eligibility | read: any · write: admin, bid_manager |
| `POST /api/v1/historical-bids` | Import past outcomes to train the win model | admin, bid_manager |
| `GET /api/v1/models/win-probability` | Active model version and coefficients | any |
| `GET /api/v1/dashboard` | Pipeline value, weighted pipeline, win rate, deadlines at risk | any |
| `POST /api/v1/users` | Issue a user and API key (shown once) | admin |

Example: price a tender and move it through approval.

```bash
H='X-API-Key: demo-bid_manager-key'
curl -X POST localhost:8000/api/v1/tenders/1/analyze -H "$H" -H 'Content-Type: application/json' \
  -d '{"reuse_extraction":true,"bid_context":{"technical_score":0.8,"competitors":4},
       "pricing":{"direct_cost":8900000,"bid_preparation_cost":60000}}'
curl -X POST localhost:8000/api/v1/tenders/1/actions/decide -H "$H" -H 'Content-Type: application/json' -d '{"decision":"bid"}'
curl -X POST localhost:8000/api/v1/tenders/1/actions/submit_for_approval -H "$H" -H 'Content-Type: application/json' -d '{}'
```

## Layout

```
app/
  main.py                 FastAPI app, request-id middleware, health/ready, dashboard page
  config.py               all policy thresholds (env-driven)
  models.py               SQLAlchemy models (org-scoped, versioned, audited)
  security.py             API-key auth, role guards
  domain/
    tender.py             TenderExtraction schema + risk catalogue
    rules.py              bid/no-bid rules, delegation-of-authority matrix
    workflow.py           state machine, role permissions
  services/
    llm.py                Claude extraction (structured output, refusal fallback)
    heuristic_extractor.py offline extractor
    assessment.py         eligibility + risk scoring
    win_probability.py    explainable logistic model, prior + org training
    forecast.py           Monte Carlo P&L, price optimisation
    pipeline.py           orchestration
    workflow_service.py   approvals, SoD, outcome feedback loop
  static/index.html       dashboard
tests/                    unit + API workflow tests
```

## Tests

```bash
cd tender_ai && python -m pytest -q
```
