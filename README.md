# Revio SPRQ-Nx LIMS

Tracks samples, SMRT cells, and sequencing runs for the Revio SPRQ-Nx multi-use workflow: import completed samples from Benchling/Google Sheets exports, schedule them onto cells/instruments without barcode clashes, and track real-world outcomes through to history.

See `revio-nx-planner.html` for the original planning-only prototype this replaces, and the plan this was built from for full architecture rationale.

## Stack

- **Backend**: FastAPI + SQLAlchemy + Alembic, PostgreSQL in Docker (SQLite works for quick local runs).
- **Frontend**: React + TypeScript + Vite, plain CSS Modules (no Tailwind/UI kit) ported from the prototype's design system.
- **Deployment**: Docker Compose (frontend + backend + Postgres), nginx serves the built frontend and proxies `/api` to the backend.

## Running with Docker (production-shaped)

```
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend API docs: http://localhost:8000/docs

The backend container runs `alembic upgrade head` on startup, which also seeds the four Revio instruments (`84047`/`84098`/`84093`/`84309`).

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

**Backend only, without Docker:**
```
cd backend
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate on macOS/Linux
pip install -e ".[dev]"
cp .env.example .env                              # defaults to a local SQLite file
alembic upgrade head
uvicorn app.main:app --reload
pytest
```

## Tests

```
cd backend && pytest                              # 35 unit + integration tests
cd frontend && npm run typecheck && npm run build && npm run test
```

The backend's `tests/unit` suite is a golden-fixture parity check against the original prototype's example data and default settings — see `tests/fixtures/example_samples.csv` and the "porting the algorithms" notes in the engine modules.

## Known gaps / next steps

- No authentication yet (intentional for v1 — internal network trust only). Every mutating endpoint takes an optional `actor` field and there's a single `get_actor()` dependency as the seam for adding real auth later.
- No live Benchling API integration yet — import is manual CSV paste/upload, matching the original prototype's workflow.
- `frontend/package.json` has no committed lockfile (this was built in an environment without Node/npm to generate one) — run `npm install` once Node is available and commit the resulting `package-lock.json`, then switch `frontend/Dockerfile` from `npm install` to `npm ci`.
