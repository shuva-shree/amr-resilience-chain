"""Isolate-level AMR surveillance explorer (Module 4 data)."""
from typing import Optional

from fastapi import APIRouter, Query
from google.cloud import bigquery

from backend.core.http import ok
from backend.database.bigquery_client import bq_manager as bq

router = APIRouter(prefix="/api/v1/amr/isolates", tags=["amr-explorer"])

_VIEW = bq.table("v_amr_isolate_resistance_monthly")
_TBL = bq.table("amr_isolates")


def _filters(region, pathogen, antibiotic, specimen, alias=""):
    a = f"{alias}." if alias else ""
    conds, params = [], []
    for col, val in (("region", region), ("pathogen", pathogen), ("antibiotic", antibiotic), ("specimen", specimen)):
        if val and val != "ALL":
            conds.append(f"{a}{col} = @{col}")
            params.append(bigquery.ScalarQueryParameter(col, "STRING", val))
    return conds, params


@router.get("/filters")
def filters():
    rows = bq.query(f"""
        SELECT
          ARRAY_AGG(DISTINCT region IGNORE NULLS ORDER BY region) AS regions,
          ARRAY_AGG(DISTINCT pathogen IGNORE NULLS ORDER BY pathogen) AS pathogens,
          ARRAY_AGG(DISTINCT antibiotic IGNORE NULLS ORDER BY antibiotic) AS antibiotics,
          ARRAY_AGG(DISTINCT specimen IGNORE NULLS ORDER BY specimen) AS specimens,
          ARRAY_AGG(DISTINCT infection_type IGNORE NULLS ORDER BY infection_type) AS infection_types
        FROM {_TBL}
    """)
    return ok(rows[0] if rows else {})


@router.get("/summary")
def summary(
    region: Optional[str] = None,
    pathogen: Optional[str] = None,
    antibiotic: Optional[str] = None,
    specimen: Optional[str] = None,
):
    conds, params = _filters(region, pathogen, antibiotic, specimen)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    rows = bq.query(f"""
        SELECT
          COUNT(*) AS isolates,
          COUNTIF(interpretation='R') AS resistant,
          COUNTIF(interpretation='I') AS intermediate,
          COUNTIF(interpretation='S') AS susceptible,
          ROUND(SAFE_DIVIDE(COUNTIF(interpretation='R'), COUNT(*))*100, 1) AS resistance_pct,
          COUNT(DISTINCT pathogen) AS pathogens,
          COUNT(DISTINCT antibiotic) AS antibiotics,
          COUNT(DISTINCT region) AS regions,
          MIN(collection_date) AS earliest,
          MAX(collection_date) AS latest
        FROM {_TBL} {where}
    """, params)
    return ok(rows[0] if rows else {})


@router.get("/matrix")
def matrix(region: Optional[str] = None, specimen: Optional[str] = None):
    conds, params = _filters(region, None, None, specimen)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    rows = bq.query(f"""
        SELECT pathogen, antibiotic,
               COUNT(*) AS n,
               ROUND(SAFE_DIVIDE(COUNTIF(interpretation='R'), COUNT(*))*100, 1) AS resistance_pct
        FROM {_TBL} {where}
        GROUP BY 1, 2
        ORDER BY 1, 2
    """, params)
    return ok(rows, count=len(rows))


@router.get("/trend")
def trend(
    pathogen: str = Query(...),
    antibiotic: str = Query(...),
    region: Optional[str] = None,
):
    conds = ["pathogen = @pathogen", "antibiotic = @antibiotic"]
    params = [
        bigquery.ScalarQueryParameter("pathogen", "STRING", pathogen),
        bigquery.ScalarQueryParameter("antibiotic", "STRING", antibiotic),
    ]
    if region and region != "ALL":
        conds.append("region = @region")
        params.append(bigquery.ScalarQueryParameter("region", "STRING", region))
    rows = bq.query(f"""
        SELECT month,
               SUM(isolates_tested) AS isolates_tested,
               ROUND(SAFE_DIVIDE(SUM(resistant_count), SUM(isolates_tested))*100, 1) AS resistance_pct,
               ROUND(AVG(mic90), 3) AS mic90
        FROM {_VIEW}
        WHERE {" AND ".join(conds)}
        GROUP BY month
        ORDER BY month
    """, params)
    return ok(rows, count=len(rows))
