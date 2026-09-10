import pandas as pd
import numpy as np
import hashlib
import os

def clean_glass_data(file_path):
    # --- 1. Load data, skipping header metadata & discarding trailing irregular rows ---
    raw_df = pd.read_csv(file_path, skiprows=17, on_bad_lines='skip')
    
    # --- 2. Normalize raw column names to make mapping easier ---
    raw_df.columns = (
        raw_df.columns
        .str.strip()
        .str.lower()
        .str.replace(' ', '_')
        .str.replace('[^a-z0-9_]', '', regex=True)
    )
    
    # --- 3. Filter valid rows ---
    if 'year' not in raw_df.columns:
        raise KeyError("The column 'year' was not found. Check your input file structure.")
    df = raw_df[raw_df['year'].notna()].copy()
    
    # --- 4. Map columns to your exact SQL Target Schema ---
    final_df = pd.DataFrame()
    
    # Text Dimensions (Fixed: Uses bracket fallbacks to ensure pandas Series features work)
    final_df['country_code'] = df['iso3'].astype(str) if 'iso3' in df.columns else 'unknown'
    final_df['country'] = df['countryterritoryarea'].astype(str) if 'countryterritoryarea' in df.columns else 'unknown'
    final_df['who_region'] = df['whoregionname'].astype(str) if 'whoregionname' in df.columns else 'unknown'
    final_df['specimen'] = df['specimen'].astype(str) if 'specimen' in df.columns else 'unknown'
    final_df['pathogen'] = df['pathogenname'].astype(str) if 'pathogenname' in df.columns else 'unknown'
    final_df['antibiotic'] = df['abtargets'].astype(str) if 'abtargets' in df.columns else 'unknown'
    
    # Fill remaining explicit NaNs in text fields
    text_cols = ['country_code', 'country', 'who_region', 'specimen', 'pathogen', 'antibiotic']
    final_df[text_cols] = final_df[text_cols].fillna('unknown')
    
    # Time Dimension
    final_df['year'] = pd.to_numeric(df['year'], errors='coerce').fillna(0).astype(np.int64)
    
    # Numeric Metrics (Safely extract, handle nulls, and enforce exact SQL data types)
    final_df['total_specimen_isolates'] = pd.to_numeric(df['totalspecimenisolates'] if 'totalspecimenisolates' in df.columns else 0, errors='coerce').fillna(0).astype(np.int64)
    final_df['interpretable_ast'] = pd.to_numeric(df['interpretableast'] if 'interpretableast' in df.columns else 0, errors='coerce').fillna(0).astype(np.int64)
    final_df['resistant_count'] = pd.to_numeric(df['resistant'] if 'resistant' in df.columns else 0, errors='coerce').fillna(0).astype(np.int64)
    final_df['resistance_rate'] = pd.to_numeric(df['percentresistant'] if 'percentresistant' in df.columns else 0.0, errors='coerce').fillna(0.0).astype(float)
    
    # Metadata Auditing Field
    final_df['source'] = os.path.basename(file_path)
    
    # --- 5. Generate unique observation_id using target schema rows ---
    def generate_hash(row):
        unique_string = f"{row['country_code']}_{row['year']}_{row['specimen']}_{row['pathogen']}_{row['antibiotic']}"
        return hashlib.md5(unique_string.encode('utf-8')).hexdigest()
        
    final_df['observation_id'] = final_df.apply(generate_hash, axis=1)
    
    # Reorder columns to exactly match your SQL DDL definition order
    ordered_columns = [
        'observation_id', 'country_code', 'country', 'who_region', 'year',
        'specimen', 'pathogen', 'antibiotic', 'total_specimen_isolates',
        'interpretable_ast', 'resistant_count', 'resistance_rate', 'source'
    ]
    
    return final_df[ordered_columns]



# --- Run the cleaner and export ---
file_name = "Time series of resistance to antibiotics (2018-2023)_South-East Asia Region-BLOOD.csv"
cleaned_df = clean_glass_data("Time series of resistance to antibiotics (2018-2023)_South-East Asia Region-BLOOD.csv")

print("\nCleaned Data Schema:")
print(cleaned_df.dtypes)

print("\nCleaned Data Preview:")
print(cleaned_df.head())

# Optional: Export to a clean CSV ready for BigQuery upload
cleaned_df.to_csv("cleaned_glass_amr_observations.csv", index=False)
