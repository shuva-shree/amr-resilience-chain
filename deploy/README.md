# Deployment & scheduling

The ingestion agents run as **Cloud Run jobs** triggered by **Cloud Scheduler**.
Nothing here is applied automatically — run the commands when you are ready.

Project: `patchamomma-2026-505909` · Region: `us-central1` · Dataset: `amr_resilience` (US)

Buckets already created:
| Purpose | Bucket |
|---|---|
| GLASS raw drops | `gs://amr-raw-data-patchamomma-2026/glass/YYYY/MM/` |
| Vendor documents | `gs://amr-vendor-docs-patchamomma-2026/YYYY/MM/` |
| Hospital batch drops | `gs://amr-hospital-staging-patchamomma-2026/<hospital_id>/...` |

## 1. Build the jobs image

```bash
gcloud builds submit --tag gcr.io/patchamomma-2026-505909/amr-jobs \
  --file deploy/Dockerfile.jobs .
```

## 2. Create the Cloud Run jobs

```bash
# Module 1 — monthly GLASS ingestion (browser agent + ETL)
gcloud run jobs create amr-glass-monthly \
  --image gcr.io/patchamomma-2026-505909/amr-jobs \
  --region us-central1 --task-timeout 1800 --max-retries 1 \
  --set-env-vars JOB=glass-monthly,GCS_RAW_BUCKET=amr-raw-data-patchamomma-2026,BQ_DATASET_ID=amr_resilience

# Module 2 — hospital bucket-drop sweep (safety net; Eventarc handles real-time)
gcloud run jobs create amr-hospital-drops \
  --image gcr.io/patchamomma-2026-505909/amr-jobs \
  --region us-central1 --task-timeout 600 \
  --set-env-vars JOB=hospital-drops,GCS_HOSPITAL_BUCKET=amr-hospital-staging-patchamomma-2026,BQ_DATASET_ID=amr_resilience
```

## 3. Schedule them

```bash
# Monthly: 06:00 UTC on the 2nd of each month
gcloud scheduler jobs create http amr-glass-monthly-trigger \
  --location us-central1 --schedule "0 6 2 * *" --time-zone UTC \
  --uri "https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/patchamomma-2026-505909/jobs/amr-glass-monthly:run" \
  --http-method POST --oauth-service-account-email <runner-sa>@patchamomma-2026-505909.iam.gserviceaccount.com

# Every 15 min: hospital drop sweep
gcloud scheduler jobs create http amr-hospital-drops-trigger \
  --location us-central1 --schedule "*/15 * * * *" --time-zone UTC \
  --uri "https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/patchamomma-2026-505909/jobs/amr-hospital-drops:run" \
  --http-method POST --oauth-service-account-email <runner-sa>@patchamomma-2026-505909.iam.gserviceaccount.com
```

## 4. Real-time hospital drop ingestion (Eventarc)

Push GCS `object.finalize` events for the staging bucket to the API's Eventarc
handler so files are ingested the moment they land:

```bash
gcloud eventarc triggers create amr-hospital-drop \
  --location us-central1 \
  --destination-run-service amr-api --destination-run-path /api/v1/ingestion/hospital/eventarc \
  --event-filters "type=google.cloud.storage.object.v1.finalized" \
  --event-filters "bucket=amr-hospital-staging-patchamomma-2026" \
  --service-account <runner-sa>@patchamomma-2026-505909.iam.gserviceaccount.com
```

## Local cron (alternative)

`deploy/cron.txt`:
```
# m h dom mon dow   command  (cwd = repo root, venv activated)
0 6 2 * *   cd /path/to/amr_resilience && .venv/bin/python -m backend.jobs glass-monthly  >> logs/glass.log 2>&1
*/15 * * * * cd /path/to/amr_resilience && .venv/bin/python -m backend.jobs hospital-drops >> logs/hospital.log 2>&1
```

## Manual / admin-panel triggers

Both jobs are also runnable on demand:
* UI: **Administration → Data Ingestion** (admin role)
* API: `POST /api/v1/ingestion/glass/run`, `POST /api/v1/ingestion/hospital/process-drops`
* CLI: `python -m backend.jobs <job>`

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `GCS_RAW_BUCKET` | `amr-raw-data-patchamomma-2026` | GLASS raw drops |
| `GCS_VENDOR_BUCKET` | `amr-vendor-docs-patchamomma-2026` | vendor documents |
| `GCS_HOSPITAL_BUCKET` | `amr-hospital-staging-patchamomma-2026` | hospital drops |
| `LOCAL_STORAGE_ROOT` | `storage` | fallback dir when GCS is unreachable |
| `AUTH_SECRET` | dev constant | bearer-token signing key — **set in prod** |
| `ALLOW_HEADER_AUTH` | `true` | allow `X-User-*` header identity — **set `false` in prod** |
| `HOSPITAL_INGEST_KEY` | `dev-hospital-ingest-key` | shared key for the HIS webhook |
| `VENDOR_WEBHOOK_URL` | — | POST target for vendor approval notifications |
| `DOC_AI_PROCESSOR` | — | `projects/../locations/../processors/..` to use Document AI |
