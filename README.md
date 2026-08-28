# RunNx

Tracks samples, SMRT cells, and sequencing runs for the Revio SPRQ-Nx multi-use workflow: import completed samples from Benchling/Google Sheets exports, schedule them onto cells/instruments without barcode clashes, and track real-world outcomes through to history.

See `docs/revio-nx-planner.html` for the original planning-only prototype this replaces (kept as the ground-truth reference the engine and design system were ported from). Scheduling rules are documented in `docs/pacbio-sprq-nx-scheduling-reference.md`, which maps this app's constraints onto the vendor's PacBio Revio/SPRQ-Nx documentation.

## Stack

- **Backend**: FastAPI + SQLAlchemy 2 + Alembic + Pydantic, Python 3.14+. PostgreSQL in production; SQLite by default for local runs.
- **Frontend**: React 19 + TypeScript + Vite 5, plain CSS Modules (no Tailwind/UI kit) ported from the prototype's design system.
- **Deployment**: Docker Compose (nginx-served frontend + FastAPI backend + Postgres 16). nginx serves the built static frontend and reverse-proxies `/api` to the backend, so browser traffic is same-origin.

## Architecture

Three containers, defined in `docker-compose.yml`:

```
browser ──▶ frontend (nginx :8080)
                 ├── static SPA  (/)
                 └── /api/  ──proxy──▶ backend (FastAPI :8000) ──▶ db (Postgres :5432)
```

- The frontend nginx proxies `/api/` to the backend, so the app is served from a single origin — no CORS needed in the default deployment (`frontend/nginx.conf`).
- The backend runs `alembic upgrade head` on startup (`backend/Dockerfile`), which migrates the schema and seeds the four Revio instruments (`84047` / `84098` / `84093` / `84309`).
- Health check: `GET /api/health` returns `{"status": "ok"}` — use this for load-balancer / monitoring probes.
- Interactive API docs (Swagger UI) are served at `/docs` on the backend.

## Running with Docker (production-shaped)

```
cp .env.example .env          # set Postgres credentials before first start
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend API docs: http://localhost:8000/docs

The `.env` step is required: `docker-compose.yml` substitutes `${POSTGRES_USER}` / `${POSTGRES_PASSWORD}` / `${POSTGRES_DB}` into both the `db` and `backend` services. Never commit the real `.env`.

## Configuration

All configuration is via environment variables — there are no config files to edit.

| Variable | Read by | Default | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Compose (`db` + `backend`) | — (set in `.env`) | Postgres credentials. The backend's `DATABASE_URL` is composed from these in `docker-compose.yml`. |
| `DATABASE_URL` | backend | `sqlite:///./dev.db` | SQLAlchemy connection string. Compose overrides it to the `db` service; only set it directly for a non-Docker or external-database deployment. |
| `CORS_ORIGINS` | backend | `""` (same-origin only) | Comma-separated allowed origins. Leave empty for the default nginx same-origin deployment; set it only if the frontend is served from a different origin than the API. |

| Port | Service | Notes |
| --- | --- | --- |
| `8080` | frontend (nginx) | Published; host `8080` → container `80`. The published port is `8080` rather than `80` because the reference deploy host already runs another service on `80`. |
| `8000` | backend (uvicorn) | Published; API + `/docs`. |
| `5432` | db (Postgres) | Internal to the Compose network — not published to the host. |

## Local development

**Hybrid (fastest iteration):**
```
docker compose up db backend
cd frontend && npm install && npm run dev
```
Vite's dev server proxies `/api` to `localhost:8000` (see `vite.config.ts`), so the app code never branches on environment.

**Fully containerized (no local Node needed):**
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```
Frontend dev server: http://localhost:5173

**Backend only, without Docker (defaults to a local SQLite file):**
```
cd backend
python -m venv .venv && .venv/Scripts/activate   # or: source .venv/bin/activate on macOS/Linux
pip install -e ".[dev]"
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

`pip install -e ".[dev]"` resolves the pyproject ranges (fine for local dev). CI and the Docker image instead install the pinned, hash-verified `backend/requirements.txt` / `requirements-dev.txt`. `pyproject.toml` holds the ranges; after changing a backend dependency, regenerate the locks with [pip-tools](https://github.com/jazzband/pip-tools) — install `pip-tools` and re-run the `pip-compile` command printed at the top of each file (on Python 3.14, so the pins match the target), or `make lock` from `backend/` if you have GNU make — then commit them with the pyproject edit.

## Tests & CI

```
cd backend && pytest                              # unit + integration suite
cd frontend && npm run typecheck && npm run build && npm run test
```

`.github/workflows/ci.yml` runs both suites on every push and pull request. Integration tests use in-memory SQLite (see `tests/integration/conftest.py`), so no Postgres service is needed in CI.

The backend's `tests/unit` suite is a golden-fixture parity check against the original prototype's example data and default settings — see `tests/fixtures/example_samples.csv` and the "porting the algorithms" notes in the engine modules.

## Security & operational notes

These are known, deliberate gaps for the current internal-use stage — flagged here for integration review, not oversights to work around silently.

- **No authentication.** Intentional for v1 (internal-network trust only). Every mutating endpoint takes an optional `actor` field, and a single `get_actor()` dependency is the seam for adding real auth later.
- **No TLS/HTTPS.** The app serves plain HTTP. Terminate TLS at an upstream reverse proxy and/or keep it on a trusted internal network; do not expose it directly to untrusted networks.
- **Developer/admin tools are ungated.** The **Settings → Developer tools** section (and its `backend/app/api/admin.py` router) can inspect and mutate the database directly, bypassing all service-layer validation. It is not restricted by environment or auth. **Remove or gate it before any real production launch** (add an `environment` flag to `backend/app/config.py`, conditionally include the router in `main.py`, and conditionally render the frontend section).
- **Data persistence & backup.** Postgres data lives in the `dbdata` named Docker volume. Back this volume up; removing it (`docker compose down -v`) permanently destroys all data.
- **No live Benchling API integration.** Sample import is manual CSV paste/upload, matching the original prototype's workflow.
