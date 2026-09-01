# T-0016-1: one image that runs both roles render.yaml splits across two
# services -- the long-running API (App Runner) and the ingestion scripts
# (a scheduled ECS Fargate task), so they cannot drift apart in what they
# depend on. See docs/plan/EPIC-0016/T-0016-1-container-image.md's
# "Solution Approach" for the reasoning behind each choice below.

# ---- builder --------------------------------------------------------------
# python:3.10-slim (glibc): pandas/pyarrow/numpy ship manylinux wheels built
# against glibc, so nothing here needs to compile from source. Matches
# backend/.python-version and pyproject.toml's requires-python floor.
FROM python:3.10-slim AS builder

# Only needed if a transitive dependency lacks a wheel for this platform;
# multi-stage means it never reaches the runtime image regardless (AC6).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.11.7

WORKDIR /app

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy

# Dependency layer, cached on the lockfile alone (AC8): a source-only change
# below never invalidates this layer, so it never re-resolves or
# re-downloads pandas/pyarrow/numpy/uvicorn[standard]'s native wheels.
# --frozen fails the build rather than re-resolving if uv.lock is stale
# (AC4). --no-dev excludes the dev group (pytest) from /opt/venv entirely
# (AC6).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Application source. backend's pyproject.toml has no [build-system]
# (uv.lock: source = { virtual = "." }), so there is no package of its own
# to build -- this second sync is a fast no-op against an already-satisfied
# lock, not a reinstall.
COPY . .
RUN uv sync --frozen --no-dev

# Bakes in a small, deterministic, seeded synthetic panel (never real data,
# never copied from the host -- AC5) so load_panel's existing fallback
# (object storage unset -> serve mock, stay healthy, disclose synthetic)
# behaves identically on AWS to how it behaves today.
RUN /opt/venv/bin/python scripts/generate_mock_panel.py

# ---- runtime ----------------------------------------------------------
FROM python:3.10-slim AS runtime

# AC7: non-root. Created before COPY so --chown can target it directly.
RUN groupadd --system app \
    && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Only the built venv and application source cross the stage boundary --
# no compiler, no uv binary, no test source, no .git (AC6).
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=app:app /app/main.py ./main.py
COPY --from=builder --chown=app:app /app/api ./api
COPY --from=builder --chown=app:app /app/application ./application
COPY --from=builder --chown=app:app /app/core ./core
COPY --from=builder --chown=app:app /app/domain ./domain
COPY --from=builder --chown=app:app /app/infra ./infra
COPY --from=builder --chown=app:app /app/scripts ./scripts
COPY --from=builder --chown=app:app /app/data ./data

USER app

EXPOSE 8000

# AC2: $PORT is supplied by the platform (App Runner); shell-form CMD
# expands it at container start, with 8000 as a local-run fallback --
# mirrors render.yaml's startCommand. No ENTRYPOINT: `docker run <image>
# python scripts/<name>.py ...` replaces this CMD outright and runs the
# identical script against the identical venv and working directory as a
# local `uv run python scripts/<name>.py` (AC3).
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
