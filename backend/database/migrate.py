"""
Apply BigQuery migrations in order.

Usage:
    python -m backend.database.migrate              # apply structural migrations (idempotent)
    python -m backend.database.migrate --seed       # also apply 009 seed data (NOT idempotent)
    python -m backend.database.migrate --seed-users # (re)create the demo login accounts (idempotent)
    python -m backend.database.migrate --seed-panel # (re)seed the 6-antibiotic operational panel (idempotent)
    python -m backend.database.migrate --seed-amr   # (re)generate synthetic AMR isolates (idempotent)

Structural files use CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE VIEW and the
antibiotic backfill is guarded, so re-running them is safe. The 009 seed uses
plain INSERTs and should only be run once.
"""
import pathlib
import sys

from google.cloud import bigquery

MIGRATIONS_DIR = pathlib.Path(__file__).parent / "migrations"

STRUCTURAL = [
    "001_departments.sql",
    "002_regulatory_policies.sql",
    "003_medicine_barcodes.sql",
    "004_department_allocations.sql",
    "005_inventory_transactions.sql",
    "006_audit_events.sql",
    "007_data_quality_results.sql",
    "010_seed_antibiotics.sql",
    "011_hospital_users.sql",
    "012_amr_isolates.sql",
    "013_ingestion.sql",
    "014_vendor_docs.sql",
    "008_views.sql",
]
SEED = ["009_seed_data.sql"]

# username -> (full_name, role, department_code, password)
DEMO_USERS = {
    "e.vance": ("Dr. E. Vance", "chief_pharmacist", "PHARM", "pharm2026"),
    "s.rao": ("Dr. S. Rao", "attending_physician", "ICU", "icu2026"),
    "a.khan": ("A. Khan", "pharmacist", "PHARM", "pharm2026"),
    "j.mehta": ("J. Mehta", "department_staff", "OPD", "ward2026"),
    "admin": ("System Administrator", "admin", "PHARM", "admin2026"),
}


def run_file(client: bigquery.Client, name: str) -> None:
    sql = (MIGRATIONS_DIR / name).read_text()
    print(f"  -> {name} ...", end=" ", flush=True)
    client.query(sql).result()
    print("done")


def seed_users(client: bigquery.Client) -> None:
    from backend.core.auth import hash_password

    table = "patchamomma-2026-505909.amr_resilience.hospital_users"
    client.query(f"DELETE FROM `{table}` WHERE user_id LIKE 'USR-0%'").result()
    rows = []
    for i, (username, (full_name, role, dept, password)) in enumerate(DEMO_USERS.items(), start=1):
        h = hash_password(password)
        rows.append({
            "user_id": f"USR-{i:03d}",
            "username": username,
            "full_name": full_name,
            "role": role,
            "department_code": dept,
            "hospital_id": "H001",
            "password_hash": h["password_hash"],
            "password_salt": h["salt"],
            "is_active": True,
        })
    # load job (not streaming) so passwords/roles are editable immediately
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    )
    client.load_table_from_json(rows, table, job_config=job_config).result()
    print(f"  -> seeded {len(rows)} demo hospital_users (USR-001..)")


def main() -> None:
    do_seed = "--seed" in sys.argv
    do_seed_users = "--seed-users" in sys.argv or do_seed
    client = bigquery.Client(project="patchamomma-2026-505909")

    print("Applying structural migrations:")
    for name in STRUCTURAL:
        run_file(client, name)

    if do_seed:
        print("Applying seed data:")
        for name in SEED:
            run_file(client, name)
    else:
        print("(skipping seed data - pass --seed to apply 009_seed_data.sql)")

    if do_seed_users:
        print("Seeding login accounts:")
        seed_users(client)

    if "--seed-panel" in sys.argv or do_seed:
        print("Seeding critical-antibiotic panel (inventory/usage/resistance/supply):")
        from backend.database.seed_amr_panel import run as run_panel

        print("  ->", run_panel())

    if "--seed-amr" in sys.argv or do_seed:
        print("Generating synthetic AMR isolates:")
        from backend.jobs.synthetic_amr import run as run_synth

        print("  ->", run_synth(months=24, per_cell=40, seed=42))

    print("Migration complete.")


if __name__ == "__main__":
    main()
