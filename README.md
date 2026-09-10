# AMR Resilience Chain

A hospital antimicrobial-resistance (AMR) supply-chain operations platform.
It combines antibiotic inventory, resistance surveillance, supplier-network
resilience, what-if scenario modelling and a governance/approval layer over a
single BigQuery data layer, with automated data-ingestion agents.

**Live demo:** https://amr-resilience.web.app
(`admin` / `admin2026` — see [Demo accounts](#demo-accounts))

---

## Architecture

```
React / Vite (Firebase Hosting)
        │  HTTPS, bearer token
        ▼
FastAPI  (Cloud Run: amr-api)  ──►  BigQuery  (dataset: amr_resilience, US)
        │                          Cloud Storage (raw GLASS / vendor docs / hospital drops)
        │
   Ingestion jobs (Cloud Run Jobs + Scheduler + Eventarc)
```

- **Backend** — `backend/`, FastAPI, single app, `/api/v1/*`, consistent
  `{success, data}` / `{success, error}` envelope. All data access goes through
  `backend/database/bigquery_client.py`.
- **Frontend** — `frontend/`, React 19 + Vite + Tailwind + Recharts, plain hooks,
  central API client in `src/api/`.
- **Auth** — username/password (PBKDF2) → HMAC bearer token; role-based access
  enforced server-side. Login is rate-limited.

## Feature areas

| Area | What it does |
|---|---|
| Dashboard / AMR Trends | Stockout risk + resistance/usage trends per antibiotic |
| Inventory & Barcode | Stock levels, days-of-supply, barcode identification, regulatory status |
| Department Allocation | Per-department stock coverage and risk |
| Supply Chain | Upstream supplier-network trace, failover alerts, purchase orders |
| Scenarios Lab | BigQuery-informed demand-surge / supplier-delay what-if projections |
| Recommendations | Ranked coverage risks with recommended actions |
| Governance | Regulatory policy engine (approval / block decisions), audit log |
| AMR Explorer | Isolate-level resistance heat-matrix + MIC trends (synthetic + GLASS + hospital data) |
| **Admin — Staff Accounts** | Create/edit/deactivate staff logins, set roles, reset passwords |
| **Admin — Data Ingestion** | WHO GLASS monthly agent + hospital feed ingestion (REST/FHIR/webhook/bucket-drop), PII stripping |
| **Admin — Vendor Documents** | Upload contracts/invoices, OCR/heuristic metadata extraction, validate→approve workflow with immutable audit trail |

## Running locally

Prerequisites: Python 3.13, Node 20+, a Google Cloud project with the
`amr_resilience` BigQuery dataset, and application-default credentials
(`gcloud auth application-default login`).

```bash
# backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m backend.database.migrate --seed      # create tables + demo data (one-time)
.venv/bin/python -m uvicorn backend.main:app --port 8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev                # http://localhost:5173
```

Config: copy `backend/.env.production.example` → `backend/.env` and fill in.
Key vars: `AUTH_SECRET`, `GCP_PROJECT`, `BQ_DATASET_ID`, `ALLOW_HEADER_AUTH=false`.

## Deployment

Full step-by-step guide: **[`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md)**.
Short version:

```bash
gcloud run deploy amr-api --source . --region us-central1        # backend
cd frontend && npm run build && firebase deploy --only hosting   # frontend
```

Ingestion jobs, Cloud Scheduler and Eventarc wiring: [`deploy/README.md`](deploy/README.md).

## Data / ingestion

- `backend/database/migrate.py` — schema + seed runner (`--seed`, `--seed-panel`,
  `--seed-users`, `--seed-amr`).
- `backend/jobs/` — `glass-monthly`, `glass-etl`, `hospital-drops`, `synthetic-amr`
  (run via `python -m backend.jobs <job>`).
- `backend/database/add_user.py` — CLI to create/reset a staff account.

## Demo accounts

| Username | Password | Role |
|---|---|---|
| `admin` | `admin2026` | Administrator |
| `e.vance` | `pharm2026` | Chief Pharmacist |
| `s.rao` | `icu2026` | Attending Physician |
| `a.khan` | `pharm2026` | Pharmacist |
| `j.mehta` | `ward2026` | Department Staff |

> Demo data only — replace these accounts before any real use.

## Notes / limitations

- Single hospital (`H001`); historical data is calendar-2024.
- The GLASS browser agent reaches the WHO portal but that view exports images,
  not tabular data — real GLASS rows need a CSV dropped into the raw bucket.
  All screens are populated from the seeded + synthetic dataset regardless.
- Vendor metadata extraction is heuristic unless a Google Document AI processor
  is configured (`DOC_AI_PROCESSOR`).
