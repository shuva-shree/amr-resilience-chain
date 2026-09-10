"""
One-off repair: the 009 seed uses plain INSERTs, so running
`migrate --seed` more than once duplicated every seeded row. This collapses
each seed table back to one row per natural key.

Safe to run repeatedly (a no-op once the tables are clean).

  python -m backend.database.dedupe_seed
"""
from __future__ import annotations

from backend.database.bigquery_client import bq_manager as bq

# table -> natural key column
_SEED_TABLES = {
    "departments": "department_id",
    "medicine_barcodes": "barcode_id",
    "medicine_regulatory_policies": "policy_id",
    "department_allocations": "allocation_id",
}


def run() -> dict:
    out = {}
    for table, key in _SEED_TABLES.items():
        before = bq.query(f"SELECT COUNT(*) c FROM {bq.table(table)}")[0]["c"]
        bq.query(
            f"""
            CREATE OR REPLACE TABLE {bq.table(table)} AS
            SELECT * FROM {bq.table(table)}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY {key} ORDER BY {key}) = 1
            """
        )
        after = bq.query(f"SELECT COUNT(*) c FROM {bq.table(table)}")[0]["c"]
        out[table] = {"before": before, "after": after, "removed": before - after}
    return out


if __name__ == "__main__":
    import json

    print(json.dumps(run(), indent=2))
