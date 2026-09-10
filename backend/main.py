
"""
FastAPI backend for the AMR Supply Chain Resilience application.

Single app, single BigQuery access layer, consistent `/api/v1` surface and a
consistent `{success, data}` / `{success, error}` response envelope.
"""
import logging
import os
from typing import Optional

try:
    from dotenv import load_dotenv

    load_dotenv("backend/.env")
    load_dotenv(".env")
except Exception:  # noqa: BLE001
    pass

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel

from backend.core.http import (
    DomainError,
    Identity,
    domain_error_response,
    new_request_id,
    ok,
    require_auth,
    unhandled_error_response,
)
from backend.routes import (
    allocations,
    amr_explorer,
    auth,
    dashboard,
    departments,
    governance,
    ingestion,
    inventory,
    recommendations,
    scenarios,
    supply_chain,
    vendor,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("amr.api")

app = FastAPI(
    title="AMR Supply Chain Resilience API",
    version="2.0.0",
    description="Hospital AMR resilience operations API (BigQuery-backed).",
)

# Browser origins allowed to call the API. Local dev origins are always allowed;
# add your deployed frontend URL(s) via CORS_ORIGINS (comma-separated).
_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
] + [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_request_context(request: Request, call_next):
    request.state.request_id = new_request_id()
    import time

    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
    response.headers["X-Request-Id"] = request.state.request_id
    logger.info(
        "%s %s -> %s (%sms) req=%s",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request.state.request_id,
    )
    return response


# --- Exception handlers: never leak internals to the UI --------------------
@app.exception_handler(DomainError)
async def _domain_error(request: Request, exc: DomainError):
    return domain_error_response(request, exc)


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, exc: StarletteHTTPException):
    return domain_error_response(
        request,
        DomainError(
            code="HTTP_ERROR" if exc.status_code != 404 else "NOT_FOUND",
            message=str(exc.detail) if exc.detail else "Request could not be completed.",
            status_code=exc.status_code,
        ),
    )


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError):
    return domain_error_response(
        request,
        DomainError("INVALID_REQUEST", "The request parameters are invalid.", 422),
    )


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    logger.exception("Unhandled error req=%s", getattr(request.state, "request_id", None))
    return unhandled_error_response(request, exc)


# --- Routers --------------------------------------------------------------
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(inventory.router)
app.include_router(allocations.router)
app.include_router(departments.router)
app.include_router(supply_chain.router)
app.include_router(governance.router)
app.include_router(scenarios.router)
app.include_router(recommendations.router)
app.include_router(amr_explorer.router)
app.include_router(ingestion.router)
app.include_router(vendor.router)


@app.get("/health")
@app.get("/api/v1/health")
def health():
    return ok({"status": "healthy", "system": "AMR Resilience Chain Operational Engine"})


# --- Multi-agent investigation (optional; imported lazily) ----------------
class AgentQueryRequest(BaseModel):
    user_prompt: str
    hospital_id: Optional[str] = "H001"
    antibiotic_id: Optional[str] = "ANT-MERO"
    role: Optional[str] = "hospital_staff"


@app.post("/api/v1/agents/orchestrate")
def orchestrate_agents(payload: AgentQueryRequest, identity: Identity = Depends(require_auth)):
    try:
        from backend.agents.agent_system import multi_agent_system
    except Exception as exc:  # noqa: BLE001
        raise DomainError(
            "AGENTS_UNAVAILABLE",
            "The investigation agent service is not configured in this environment.",
            503,
        ) from exc
    try:
        result = multi_agent_system.run_investigation(
            user_prompt=payload.user_prompt,
            hospital_id=payload.hospital_id,
            antibiotic=payload.antibiotic_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise DomainError("AGENT_RUN_FAILED", "The investigation could not be completed.", 502) from exc
    return ok(result)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
