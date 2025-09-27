# ---------- Stage 1: build wheels (faster, smaller runtime image) ----------
FROM python:3.11-slim AS builder

# Build deps for any packages that ship C extensions (uvicorn[standard], etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential gcc g++ libffi-dev libssl-dev curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

RUN python -m pip install --upgrade pip wheel setuptools && \
    pip wheel --no-cache-dir -r requirements.txt -w /wheels


# ---------- Stage 2: runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

# Non-root user + curl for healthcheck
RUN adduser --disabled-password --gecos "" appuser && \
    apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY --from=builder /wheels /wheels
COPY requirements.txt ./
RUN python -m pip install --no-index --find-links=/wheels -r requirements.txt && rm -rf /wheels

# Your FastAPI app
COPY app.py ./

EXPOSE 8080
USER appuser

# Container-level health check hits FastAPI /healthz
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8080/healthz || exit 1

CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8080","--workers","2","--timeout-keep-alive","5"]

