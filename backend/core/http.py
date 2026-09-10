"""Shared HTTP concerns: response envelope, domain errors, identity dependency."""
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Header, Request
from fastapi.responses import JSONResponse


def ok(data: Any, count: Optional[int] = None, **extra: Any) -> dict:
    body = {"success": True, "data": data}
    if count is not None:
        body["count"] = count
    body.update(extra)
    return body


class DomainError(Exception):
    """Raised by services/routes for expected, user-safe failures."""

    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def domain_error_response(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "requestId": getattr(request.state, "request_id", None),
            },
        },
    )


def unhandled_error_response(request: Request, exc: Exception) -> JSONResponse:
    # Never leak stack traces / raw BigQuery errors to the UI.
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "The service encountered an unexpected error. Please try again.",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "requestId": getattr(request.state, "request_id", None),
            },
        },
    )


import os

# Trusted X-User-* header identity is a dev-only convenience and is OFF unless
# explicitly enabled. The frontend authenticates with bearer tokens.
_ALLOW_HEADER_AUTH = os.getenv("ALLOW_HEADER_AUTH", "false").lower() == "true"


class Identity:
    def __init__(
        self,
        user_id: str,
        role: str,
        department_code: str,
        hospital_id: str,
        name: str = "",
        authenticated: bool = False,
    ):
        self.user_id = user_id
        self.role = role
        self.department_code = department_code
        self.hospital_id = hospital_id
        self.name = name
        self.authenticated = authenticated


def get_identity(
    authorization: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    x_department_code: Optional[str] = Header(None),
    x_hospital_id: Optional[str] = Header(None),
) -> Identity:
    """Resolve the acting operator.

    Preferred: `Authorization: Bearer <token>` from the login flow.
    Fallback (dev only, ALLOW_HEADER_AUTH): trusted X-User-* headers.

    Authorization (RBAC / regulatory policy) is always enforced server-side
    regardless of how identity was resolved.
    """
    if authorization and authorization.lower().startswith("bearer "):
        from backend.core.auth import decode_token

        claims = decode_token(authorization.split(" ", 1)[1].strip())
        if claims:
            return Identity(
                user_id=claims.get("sub", "unknown"),
                role=claims.get("role", "department_staff"),
                department_code=claims.get("dept", "PHARM"),
                hospital_id=claims.get("hospital", "H001"),
                name=claims.get("name", ""),
                authenticated=True,
            )
        raise DomainError("INVALID_TOKEN", "Your session has expired. Please sign in again.", 401)

    if _ALLOW_HEADER_AUTH and (x_user_id or x_user_role):
        return Identity(
            user_id=x_user_id or "USER-001",
            role=x_user_role or "pharmacist",
            department_code=x_department_code or "PHARM",
            hospital_id=x_hospital_id or "H001",
            authenticated=False,
        )

    raise DomainError("NOT_AUTHENTICATED", "Please sign in to continue.", 401)


from fastapi import Depends

ADMIN_ROLES = {"admin", "chief_pharmacist"}


def require_auth(identity: "Identity" = Depends(get_identity)) -> "Identity":
    if not identity.authenticated:
        raise DomainError("NOT_AUTHENTICATED", "Please sign in to perform this action.", 401)
    return identity


def require_admin(identity: "Identity" = Depends(get_identity)) -> "Identity":
    if not identity.authenticated:
        raise DomainError("NOT_AUTHENTICATED", "Please sign in to perform this action.", 401)
    if identity.role not in ADMIN_ROLES:
        raise DomainError("NOT_AUTHORIZED", "This action requires an administrator role.", 403)
    return identity


def new_request_id() -> str:
    return f"req-{uuid.uuid4().hex[:16]}"
