# Container image for the AMR Resilience API (Cloud Run service).
# Cloud Run / Cloud Build picks this up automatically with `gcloud run deploy --source .`
#
# Python 3.13 to match the project's requirements.txt (numpy/pandas need >=3.12).
# Chromium is added so the admin "trigger GLASS scrape" action works in-API.
FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# minimal OS deps; Playwright pulls the rest via `install --with-deps`
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    python -m playwright install --with-deps chromium

COPY backend ./backend

ENV PORT=8080
EXPOSE 8080

CMD exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT} --workers 1
