"""Login / session / user-administration endpoints for hospital staff."""
import time
from collections import defaultdict
from threading import Lock
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from backend.core.auth import UserStore, issue_token, verify_password
from backend.core.http import DomainError, Identity, get_identity, ok, require_admin, require_auth

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_ROLE_LABELS = {
    "chief_pharmacist": "Chief Pharmacist",
    "pharmacist": "Pharmacist",
    "attending_physician": "Attending Physician",
    "department_staff": "Department Staff",
    "admin": "Administrator",
}

# ---------------------------------------------------------------------------
# Login rate limiting (in-memory, per instance — good enough for a small pilot;
# move to a shared store if you scale past a couple of instances).
# ---------------------------------------------------------------------------
_MAX_FAILS = 5
_WINDOW_SECONDS = 15 * 60
_fails: Dict[str, List[float]] = defaultdict(list)
_fails_lock = Lock()


def _rl_key(username: str, request: Request) -> str:
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (request.client.host if request.client else "?"))
    return f"{username.lower()}|{ip}"


def _check_rate_limit(key: str) -> None:
    now = time.time()
    with _fails_lock:
        hits = [t for t in _fails.get(key, []) if now - t < _WINDOW_SECONDS]
        _fails[key] = hits
        if len(hits) >= _MAX_FAILS:
            retry = int(_WINDOW_SECONDS - (now - hits[0]))
            raise DomainError(
                "TOO_MANY_ATTEMPTS",
                f"Too many failed sign-in attempts. Try again in {max(1, retry // 60)} minute(s).",
                429,
            )


def _record_fail(key: str) -> None:
    with _fails_lock:
        _fails[key].append(time.time())


def _clear_fails(key: str) -> None:
    with _fails_lock:
        _fails.pop(key, None)


class LoginRequest(BaseModel):
    username: str
    password: str


def _profile(user: dict) -> dict:
    return {
        "userId": user["user_id"],
        "username": user["username"],
        "name": user["full_name"],
        "role": user["role"],
        "roleLabel": _ROLE_LABELS.get(user["role"], user["role"]),
        "departmentCode": user.get("department_code") or "PHARM",
        "hospitalId": user["hospital_id"],
    }


@router.post("/login")
def login(payload: LoginRequest, request: Request):
    username = payload.username.strip()
    key = _rl_key(username, request)
    _check_rate_limit(key)
    user = UserStore().authenticate(username, payload.password)
    if not user:
        _record_fail(key)
        raise DomainError("INVALID_CREDENTIALS", "Incorrect username or password.", 401)
    _clear_fails(key)
    token = issue_token({
        "sub": user["user_id"],
        "name": user["full_name"],
        "role": user["role"],
        "dept": user.get("department_code") or "PHARM",
        "hospital": user["hospital_id"],
    })
    return ok({"token": token["token"], "expiresAt": token["expires_at"], "user": _profile(user)})


@router.get("/me")
def me(identity: Identity = Depends(get_identity)):
    if not identity.authenticated:
        raise DomainError("NOT_AUTHENTICATED", "Not signed in.", 401)
    return ok({
        "userId": identity.user_id,
        "name": identity.name,
        "role": identity.role,
        "roleLabel": _ROLE_LABELS.get(identity.role, identity.role),
        "departmentCode": identity.department_code,
        "hospitalId": identity.hospital_id,
    })


# ---------------------------------------------------------------------------
# Self-service: change my own password
# ---------------------------------------------------------------------------
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(payload: ChangePasswordRequest, identity: Identity = Depends(require_auth)):
    store = UserStore()
    row = store.get_user(identity.user_id)  # identity.user_id is the user_id claim
    if not row:
        raise DomainError("NOT_FOUND", "Account not found.", 404)
    full = store.find_by_username(row["username"])
    if not full or not verify_password(payload.current_password, full["password_salt"], full["password_hash"]):
        raise DomainError("INVALID_CREDENTIALS", "Your current password is incorrect.", 400)
    try:
        store.set_password_by_username(row["username"], payload.new_password)
    except ValueError as e:
        raise DomainError("INVALID_REQUEST", str(e), 400) from e
    return ok({"changed": True})


# ---------------------------------------------------------------------------
# Admin: manage staff accounts
# ---------------------------------------------------------------------------
def _user_dto(u: dict) -> dict:
    return {
        "userId": u["user_id"],
        "username": u["username"],
        "fullName": u["full_name"],
        "role": u["role"],
        "roleLabel": _ROLE_LABELS.get(u["role"], u["role"]),
        "departmentCode": u.get("department_code"),
        "hospitalId": u["hospital_id"],
        "isActive": bool(u.get("is_active")),
        "createdAt": u.get("created_at"),
    }


@router.get("/roles")
def roles(identity: Identity = Depends(require_admin)):
    return ok([{"value": r, "label": _ROLE_LABELS[r]} for r in sorted(UserStore.VALID_ROLES)])


@router.get("/users")
def list_users(identity: Identity = Depends(require_admin)):
    rows = [_user_dto(u) for u in UserStore().list_users()]
    return ok(rows, count=len(rows))


class CreateUserRequest(BaseModel):
    username: str
    full_name: str
    role: str
    password: str
    department_code: Optional[str] = None
    hospital_id: str = "H001"


@router.post("/users", status_code=201)
def create_user(payload: CreateUserRequest, identity: Identity = Depends(require_admin)):
    try:
        created = UserStore().create_user(
            username=payload.username, full_name=payload.full_name, role=payload.role,
            password=payload.password, department_code=payload.department_code,
            hospital_id=payload.hospital_id,
        )
    except ValueError as e:
        raise DomainError("INVALID_REQUEST", str(e), 400) from e
    return ok(_user_dto(created))


class UpdateUserRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    department_code: Optional[str] = None
    is_active: Optional[bool] = None
    new_password: Optional[str] = None


@router.patch("/users/{user_id}")
def update_user(user_id: str, payload: UpdateUserRequest, identity: Identity = Depends(require_admin)):
    if user_id == identity.user_id and payload.is_active is False:
        raise DomainError("INVALID_REQUEST", "You cannot deactivate your own account.", 400)
    try:
        updated = UserStore().update_user(
            user_id,
            full_name=payload.full_name, role=payload.role,
            department_code=payload.department_code, is_active=payload.is_active,
            new_password=payload.new_password,
        )
    except LookupError as e:
        raise DomainError("NOT_FOUND", str(e), 404) from e
    except ValueError as e:
        raise DomainError("INVALID_REQUEST", str(e), 400) from e
    return ok(_user_dto(updated))
