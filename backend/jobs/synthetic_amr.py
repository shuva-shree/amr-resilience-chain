"""
Module 4 — Synthetic AMR dataset expansion.

Generates statistically-grounded, isolate-level susceptibility records across a
panel of critical antibiotics and priority pathogens, with realistic MIC values,
R/I/S interpretation, specimen sites, patient demographics and region tags, then
loads them into BigQuery (`amr_isolates`).

Run:  python -m backend.jobs.synthetic_amr --months 24 --per-cell 40
"""
from __future__ import annotations

import argparse
import math
import random
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from backend.database.bigquery_client import BigQueryClient

# --------------------------------------------------------------------------
# Reference catalogue
# --------------------------------------------------------------------------
ANTIBIOTICS = {
    "ANT-MERO": ("Meropenem", "J01DH02", "Carbapenems", "WATCH", 3.0),
    "ANT-CIFT": ("Ceftriaxone", "J01DD04", "Cephalosporins (3rd gen)", "WATCH", 2.0),
    "ANT-CIPR": ("Ciprofloxacin", "J01MA02", "Fluoroquinolones", "WATCH", 1.0),
    "ANT-VANC": ("Vancomycin", "J01XA01", "Glycopeptides", "WATCH", 2.0),
    "ANT-COLI": ("Colistin", "J01XB01", "Polymyxins", "RESERVE", 0.009),
    "ANT-PIPT": ("Piperacillin-Tazobactam", "J01CR05", "Beta-lactam/BLI", "WATCH", 14.0),
    "ANT-AMIK": ("Amikacin", "J01GB06", "Aminoglycosides", "ACCESS", 1.0),
}

PATHOGENS = {
    "PAT-EC": ("Escherichia coli", "ECO", "gram_negative", "Enterobacterales", "Critical"),
    "PAT-KP": ("Klebsiella pneumoniae", "KPN", "gram_negative", "Enterobacterales", "Critical"),
    "PAT-SA": ("Staphylococcus aureus", "SAU", "gram_positive", "Staphylococcaceae", "High"),
    "PAT-PA": ("Pseudomonas aeruginosa", "PAE", "gram_negative", "Pseudomonadaceae", "Critical"),
}

# EUCAST-ish clinical breakpoints (mg/L): S <= low, R > high
BREAKPOINTS = {
    "ANT-MERO": (2.0, 8.0),
    "ANT-CIFT": (1.0, 2.0),
    "ANT-CIPR": (0.25, 0.5),
    "ANT-VANC": (2.0, 2.0),
    "ANT-COLI": (2.0, 2.0),
    "ANT-PIPT": (8.0, 16.0),
    "ANT-AMIK": (8.0, 16.0),
}

# Baseline resistance fraction per (pathogen, antibiotic) for a high-burden
# region. None => intrinsic resistance / not clinically tested -> skipped.
BASE_R = {
    "PAT-EC": {"ANT-CIPR": 0.66, "ANT-CIFT": 0.55, "ANT-PIPT": 0.28, "ANT-AMIK": 0.12, "ANT-MERO": 0.07, "ANT-COLI": 0.02},
    "PAT-KP": {"ANT-CIPR": 0.62, "ANT-CIFT": 0.63, "ANT-PIPT": 0.46, "ANT-AMIK": 0.27, "ANT-MERO": 0.34, "ANT-COLI": 0.11},
    "PAT-SA": {"ANT-CIPR": 0.38, "ANT-VANC": 0.02},
    "PAT-PA": {"ANT-CIPR": 0.30, "ANT-PIPT": 0.24, "ANT-AMIK": 0.19, "ANT-MERO": 0.22, "ANT-COLI": 0.05},
}

MECHANISM = {
    ("PAT-EC", "ANT-CIFT"): "ESBL", ("PAT-KP", "ANT-CIFT"): "ESBL",
    ("PAT-EC", "ANT-MERO"): "CRE", ("PAT-KP", "ANT-MERO"): "CRE",
    ("PAT-PA", "ANT-MERO"): "carbapenemase", ("PAT-SA", "ANT-CIPR"): "MRSA-associated",
    ("PAT-SA", "ANT-VANC"): "VISA/VRSA",
}

REGIONS = {
    # region: (who_region, country, resistance multiplier)
    "South-East Asia": ("South-East Asia", "India", 1.00),
    "Africa": ("Africa", "Nigeria", 1.08),
    "Eastern Mediterranean": ("Eastern Mediterranean", "Egypt", 1.02),
    "Americas": ("Americas", "Brazil", 0.72),
    "Europe": ("Europe", "Germany", 0.42),
    "Western Pacific": ("Western Pacific", "Philippines", 0.82),
}
REGION_WEIGHTS = [0.34, 0.14, 0.12, 0.14, 0.14, 0.12]

INFECTIONS = {
    # infection_type: (specimen, weight)
    "BSI": ("blood", 0.34),
    "UTI": ("urine", 0.30),
    "LRTI": ("sputum", 0.20),
    "SSTI": ("wound", 0.11),
    "Meningitis": ("csf", 0.05),
}

AGE_GROUPS = (("0-4", 0.12), ("5-17", 0.10), ("18-64", 0.53), ("65+", 0.25))
SETTINGS = (("inpatient", 0.55), ("ICU", 0.18), ("outpatient", 0.27))


def _pick(weighted):
    keys = [k for k, _ in weighted]
    weights = [w for _, w in weighted]
    return random.choices(keys, weights=weights, k=1)[0]


def _mic_for(antibiotic_id: str, interp: str) -> float:
    low, high = BREAKPOINTS[antibiotic_id]
    if interp == "S":
        # log-uniform below the susceptible breakpoint
        return round(math.exp(random.uniform(math.log(low / 32), math.log(low))), 3)
    if interp == "I":
        lo, hi = math.log(low), math.log(max(high, low * 2))
        return round(math.exp(random.uniform(lo, hi)), 3)
    # R: above the resistant breakpoint, lognormal tail
    return round(high * math.exp(abs(random.gauss(0.7, 0.9))), 3)


def _interpretation(prob_r: float) -> str:
    r = random.random()
    if r < prob_r:
        return "R"
    if r < prob_r + 0.06:  # small intermediate band
        return "I"
    return "S"


def generate(months: int = 24, per_cell: int = 40, seed: Optional[int] = None) -> List[Dict[str, Any]]:
    if seed is not None:
        random.seed(seed)
    batch_id = f"SYN-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}"
    today = date.today()
    start_month = today.replace(day=1) - timedelta(days=30 * (months - 1))
    rows: List[Dict[str, Any]] = []

    for m in range(months):
        month_date = (start_month + timedelta(days=32 * m)).replace(day=1)
        drift = 1.0 + 0.004 * m + random.uniform(-0.03, 0.03)  # slow upward creep + noise
        for pid, (pname, *_ ) in PATHOGENS.items():
            for abx_id, base in BASE_R.get(pid, {}).items():
                aname = ANTIBIOTICS[abx_id][0]
                for _ in range(per_cell):
                    region = random.choices(list(REGIONS), weights=REGION_WEIGHTS, k=1)[0]
                    who_region, country, region_mult = REGIONS[region]
                    prob_r = min(0.98, max(0.0, base * drift * region_mult * random.uniform(0.85, 1.15)))
                    interp = _interpretation(prob_r)
                    infection = _pick([(k, v[1]) for k, v in INFECTIONS.items()])
                    specimen = INFECTIONS[infection][0]
                    day = random.randint(1, 27)
                    coll = date(month_date.year, month_date.month, day)
                    rows.append({
                        "isolate_id": f"ISO-{uuid.uuid4().hex[:14]}",
                        "data_source": "synthetic",
                        "batch_id": batch_id,
                        "hospital_id": "H001" if region == "South-East Asia" and random.random() < 0.4 else None,
                        "region": region,
                        "who_region": who_region,
                        "country": country,
                        "collection_date": coll.isoformat(),
                        "specimen": specimen,
                        "infection_type": infection,
                        "pathogen": pname,
                        "pathogen_id": pid,
                        "antibiotic": aname,
                        "antibiotic_id": abx_id,
                        "mic_value": _mic_for(abx_id, interp),
                        "mic_unit": "mg/L",
                        "interpretation": interp,
                        "resistance_mechanism": MECHANISM.get((pid, abx_id), "none") if interp == "R" else "none",
                        "patient_age_group": _pick(AGE_GROUPS),
                        "patient_sex": random.choices(["F", "M", "U"], weights=[0.48, 0.48, 0.04], k=1)[0],
                        "patient_setting": _pick(SETTINGS),
                    })
    return rows


# --------------------------------------------------------------------------
# Load
# --------------------------------------------------------------------------
def _ensure_reference(bq: BigQueryClient) -> None:
    existing_abx = {r["antibiotic_id"] for r in bq.query(f"SELECT antibiotic_id FROM {bq.table('antibiotics')}")}
    new_abx = []
    for aid, (name, atc, klass, aware, ddd) in ANTIBIOTICS.items():
        if aid not in existing_abx:
            new_abx.append({
                "antibiotic_id": aid, "antibiotic_name": name, "atc_code": atc, "drug_class": klass,
                "aware_category": aware, "defined_daily_dose_g": ddd, "route_of_admin": "PARENTERAL",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    if new_abx:
        bq.client.insert_rows_json(f"{bq.project_id}.{bq.dataset_id}.antibiotics", new_abx)

    existing_pat = {r["pathogen_id"] for r in bq.query(f"SELECT pathogen_id FROM {bq.table('pathogens')}")}
    new_pat = []
    for pid, (name, short, gram, family, priority) in PATHOGENS.items():
        if pid not in existing_pat:
            new_pat.append({
                "pathogen_id": pid, "pathogen_name": name, "short_code": short,
                "gram_stain": gram, "genus": name.split()[0], "species": name.split()[-1],
                "who_priority_level": priority, "is_glass_target": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    if new_pat:
        bq.client.insert_rows_json(f"{bq.project_id}.{bq.dataset_id}.pathogens", new_pat)


def load(rows: List[Dict[str, Any]], bq: Optional[BigQueryClient] = None, replace_synthetic: bool = True) -> Dict[str, Any]:
    bq = bq or BigQueryClient()
    _ensure_reference(bq)
    table = f"{bq.project_id}.{bq.dataset_id}.amr_isolates"

    if replace_synthetic:
        bq.client.query(f"DELETE FROM `{table}` WHERE data_source = 'synthetic'").result()

    inserted = 0
    for i in range(0, len(rows), 2000):
        chunk = rows[i:i + 2000]
        errs = bq.client.insert_rows_json(table, chunk)
        if errs:
            raise RuntimeError(f"insert error at chunk {i}: {errs[:2]}")
        inserted += len(chunk)
    return {"batch_id": rows[0]["batch_id"] if rows else None, "inserted": inserted}


def run(months: int = 24, per_cell: int = 40, seed: Optional[int] = 42) -> Dict[str, Any]:
    rows = generate(months=months, per_cell=per_cell, seed=seed)
    result = load(rows)
    return {"status": "success", "rows_generated": len(rows), **result}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=24)
    ap.add_argument("--per-cell", type=int, default=40)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    out = run(months=args.months, per_cell=args.per_cell, seed=args.seed)
    print(out)
