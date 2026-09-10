"""
Authentication: password hashing (PBKDF2, stdlib) + HMAC-signed bearer tokens.

This is intentionally dependency-free. It is real enough for hospital-staff
login (hashed credentials, signed expiring tokens, server-side verification) but
a production deployment should move to a managed IdP / rotated asymmetric keys.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from datetime import datetime as _dt, timezone as _tz
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from backend.database.bigquery_client import BigQueryClient

_SECRET = (os.getenv("AUTH_SECRET") or "amr-resilience-dev-secret-change-me").encode()
_TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL", str(8 * 3600)))
_PBKDF2_ROUNDS = 120_000


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(password: str, salt: Optional[str] = None) -> Dict[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    return {"salt": salt, "password_hash": digest.hex()}


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    return hmac.compare_digest(digest.hex(), expected_hash)


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------
def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def issue_token(claims: Dict[str, Any]) -> Dict[str, Any]:
    payload = {**claims, "iat": int(time.time()), "exp": int(time.time()) + _TOKEN_TTL_SECONDS}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64e(hmac.new(_SECRET, body.encode(), hashlib.sha256).digest())
    return {"token": f"{body}.{sig}", "expires_at": payload["exp"]}


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = _b64e(hmac.new(_SECRET, body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64d(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


# ---------------------------------------------------------------------------
# User store (BigQuery: hospital_users)
# ---------------------------------------------------------------------------
class UserStore:
    def __init__(self, bq: Optional[BigQueryClient] = None):
        self.bq = bq or BigQueryClient()

    def find_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        sql = f"""
            SELECT user_id, username, full_name, role, department_code, hospital_id,
                   password_hash, password_salt, is_active
            FROM {self.bq.table('hospital_users')}
            WHERE LOWER(username) = LOWER(@username) AND is_active = TRUE
            LIMIT 1
        """
        params = [bigquery.ScalarQueryParameter("username", "STRING", username)]
        rows = self.bq.query(sql, params)
        return rows[0] if rows else None

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        user = self.find_by_username(username)
        if not user:
            return None
        if not verify_password(password, user["password_salt"], user["password_hash"]):
            return None
        return user

    # ------------------------------------------------------------------
    # Administration (create / edit / deactivate staff accounts)
    # ------------------------------------------------------------------
    VALID_ROLES = {
        "chief_pharmacist", "pharmacist", "attending_physician",
        "department_staff", "admin",
    }
    _USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,40}$")

    def list_users(self) -> List[Dict[str, Any]]:
        return self.bq.query(f"""
            SELECT user_id, username, full_name, role, department_code, hospital_id,
                   is_active, created_at
            FROM {self.bq.table('hospital_users')}
            ORDER BY is_active DESC, LOWER(full_name)
        """)

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        rows = self.bq.query(
            f"""SELECT user_id, username, full_name, role, department_code, hospital_id,
                       is_active, created_at
                FROM {self.bq.table('hospital_users')} WHERE user_id = @id LIMIT 1""",
            [bigquery.ScalarQueryParameter("id", "STRING", user_id)],
        )
        return rows[0] if rows else None

    def _username_taken(self, username: str, exclude_id: Optional[str] = None) -> bool:
        rows = self.bq.query(
            f"""SELECT user_id FROM {self.bq.table('hospital_users')}
                WHERE LOWER(username) = LOWER(@u)""",
            [bigquery.ScalarQueryParameter("u", "STRING", username)],
        )
        return any(r["user_id"] != exclude_id for r in rows)

    def create_user(self, *, username: str, full_name: str, role: str,
                    password: str, department_code: Optional[str] = None,
                    hospital_id: str = "H001") -> Dict[str, Any]:
        username = username.strip()
        if not self._USERNAME_RE.match(username):
            raise ValueError("Username must be 3-40 chars: letters, digits, . _ -")
        if role not in self.VALID_ROLES:
            raise ValueError(f"Unknown role '{role}'.")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if self._username_taken(username):
            raise ValueError(f"Username '{username}' is already in use.")
        h = hash_password(password)
        row = {
            "user_id": f"USR-{uuid.uuid4().hex[:12]}",
            "username": username,
            "full_name": full_name.strip() or username,
            "role": role,
            "department_code": (department_code or None),
            "hospital_id": hospital_id or "H001",
            "password_hash": h["password_hash"],
            "password_salt": h["salt"],
            "is_active": True,
            "created_at": _dt.now(_tz.utc).isoformat(),
        }
        # load job (not streaming) so the row is immediately UPDATE-able
        self.bq.load_rows("hospital_users", [row])
        return {k: v for k, v in row.items() if k not in ("password_hash", "password_salt")}

    def update_user(self, user_id: str, *, full_name: Optional[str] = None,
                    role: Optional[str] = None, department_code: Optional[str] = None,
                    is_active: Optional[bool] = None,
                    new_password: Optional[str] = None) -> Dict[str, Any]:
        if not self.get_user(user_id):
            raise LookupError("User not found.")
        sets, params = [], [bigquery.ScalarQueryParameter("id", "STRING", user_id)]
        if full_name is not None:
            sets.append("full_name = @full_name")
            params.append(bigquery.ScalarQueryParameter("full_name", "STRING", full_name.strip()))
        if role is not None:
            if role not in self.VALID_ROLES:
                raise ValueError(f"Unknown role '{role}'.")
            sets.append("role = @role")
            params.append(bigquery.ScalarQueryParameter("role", "STRING", role))
        if department_code is not None:
            sets.append("department_code = @dept")
            params.append(bigquery.ScalarQueryParameter("dept", "STRING", department_code or None))
        if is_active is not None:
            sets.append("is_active = @active")
            params.append(bigquery.ScalarQueryParameter("active", "BOOL", is_active))
        if new_password is not None:
            if len(new_password) < 8:
                raise ValueError("Password must be at least 8 characters.")
            h = hash_password(new_password)
            sets.append("password_hash = @ph")
            sets.append("password_salt = @ps")
            params.append(bigquery.ScalarQueryParameter("ph", "STRING", h["password_hash"]))
            params.append(bigquery.ScalarQueryParameter("ps", "STRING", h["salt"]))
        if not sets:
            return self.get_user(user_id)
        self.bq.query(
            f"UPDATE {self.bq.table('hospital_users')} SET {', '.join(sets)} WHERE user_id = @id",
            params,
        )
        return self.get_user(user_id)

    def set_password_by_username(self, username: str, new_password: str) -> bool:
        if len(new_password) < 8:
            raise ValueError("Password must be at least 8 characters.")
        h = hash_password(new_password)
        self.bq.query(
            f"""UPDATE {self.bq.table('hospital_users')}
                SET password_hash = @ph, password_salt = @ps
                WHERE LOWER(username) = LOWER(@u)""",
            [
                bigquery.ScalarQueryParameter("ph", "STRING", h["password_hash"]),
                bigquery.ScalarQueryParameter("ps", "STRING", h["salt"]),
                bigquery.ScalarQueryParameter("u", "STRING", username),
            ],
        )
        return True
