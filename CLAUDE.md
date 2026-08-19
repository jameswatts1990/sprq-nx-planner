# Agent Instructions

## Product & UX principles

RunNx makes PacBio Revio/SPRQ-Nx run scheduling and cell-reuse tracking fast and error-free for lab users who are not developers. Apply these to **every** user-facing change (bug fix or feature), not just when reminded:

- **Aligned with app goals**: prefer the fix that serves accurate, low-friction lab scheduling over a technically interesting detour. If a change touches scheduling rules, re-check the scheduling reference (below) so behaviour still matches vendor-documented instrument constraints.
- **Aligned with Revio ICS methodology**: scheduling emulates the Revio ICS — flag when a change goes against it.
- **Seamless**: extend the existing screen, don't bolt on. Reuse existing components/patterns (`ConfirmModal`, the shared `Badge`/`Note` tone maps, existing modal/drawer/table conventions) rather than inventing new ones for the same job.
- **Efficient**: minimize clicks/scrolling/context-switches for the common case; don't trade a rare edge case for friction on the everyday path. Same for implementation — no needless abstraction, no premature scope creep.
- **Transparent**: current state, why something is blocked/locked, and what an action will do should be obvious at a glance (status badges, tooltips, Help text) — never a silent state change or an error the user can't act on.
- **UX/UI first**: reason about the interaction from the lab user's perspective before writing code, and verify visually in the running app (the `run`/`verify` skills, or a manual dev-server check) — not type-checks or tests alone.
- **Leave code clean**: remove certified-redundant code and unused helpers; delete stale commented code. Keep only comments that help an AI agent; use human-readable names.

## App version

The version shows in the navbar (top-right, low-contrast grey — `frontend/src/components/layout/AppShell.tsx`, sourced from `frontend/package.json`'s `version` via Vite's `define` as `__APP_VERSION__`). **Bump `frontend/package.json`'s `version` as part of every change** (semver `MAJOR.MINOR.PATCH`), not as a separate step, so the deployed build is always identifiable at a glance:

- **PATCH** (`0.2.0`→`0.2.1`): bug fixes, copy/style tweaks, no-behaviour-change refactors, and small incremental upgrades to an already-existing feature.
- **MINOR** (`0.2.0`→`0.3.0`): a genuinely **new**, backwards-compatible user-facing feature or capability — not an enhancement to an existing one.
- **MAJOR** (`0.2.0`→`1.0.0`): breaking changes or a deliberate release milestone — only when explicitly intended.

## Dependencies

**Never downgrade a package to dodge an error — fix forward against the declared version.** If a downgrade is genuinely the only correct fix (e.g. a release is actually broken), stop and flag it with the reason — never silently. Edit `package.json`/lockfiles in place, never regenerate them from memory, so pinned versions never drift backwards. Leave Dependabot upgrade PRs alone (a separate, human-reviewed workflow) unless explicitly asked.

## Local dev

Native dev on local disk (`c:\Users\jw24\dev\sprq-nx-planner`): `npm run dev` (frontend, port 5173) + `uvicorn --reload` (backend, port 8000) against SQLite `backend/dev.db`. No Docker here. Use the `py` launcher or `backend/.venv/Scripts/python.exe` — **never bare `python`** (it resolves to a broken Windows Store stub). Process-hygiene, PATH, and Alembic-on-`dev.db` gotchas: read `docs/dev-notes.md` when a dev-env issue bites.

## Deployment

Deployed on a Hetzner VM (`37.27.2.77`, `http://37.27.2.77:8080/`), checked out at `/opt/sprq-nx-planner`, run via the root `docker-compose.yml` (nginx + FastAPI + Postgres — Postgres in prod, not SQLite). Redeploy after pushing: `cd /opt/sprq-nx-planner && git pull && docker compose up -d --build`. The frontend is on **8080** deliberately (the VM shares host port 80 with an unrelated service) — check `ss -tlnp` before ever changing published ports. Full runbook + gotchas: `docs/deployment-notes.md`.

## Scheduling domain reference

Before any change that draws from or affects scheduling — cell reuse, the 108-hour window, run/cycle batching — read `docs/pacbio-sprq-nx-scheduling-reference.md`. It maps this app's scheduling rules onto the source PacBio Revio/SPRQ-Nx technical document, with file:line references into the current code. Re-check it (and the source PacBio deck, held outside this repo) before changing `engine/constants.py`, the window/status logic in `services/cell_service.py`, the reuse-ordering sorts in `engine/packing.py` / `engine/slot_scheduling.py`, the cost tables in `engine/kpis.py`, or the cell/tray reassignment logic in `services/placement_service.py` (`move_sample`, `_move_sample_to_new_cell`, `_resolve_cell_choice`). Several of those constants/constraints (3-use cap, single 108h deadline from first use, reuse-before-new-cell priority, cost-per-use figures, a cell's fixed tray/well position for life) are direct implementations of vendor-documented instrument behaviour or this app's physical-cell invariants, not arbitrary choices.

## Help tab

The user-facing **Help** tab (`frontend/src/pages/HelpPage/`) documents every screen for non-technical lab users and is backfilled from the UI, so it silently goes stale unless updated alongside UI changes. **When you change a user-facing feature, interaction, alert/Note message, tooltip, or colour/badge meaning, update the matching Help section in the same change** — treat it as part of the definition of done. The page → Help-section map and the legend/tone rules are in `docs/help-tab-map.md`.

## Settings tab & dev tools

The **Settings** tab (`frontend/src/pages/SettingsPage/`) groups the lab-configurable settings (sample defaults, scheduling thresholds, movie scheduling, credit-email template) plus a read-only instrument/scheduling **facts** card (vendor-locked constants — never editable). Editable settings ride the validated, audit-logged `settings_service` → `/api/settings` path; the movie-time rules + default reach the DB-free engine as an `engine/constants.MovieRules` bundle via `settings_service.get_movie_rules`. Movie-time *values* (12/24/30) stay fixed by design — only the default and the per-length cell rules are editable.

The raw DB inspection/mutation tools (`DeveloperTools.tsx`, backed by `backend/app/api/admin.py`) live behind the sidebar's **"Show developer tools"** reveal. They bypass all normal business logic and service-layer invariants, and the app has no auth. **This is a deliberate, always-on dev feature — not gated by environment (the `admin` router is registered unconditionally in `main.py`). Before a real production launch it must be explicitly removed or gated — do not do this preemptively; wait to be asked.** The seam if asked: add an `environment` field to `backend/app/config.py`'s `Settings`, conditionally `app.include_router(admin.router)` in `main.py`, and conditionally render the `DeveloperTools` section via `import.meta.env.PROD`.

- "Clear table" = `DELETE FROM` (empties rows, keeps schema), not `DROP TABLE` — a deliberate choice so the table stays immediately usable without an Alembic re-migration.
- Admin actions do not write to the `AuditLog` — that trail models real domain actions via their service-layer invariants, which these tools deliberately bypass.
