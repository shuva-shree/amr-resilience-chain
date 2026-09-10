-- Migration 011: Hospital staff user accounts (for login / RBAC)
-- Passwords are PBKDF2-SHA256; hashes are populated by backend.database.migrate --seed-users

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.hospital_users` (
  user_id          STRING NOT NULL,
  username         STRING NOT NULL,
  full_name        STRING NOT NULL,
  role             STRING NOT NULL,   -- chief_pharmacist | pharmacist | attending_physician | department_staff | admin
  department_code  STRING,
  hospital_id      STRING NOT NULL,
  password_hash    STRING NOT NULL,
  password_salt    STRING NOT NULL,
  is_active        BOOL DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
