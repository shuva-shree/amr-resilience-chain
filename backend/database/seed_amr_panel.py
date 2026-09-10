"""
Seed the *operational* demo data for the full critical-antibiotic panel.

Before this, only ANT-MERO had inventory / usage / resistance / supplier /
supply-graph / purchase-order history, so every screen except Meropenem looked
empty. This backfills 12 months (calendar 2024) of statistically-shaped data for
the other six formulary antibiotics so the whole UI has something to show.

Tables populated (H001 only):
  antibiotic_inventory, antibiotic_use, amr_observations,
  supplier_antibiotics, supply_edges, purchase_orders

It is idempotent: every run first deletes the rows it owns (the six panel
antibiotic_ids, never ANT-MERO) and re-inserts them via load jobs.

Also performs two data-hygiene fixes:
  * removes the bogus `ANT-CEFE` antibiotic_id from supply_edges
    (Ceftriaxone is ANT-CIFT in the catalog)
  * backfills antibiotic_id / pathogen_id on hospital-ingested amr_isolates
    rows that were stored with names only

Run:  python -m backend.database.seed_amr_panel
      (or via  python -m backend.database.migrate --seed  / --seed-panel)
"""
from __future__ import annotations

import math
import random
from datetime import date

from backend.database.bigquery_client import bq_manager as bq

HOSPITAL = "H001"
MONTHS = [date(2024, m, 1) for m in range(1, 13)]

# antibiotic_id -> demo profile.  base_r/r_trend drive resistance; stock/consume
# drive inventory; ddd drives usage.  Deliberately varied so the panel shows a
# spread of risk levels.
PANEL = {
    "ANT-CIPR": dict(name="Ciprofloxacin", pathogen="PAT-EC", specimen="URINE",
                     base_r=0.42, r_trend=0.011, stock=1500, consume=46, ddd=520, dip=False),
    "ANT-CIFT": dict(name="Ceftriaxone", pathogen="PAT-EC", specimen="BLOOD",
                     base_r=0.55, r_trend=0.013, stock=2400, consume=92, ddd=910, dip=True),
    "ANT-PIPT": dict(name="Piperacillin-Tazobactam", pathogen="PAT-KP", specimen="BLOOD",
                     base_r=0.33, r_trend=0.009, stock=1850, consume=68, ddd=430, dip=False),
    "ANT-AMIK": dict(name="Amikacin", pathogen="PAT-KP", specimen="BLOOD",
                     base_r=0.12, r_trend=0.004, stock=950, consume=21, ddd=140, dip=False),
    "ANT-VANC": dict(name="Vancomycin", pathogen="PAT-SA", specimen="BLOOD",
                     base_r=0.17, r_trend=0.003, stock=1250, consume=38, ddd=300, dip=False),
    "ANT-COLI": dict(name="Colistin", pathogen="PAT-PA", specimen="BLOOD",
                     base_r=0.09, r_trend=0.006, stock=300, consume=9, ddd=60, dip=True),
}
PANEL_IDS = list(PANEL)

# supplier_antibiotics rows per panel antibiotic
SUPPLIERS = [
    ("SUP-001", "Bengaluru Pharma Distributors", 0.62, 3, 500, True),
    ("SUP-002", "South India Medical Supply", 0.26, 6, 500, False),
    ("SUP-003", "National Critical Care Pharma", 0.12, 10, 250, False),
]

# supply_edges shape (mirrors the ANT-MERO graph): (source, target, share, lead)
EDGES = [
    ("API_S1", "MFG_M1", 0.60, 18),
    ("API_S2", "MFG_M2", 0.40, 15),
    ("MFG_M1", "DIST_D1", 0.70, 4),
    ("MFG_M2", "DIST_D2", 0.30, 5),
    ("DIST_D1", HOSPITAL, 0.75, 2),
    ("DIST_D2", HOSPITAL, 0.25, 3),
]


def _rng(*parts) -> random.Random:
    return random.Random("|".join(str(p) for p in parts))


def _ym(d: date) -> str:
    return d.strftime("%Y%m")


def _build():
    inv, use, obs, sup, edges, pos = [], [], [], [], [], []

    for ant, p in PANEL.items():
        for supplier_id, mfg, share, lead, moq, is_primary in SUPPLIERS:
            sup.append({
                "supplier_id": supplier_id,
                "antibiotic_id": ant,
                "manufacturer_name": mfg,
                "lead_time_days": lead,
                "minimum_order_quantity": moq,
                "allocation_share": share,
                "is_primary_supplier": is_primary,
            })
        for src, tgt, sh, lt in EDGES:
            edges.append({
                "source_node_id": src, "target_node_id": tgt,
                "antibiotic_id": ant, "supply_share_pct": sh, "lead_time_days": lt,
            })

        for i, d in enumerate(MONTHS):
            r = _rng(ant, i)
            # --- usage ---
            ddd_rate = round(p["ddd"] * (1 + 0.12 * math.sin(i / 2) + r.uniform(-0.08, 0.08)), 2)
            patient_days = r.randint(1180, 1520)
            use.append({
                "usage_id": f"USE-{HOSPITAL}-{_ym(d)}-{ant}",
                "hospital_id": HOSPITAL,
                "usage_date": d.isoformat(),
                "antibiotic_id": ant,
                "antibiotic_name": p["name"],
                "defined_daily_doses_consumed": round(ddd_rate * patient_days / 1000, 2),
                "patient_days": patient_days,
                "ddd_per_1000_patient_days": ddd_rate,
            })

            # --- inventory ---
            daily = round(p["consume"] * (1 + 0.15 * math.sin(i / 2) + r.uniform(-0.1, 0.1)), 1)
            reorder = round(daily * 14)
            safety = round(daily * 7)
            factor = r.uniform(0.80, 1.15)
            # let "dip" antibiotics fall under the reorder point mid-year
            if p["dip"] and i in (5, 6, 7):
                factor = r.uniform(0.35, 0.65)
            qoh = round(p["stock"] * factor)
            inv.append({
                "inventory_id": f"INV-{HOSPITAL}-{_ym(d)}-{ant}",
                "hospital_id": HOSPITAL,
                "antibiotic_id": ant,
                "inventory_date": d.isoformat(),
                "quantity_on_hand": float(qoh),
                "unit": "VIALS",
                "reorder_point": float(reorder),
                "safety_stock": float(safety),
                "stockout_flag": qoh < safety,
                "daily_consumption": daily,
            })

            # --- resistance observation (primary pathogen) ---
            rate = p["base_r"] + p["r_trend"] * i + r.uniform(-0.03, 0.03)
            rate = round(min(0.95, max(0.02, rate)), 4)
            tested = r.randint(90, 130)
            path = p["pathogen"]
            short = {"PAT-EC": "EC", "PAT-KP": "KP", "PAT-SA": "SA", "PAT-PA": "PA"}[path]
            obs.append({
                "observation_id": f"OBS-{HOSPITAL}-{_ym(d)}-{short}-{ant}",
                "hospital_id": HOSPITAL,
                "observation_date": d.isoformat(),
                "pathogen_id": path,
                "antibiotic_id": ant,
                "specimen": p["specimen"],
                "tested_count": tested,
                "resistant_count": int(round(tested * rate)),
                "resistance_rate": rate,
                "glass_reference_id": None,
            })

        # --- purchase orders (3 per antibiotic across the year) ---
        for n, mon in enumerate((2, 6, 10), start=1):
            od = date(2024, mon, 3)
            dd = date(2024, mon, 3 + SUPPLIERS[n % 3][3])
            status = "DELIVERED" if mon <= 6 else ("IN_TRANSIT" if mon == 10 else "DELIVERED")
            qty = float(_rng(ant, "po", n).randint(3, 9) * 250)
            pos.append({
                "purchase_order_id": f"PO-{HOSPITAL}-{ant}-{n:02d}",
                "hospital_id": HOSPITAL,
                "supplier_id": SUPPLIERS[n % 3][0],
                "antibiotic_id": ant,
                "order_date": od.isoformat(),
                "expected_delivery_date": dd.isoformat(),
                "quantity_ordered": qty,
                "quantity_received": qty if status == "DELIVERED" else 0.0,
                "status": status,
            })

    return inv, use, obs, sup, edges, pos


def _delete_panel() -> None:
    ids = ", ".join(f"'{x}'" for x in PANEL_IDS)
    for tbl in ("antibiotic_inventory", "antibiotic_use", "amr_observations",
                "supplier_antibiotics", "supply_edges", "purchase_orders"):
        bq.query(f"DELETE FROM {bq.table(tbl)} WHERE antibiotic_id IN ({ids})")


def _hygiene() -> None:
    # bogus antibiotic_id in supply_edges (Ceftriaxone == ANT-CIFT)
    bq.query(f"DELETE FROM {bq.table('supply_edges')} WHERE antibiotic_id = 'ANT-CEFE'")
    # backfill ids on name-only hospital isolate rows
    bq.query(f"""
        UPDATE {bq.table('amr_isolates')} iso
        SET antibiotic_id = ab.antibiotic_id
        FROM {bq.table('antibiotics')} ab
        WHERE iso.antibiotic_id IS NULL
          AND LOWER(iso.antibiotic) = LOWER(ab.antibiotic_name)
    """)
    bq.query(f"""
        UPDATE {bq.table('amr_isolates')} iso
        SET pathogen_id = pa.pathogen_id
        FROM {bq.table('pathogens')} pa
        WHERE iso.pathogen_id IS NULL
          AND LOWER(iso.pathogen) = LOWER(pa.pathogen_name)
    """)


def run() -> dict:
    _delete_panel()
    inv, use, obs, sup, edges, pos = _build()
    bq.load_rows("antibiotic_inventory", inv)
    bq.load_rows("antibiotic_use", use)
    bq.load_rows("amr_observations", obs)
    bq.load_rows("supplier_antibiotics", sup)
    bq.load_rows("supply_edges", edges)
    bq.load_rows("purchase_orders", pos)
    _hygiene()
    out = {
        "antibiotics": PANEL_IDS,
        "antibiotic_inventory": len(inv),
        "antibiotic_use": len(use),
        "amr_observations": len(obs),
        "supplier_antibiotics": len(sup),
        "supply_edges": len(edges),
        "purchase_orders": len(pos),
    }
    return out


if __name__ == "__main__":
    import json

    print(json.dumps(run(), indent=2))
