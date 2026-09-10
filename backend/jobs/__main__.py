"""
Unified entrypoint for scheduled ingestion jobs (Cloud Run job / cron / manual).

  python -m backend.jobs glass-monthly       # Module 1: scrape + ETL
  python -m backend.jobs glass-etl            # Module 1: ETL only (process raw drops)
  python -m backend.jobs hospital-drops       # Module 2: process new bucket drops
  python -m backend.jobs synthetic-amr        # Module 4: regenerate synthetic isolates
"""
import json
import sys


def main() -> int:
    job = sys.argv[1] if len(sys.argv) > 1 else ""
    if job == "glass-monthly":
        from backend.jobs.glass_ingest import run
        out = run(run_type="scheduled", triggered_by="cloud-scheduler", do_scrape=True)
    elif job == "glass-etl":
        from backend.jobs.glass_ingest import run
        out = run(run_type="scheduled", triggered_by="cloud-scheduler", do_scrape=False)
    elif job == "hospital-drops":
        from backend.jobs.hospital_ingest import process_bucket_drops
        out = process_bucket_drops()
    elif job == "synthetic-amr":
        from backend.jobs.synthetic_amr import run
        out = run(months=24, per_cell=40, seed=None)
    else:
        print(__doc__)
        return 2
    print(json.dumps({k: v for k, v in out.items() if k != "diagnostics"}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
