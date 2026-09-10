# AMR Resilience — Deployment Guide (beginner-friendly)

This walks you from "runs on my laptop" to "live on the internet", step by step.
Every command is copy-paste ready for **this** project.

```
Project ID : patchamomma-2026-505909
Region     : us-central1
BQ dataset : amr_resilience   (location US)
```

**What we're deploying**

| Piece | Where it goes | Why |
|---|---|---|
| Backend API (FastAPI) | **Cloud Run** (a service) | always-on HTTPS endpoint |
| Frontend (React build) | **Firebase Hosting** | static files + free HTTPS + SPA routing |
| Data | **BigQuery** (already there) | nothing to deploy |
| Secrets | **Secret Manager** | keep passwords/keys out of code |
| Scheduled jobs (optional) | **Cloud Run Jobs + Scheduler** | monthly GLASS pull, bucket sweeps |

Total time: ~1–2 hours the first time. Cost at pilot scale: **a few dollars/month**
(often within the free tier).

---

## Part 0 — One-time account setup

### 0.1 Install the Google Cloud CLI

macOS (you're on macOS):
```bash
brew install --cask google-cloud-sdk
```
Then restart your terminal and check:
```bash
gcloud version
```

### 0.2 Log in with the RIGHT Google account

⚠️ Your CLI is currently logged in as the wrong account (`smart-analyst-app`).
You need the Google account that has access to `patchamomma-2026-505909`.

```bash
gcloud auth login
```
A browser opens — pick the correct Google account.

Then set it as active and point at the project:
```bash
gcloud config set project patchamomma-2026-505909
gcloud auth application-default login    # also opens a browser — do this too
```

Confirm it worked:
```bash
gcloud config list
gcloud projects describe patchamomma-2026-505909
```
If the last command says "permission denied", you don't have access to the
project — ask whoever owns it to add you as **Editor** (or at least the roles in
0.4) in the Google Cloud Console → IAM.

### 0.3 Make sure billing is enabled

Cloud Run needs an active billing account.
```bash
gcloud billing projects describe patchamomma-2026-505909
```
If `billingEnabled: false`, open the Console → Billing and link a billing
account. (You still stay within the free tier at pilot scale.)

### 0.4 Enable the APIs we'll use

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  bigquery.googleapis.com \
  storage.googleapis.com
```
(Takes a minute.)

---

## Part 1 — Put secrets in Secret Manager

We never bake secrets into the image. We store them once and let Cloud Run read
them at startup.

### 1.1 Generate a strong auth secret

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```
Copy the output (keep it somewhere safe — never commit it).

### 1.2 Create the secrets

Run these one at a time. When it says `Enter a value`, paste the value and press
**Ctrl-D** (macOS) once on a new line.

```bash
# the value you generated in 1.1
gcloud secrets create AUTH_SECRET --replication-policy=automatic --data-file=-

# a made-up shared key hospitals will use for the webhook (any long random string)
gcloud secrets create HOSPITAL_INGEST_KEY --replication-policy=automatic --data-file=-

# the Gemini API key (from backend/.env line 2). Only needed for the AI
# "investigation" feature — you can skip it and that one button will show a
# friendly "not configured" message.
gcloud secrets create GEMINI_API_KEY --replication-policy=automatic --data-file=-
```

Check they exist:
```bash
gcloud secrets list
```

---

## Part 2 — Create a service account for the API

The API needs permission to read/write BigQuery and Cloud Storage. We give those
permissions to a dedicated identity ("service account") that Cloud Run runs as.

```bash
# 2.1 create it
gcloud iam service-accounts create amr-api \
  --display-name="AMR Resilience API"

# handy variable for the rest of this guide
SA="amr-api@patchamomma-2026-505909.iam.gserviceaccount.com"

# 2.2 grant BigQuery (read + run queries + write rows)
gcloud projects add-iam-policy-binding patchamomma-2026-505909 \
  --member="serviceAccount:$SA" --role="roles/bigquery.dataEditor"
gcloud projects add-iam-policy-binding patchamomma-2026-505909 \
  --member="serviceAccount:$SA" --role="roles/bigquery.jobUser"

# 2.3 grant Cloud Storage (vendor docs, GLASS raw files, hospital drops)
gcloud projects add-iam-policy-binding patchamomma-2026-505909 \
  --member="serviceAccount:$SA" --role="roles/storage.objectAdmin"

# 2.4 let the API read the 3 secrets from Part 1
for S in AUTH_SECRET HOSPITAL_INGEST_KEY GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
done
```

---

## Part 3 — Deploy the API to Cloud Run

From the **repo root** (`/Users/shuvashreebaisya/Development/amr_resilience`):

There is a `Dockerfile` at the repo root — Cloud Run uses it automatically.

```bash
gcloud run deploy amr-api \
  --source . \
  --region us-central1 \
  --service-account amr-api@patchamomma-2026-505909.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --memory 2Gi --cpu 2 --timeout 300 --max-instances 3 \
  --set-env-vars "GCP_PROJECT=patchamomma-2026-505909,BQ_DATASET_ID=amr_resilience,GCP_LOCATION=us-central1,ALLOW_HEADER_AUTH=false" \
  --set-secrets "AUTH_SECRET=AUTH_SECRET:latest,HOSPITAL_INGEST_KEY=HOSPITAL_INGEST_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

Notes:
- `--source .` means Cloud Build builds the Docker image for you in the cloud —
  you don't need Docker installed locally.
- First build takes ~5–8 min (it installs Playwright + Chromium). Later deploys
  are faster.
- `--allow-unauthenticated` = the internet can reach the URL. Your own
  login/token system still protects the data; this just means Google's layer
  doesn't also require a Google account.

When it finishes it prints a **Service URL** like
`https://amr-api-xxxxxxxx-uc.a.run.app`. **Copy it.**

Test it:
```bash
curl https://amr-api-xxxxxxxx-uc.a.run.app/health
# {"success":true,"data":{"status":"healthy",...}}
```
The current deployment's Service URL is `https://amr-api-39499444372.us-central1.run.app`.

If you get an error, jump to **Troubleshooting** at the bottom.

---

## Part 4 — Load the data (one-time)

The BigQuery tables and demo data are created by the migration script. Run it
**once** from your laptop (it uses the `application-default` login from step 0.2):

```bash
cd /Users/shuvashreebaisya/Development/amr_resilience
.venv/bin/python -m backend.database.migrate --seed
```

This creates every table/view, seeds departments/policies/allocations, seeds the
7-antibiotic operational panel, creates the demo login accounts, and generates
the synthetic AMR isolates. Safe to re-run (it's idempotent apart from the 009
seed — if you re-run, use `--seed-panel --seed-users --seed-amr` instead of
`--seed`).

**Demo logins** (change these before real users arrive):
| Username | Password | Role |
|---|---|---|
| `admin` | `admin2026` | admin |
| `e.vance` | `pharm2026` | chief_pharmacist |
| `s.rao` | `icu2026` | attending_physician |
| `j.mehta` | `ward2026` | department_staff |

---

## Part 5 — Deploy the frontend (Firebase Hosting)

### 5.1 Install the Firebase CLI

```bash
npm install -g firebase-tools
firebase login          # opens a browser — same Google account
```

### 5.2 Point the frontend at your API

```bash
cd frontend
cp .env.production.example .env.production
```
Edit `.env.production` and replace the URL with **your Part 3 Service URL**,
keeping `/api/v1` on the end:
```
VITE_API_BASE_URL="https://amr-api-xxxxxxxx-uc.a.run.app/api/v1"
```

### 5.3 Build

```bash
npm install
npm run build          # produces frontend/dist/
```

### 5.4 Initialise Firebase Hosting (first time only)

```bash
firebase init hosting
```
Answer:
- **Use an existing project** → `patchamomma-2026-505909`
- **public directory** → `dist`
- **single-page app (rewrite all urls to /index.html)** → **Yes**
- **set up automatic builds with GitHub** → No
- **overwrite dist/index.html** → **No**

### 5.5 Deploy

```bash
firebase deploy --only hosting
```
It prints a **Hosting URL** like `https://patchamomma-2026-505909.web.app`.
**Copy it.**

---

## Part 6 — Connect the two (CORS)

The API must be told to accept browser requests from your new frontend URL.

```bash
gcloud run services update amr-api --region us-central1 \
  --update-env-vars "CORS_ORIGINS=https://patchamomma-2026-505909.web.app"
```
(If you later add a custom domain, put both here, comma-separated.)

Wait ~30 seconds for the new revision to go live.

---

## Part 7 — Smoke test the live app

1. Open your Hosting URL in a browser.
2. You should land on the **login page**.
3. Log in as `admin` / `admin2026`.
4. Check each area has data:
   - Dashboard — summary tiles + a trend chart
   - Inventory — 7 antibiotics
   - Departments / Allocations — rows
   - Scenarios — pick a preset, run it, see a projection
   - Recommendations — a ranked list
   - Audit — events
   - AMR Explorer — the heat-matrix + trend chart
   - Administration → Data Ingestion / Vendor Documents (admin only)
5. Open the browser dev tools → Network tab → confirm calls go to your
   `amr-api-...run.app` URL and return `200`.

If the page loads but every panel shows an error, it's almost always **CORS**
(Part 6) or a wrong `VITE_API_BASE_URL` (Part 5.2 — rebuild + redeploy after
fixing).

---

## Part 8 — (Optional) schedule the ingestion agents

Only do this once the core app is working. Full commands are in
[`deploy/README.md`](README.md). In short:

```bash
# build the jobs image
gcloud builds submit --tag gcr.io/patchamomma-2026-505909/amr-jobs -f deploy/Dockerfile.jobs .

# create the jobs (they reuse the amr-api service account)
gcloud run jobs create amr-glass-monthly  --image gcr.io/patchamomma-2026-505909/amr-jobs \
  --region us-central1 --service-account $SA --task-timeout 1800 \
  --set-env-vars JOB=glass-monthly,GCP_PROJECT=patchamomma-2026-505909,BQ_DATASET_ID=amr_resilience

# schedule monthly (2nd of the month, 06:00 UTC)
gcloud scheduler jobs create http amr-glass-monthly-trigger --location us-central1 \
  --schedule "0 6 2 * *" --time-zone UTC \
  --uri "https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/patchamomma-2026-505909/jobs/amr-glass-monthly:run" \
  --http-method POST --oauth-service-account-email $SA
```

---

## Part 9 — Day-2 operations

### Deploy a backend change
```bash
git pull                       # or make your edits
gcloud run deploy amr-api --source . --region us-central1
```
(Env vars and secrets are remembered — you don't repeat them.)

### Deploy a frontend change
```bash
cd frontend && npm run build && firebase deploy --only hosting
```

### View logs
```bash
gcloud run services logs read amr-api --region us-central1 --limit 100
```
Or Console → Cloud Run → amr-api → Logs.

### Roll back the API
Console → Cloud Run → amr-api → **Revisions** → pick the previous one →
"Manage traffic" → 100% to it.

### Change a secret (e.g. rotate AUTH_SECRET)
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))" | \
  gcloud secrets versions add AUTH_SECRET --data-file=-
gcloud run services update amr-api --region us-central1 \
  --update-secrets AUTH_SECRET=AUTH_SECRET:latest
```
(Everyone gets logged out — they sign in again.)

---

## Staff accounts

Hospital staff sign in with a **username + password on the app's own login
page** — they never need a Google account. Roles (`admin`, `chief_pharmacist`,
`attending_physician`, `pharmacist`, `department_staff`) are enforced on the
server for every request.

- **Manage accounts in the app:** sign in as an admin → **Administration →
  Staff Accounts** → add users, set roles, reset passwords, deactivate.
- **Bootstrap / recover from the CLI:**
  ```bash
  python -m backend.database.add_user --username j.smith --name "Dr. J. Smith" \
      --role attending_physician --department ICU
  python -m backend.database.add_user --username j.smith --reset   # reset a password
  ```
- **Self-service:** any signed-in user → the profile card (bottom-left) →
  **My Account** → change password.
- Login is **rate-limited** (5 failed attempts per username+IP → locked 15 min).

## Before real hospital staff use it

1. **Change/disable the demo passwords** — via Staff Accounts, delete or reset
   `admin`, `e.vance`, `s.rao`, `j.mehta`, `a.khan`, and create real accounts.
2. **Rotate the `GEMINI_API_KEY`** that has been sitting in `backend/.env`.
3. **A custom domain** (Firebase Hosting → Add custom domain) so it's not
   `*.web.app`.
4. **Uptime alerting** — Console → Monitoring → alert on Cloud Run 5xx rate.
5. **A backup/export policy** for the BigQuery dataset if the data becomes
   non-reproducible.
6. Login rate-limiting is **per Cloud Run instance** — fine at `--max-instances 3`;
   move to a shared store (Redis/Memorystore) if you scale wider.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `gcloud` "permission denied" on the project | You're on the wrong Google account or lack access — see Part 0.2 |
| Build fails at `pip install` with a Python-version / no-matching-distribution error | The base image Python is too old for `requirements.txt` — the root `Dockerfile` must be `python:3.13-slim-bookworm` (already is). Don't switch it back to the Playwright base image (that ships Python 3.10). |
| Build step 0 (`docker`) fails, no obvious reason | Open the build URL printed in the terminal → read the red line. Usually a bad pin in `requirements.txt` or a transient network blip — re-run the deploy. |
| First deploy: `...compute@developer.gserviceaccount.com does not have storage.objects.get` | Grant the Cloud Build identity its role (one-time): `gcloud projects add-iam-policy-binding patchamomma-2026-505909 --member="serviceAccount:39499444372-compute@developer.gserviceaccount.com" --role="roles/cloudbuild.builds.builder"` then re-deploy |
| `/health` works but data calls return 500 | The service account is missing a BigQuery role — re-run Part 2.2; check logs (Part 9) |
| Frontend loads, every panel errors, dev-tools shows CORS | Part 6 — set `CORS_ORIGINS` to the exact Hosting URL (no trailing slash) |
| Login fails with correct password | Migration/seed-users didn't run — Part 4 |
| "investigation agent not configured" | `GEMINI_API_KEY` secret missing/empty — optional feature, safe to ignore |
| Calls go to `localhost:8000` in production | `.env.production` not picked up — it must be at `frontend/.env.production`, then rebuild + redeploy |
