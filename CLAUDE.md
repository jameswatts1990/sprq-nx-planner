# Agent Instructions

## RunNx Product & UX Principles

RunNx exists to make PacBio Revio/SPRQ-Nx run scheduling and cell-reuse tracking fast and error-free for lab users who are not developers. Apply these five criteria to every user-facing change — bug fix or new feature — not just when explicitly reminded:

- **Aligned with app goals**: prefer the fix that serves accurate, low-friction lab scheduling over a technically interesting detour. When a change touches scheduling rules, re-check `docs/pacbio-sprq-nx-scheduling-reference.md` (see below) so behaviour still matches vendor-documented instrument constraints, not just what's convenient to implement.
- **Aligned with Revio ICS Methodology**: Scheduling emulates the behaviour of the Revio ICS - flag when going against these principles (see above) 
- **Seamless**: a change should feel like a natural extension of the existing screen, not a bolted-on control. Reuse existing components/patterns (e.g. `ConfirmModal`, the shared `Badge`/`Note` tone maps, existing modal/drawer/table conventions) instead of inventing new ones for the same job.
- **Efficient**: minimize clicks, scrolling, and context-switches for the common case; don't trade a rare edge case for extra friction on the everyday path. This applies to implementation too — no needless abstraction, no premature scope creep (see the general "Doing tasks" principles above).
- **Transparent**: current state, why something is blocked/locked, and what an action will do should be obvious at a glance — via status badges, tooltips, and Help text — never a silent state change or an error the user can't act on.
- **UX/UI first**: for any user-facing change, reason about the interaction from the lab user's perspective before writing code, and verify visually in the running app (the `run`/`verify` skills, or a manual dev-server check) rather than relying on type-checks or test suites alone to call it done.
-**Leave Code Clean**: As changes are made, remove code if it is certified redundant. Remove unused helpers. Clean up commented code if no needed. Only leave comments that help an AI agent understand. Use human readable naming conventions. 

## RunNx App Version

The app version is shown in the navbar (top right, low-contrast grey — see `frontend/src/components/layout/AppShell.tsx`, sourced from `frontend/package.json`'s `version` via Vite's `define` as `__APP_VERSION__`). **Bump `frontend/package.json`'s `version` with every change you make, using semantic versioning (`vX.X.X` → `MAJOR.MINOR.PATCH`):**

- **PATCH** (`0.2.0` → `0.2.1`): bug fixes, copy/style tweaks, refactors with no behaviour change, **and small incremental upgrades to an already-existing feature** — refining, tuning, or extending something that already ships (e.g. reworking how an existing screen prints, adding an option to an existing control). This is the default for most day-to-day changes.
- **MINOR** (`0.2.0` → `0.3.0`): a genuinely **new** user-facing feature or capability that didn't exist before, backwards-compatible — not an enhancement to an existing one.
- **MAJOR** (`0.2.0` → `1.0.0`): breaking changes or a deliberate release milestone — only when explicitly intended.

Do this as part of the same change, not a separate step, so the deployed build is always identifiable at a glance.

## RunNx Dependencies

**Never downgrade a package version to work around an error — fix forward instead.** The tempting quick fix for a version-incompatibility or build/type error is sometimes to pin a package back to an older, known-good version; do not do this. Diagnose and fix against the version that's already declared. If a downgrade is genuinely the only correct fix (e.g. a released version is actually broken), stop and flag it explicitly with the reason rather than doing it silently. The same applies to accidental regressions: edit `package.json`/lockfiles in place, never regenerate them from memory, so pinned versions never drift backwards unintentionally. Dependabot upgrade PRs are a separate, human-reviewed workflow — leave them alone unless explicitly asked.

## RunNx Local Dev Environment

This checkout lives on local disk (`c:\Users\jw24\dev\sprq-nx-planner`) — native dev is `npm run dev` (frontend, port 5173) + `uvicorn --reload` (backend, port 8000) against a local SQLite `backend/dev.db`. No Docker, no network-drive workarounds needed here.

- **node/npm** are installed at `C:\Users\jw24\tools\node` (non-standard location) and added to the user's persistent PATH — if a new shell can't find them, re-check PATH rather than assuming they're missing.
- **Bare `python`/`python3` resolve to non-functional Windows Store stub aliases** on this machine ("Python was not found; run without arguments to install from the Microsoft Store...") even though Python 3.12 is genuinely installed. Use the `py` launcher (`py -m venv`, `py -m pip`, `py -m pytest`) or the venv's own interpreter directly (`backend/.venv/Scripts/python.exe`) — never bare `python`.
- **Docker is not installed on this machine.** `docker-compose.yml` / `docker-compose.dev.yml` exist in the repo but aren't the active dev workflow here — don't assume Postgres/Docker are involved when diagnosing dev-environment issues on this machine.
- **Process hygiene**: `uvicorn --reload` and `npm run dev` are each two-process trees (a watcher parent + a spawned worker child) — killing "whatever's listening on the port" can leave an orphaned sibling tree running from an earlier restart attempt, especially if a previous start failed to bind (port already in use) and was never actually reaped. Before diagnosing "why is X stale/broken", check what's *actually* running: `Get-CimInstance Win32_Process -Filter "Name = 'python.exe'"` / `Get-Process node -ErrorAction SilentlyContinue`, and `Get-NetTCPConnection -LocalPort <port>`. Kill every matching PID, confirm cleared, then restart once.
- **Alembic migrations can pass on a fresh DB and fail on this project's actual `dev.db`**: adding a `NOT NULL` column with no default to a table that already has rows (e.g. during the grid-scheduler redesign's `run_batches.run_date` column) fails with an `IntegrityError` during the batch-table copy — even though the same migration applies cleanly to an empty test database, which is what the test suite uses. When authoring a breaking schema change against a table that might already hold local dev/test data, either give the new column a server default or explicitly call out in the migration/PR that `dev.db` needs to be wiped and re-migrated (fine for this project — dev.db only ever holds disposable test data, never real samples).

## RunNx Production Deployment

The app is deployed on a Hetzner VM (`37.27.2.77`, reachable at `http://37.27.2.77:8080/`), checked out at `/opt/sprq-nx-planner`, run via the root `docker-compose.yml` (nginx serving the built static frontend + reverse-proxying `/api`, FastAPI backend, Postgres). This is the source of truth for that environment — Postgres, not SQLite; a built static frontend, not a live Vite dev server. To redeploy after pushing changes: `cd /opt/sprq-nx-planner && git pull && docker compose up -d --build`.

- **This VM is shared with an unrelated existing service** (`spooldeal-aliexpress-proxy` / `joule-bot`, running its own nginx bound to host port 80). Don't assume port 80/443 are free on this box — the app's frontend runs on **8080** specifically because of this conflict (`docker-compose.yml`'s comment explains why). Check `ss -tlnp` before ever changing published ports.
- **No auth, no HTTPS, plain HTTP on the bare IP** — an explicit accepted gap, not an oversight. Revisit before this holds anything more sensitive than test data.
- **Postgres credentials live in a `.env` next to `docker-compose.yml` on the VM only**, generated via `openssl rand -hex 24`, never committed — `docker-compose.yml` reads them via `${POSTGRES_USER}`/`${POSTGRES_PASSWORD}`/`${POSTGRES_DB}` substitution. `.env.example` (committed) has placeholders.
- **`backend/Dockerfile` does not `COPY` the `backend/scripts/` directory into the image.** One-off scripts (like the SQLite→Postgres migration) have to be copied into a running container manually with `docker compose cp backend/scripts/<script>.py backend:/tmp/<script>.py` before `docker compose exec`-ing them — `python <script>.py` will 404 with "No such file or directory" otherwise if you assume it's baked into the image.
- **`restart: unless-stopped` does not restart a container after `docker kill`/`docker stop`** — that's correct, intentional Docker behavior (it only guards against unexpected crashes, not deliberate stops), not a bug. Don't reflexively "fix" this if a manually-killed container doesn't come back on its own; that's the policy working as designed.
- **`git clone <url> .` vs `git clone <url>` (no destination arg) is easy to get wrong when typing commands by hand** — the former clones into the current directory (prints `Cloning into '.'...`); the latter creates a *new* subdirectory named after the repo (prints `Cloning into '<reponame>'...`), which silently nests the repo one level deeper than intended if you're already sitting in a directory of the same name. If `git log` says "not a git repository" right after a clone that appeared to succeed, check for this first.
- **This VM's console is a browser-based terminal with no working copy/paste in either direction** — every command has to be hand-typed. Any workflow involving a long random string (an SSH public key, a PAT, a generated password) typed by hand will eventually get a character wrong; the failure looks like an auth error ("Permission denied (publickey)", GitHub rejecting a deploy key) and is easy to misdiagnose as a server-config problem. The reliable fix is to never require typing a secret at all: route it through git instead (commit a public key file to the repo, `git pull` it, `cat` it into place) or have the destination generate its own secret locally (`PGPASS=$(openssl rand ...)` inside a script) rather than transcribing one from elsewhere.
- **A private GitHub repo can't be `git clone`d over HTTPS with a password** (GitHub dropped that years ago) — needs either an SSH deploy key or a PAT. Given the no-copy-paste constraint above, the pragmatic fix here was to make the repo public temporarily (no secrets in it — `.env` is gitignored), which needs nothing typed at all beyond the repo name to confirm the visibility change.

## RunNx Scheduling Domain Reference

Before making any change that draws from or affects scheduling — cell reuse, the 108-hour window, run/cycle batching — read `docs/pacbio-sprq-nx-scheduling-reference.md`. It maps this app's scheduling rules onto the PacBio Revio/SPRQ-Nx technical document they were derived from, with file:line references into the current code. Re-check it (and the source PacBio deck, held outside this repo) before changing `engine/constants.py`, the window/status logic in `services/cell_service.py`, the reuse-ordering sorts in `engine/packing.py`/`engine/slot_scheduling.py`, the cost tables in `engine/kpis.py`, or the cell/tray reassignment logic in `services/placement_service.py` (`move_sample`, `_move_sample_to_new_cell`, `_resolve_cell_choice`) — several of those constants and constraints (3-use cap, single 108h deadline from first use, reuse-before-new-cell priority, cost-per-use figures, a cell's fixed tray/well position for life) are direct implementations of vendor-documented instrument behavior or this app's own physical-cell invariants, not arbitrary choices.

## RunNx Help Tab Maintenance

The frontend has a user-facing **Help** tab (`frontend/src/pages/HelpPage/`) that documents every screen for non-technical lab users. It is backfilled from the actual UI, so it silently goes stale unless it's updated alongside UI changes. Treat it as part of the definition of done for any user-facing change.

**When you change a user-facing feature, interaction, alert/Note message, tooltip, or colour/badge meaning, update the matching Help section in the same change.** Map:

| If you touch… | Update this Help section file |
| --- | --- |
| `pages/ImportPage.tsx` | `sections/ImportSection.tsx` |
| `pages/BacklogPage.tsx` | `sections/BacklogSection.tsx` |
| `pages/SchedulePage/*` (grid, Run design, drag/drop, locking, clear, cell picker, slot detail) | `sections/ScheduleSection.tsx` |
| `pages/CellsPage.tsx`, `pages/CellDetailPage.tsx`, `components/cells/*` | `sections/CellsSection.tsx` |
| `pages/HistoryRunsPage.tsx`, `pages/RunDetailPage.tsx`, `pages/HistorySamplesPage.tsx` | `sections/HistorySection.tsx` |
| `pages/SettingsPage/*` (sample defaults, scheduling, movie scheduling, email template, instrument facts, dev tools) | `sections/SettingsSection.tsx` |
| A `Badge`/`Note` tone, a status→tone map (`utils/cellStatus.ts`, `utils/cycleStatus.ts`, `utils/useStatusTone.ts`), or the Use 1/2/3 swatches (`components/shared/SectionHeading.tsx`) | `sections/LegendSection.tsx` — but note the legend renders live components from the shared tone maps, so a tone change usually needs only a wording tweak, never a colour re-description |
| Add/rename/remove a tab (`components/layout/AppShell.tsx` `NAV_ITEMS`) | `sections/GettingStartedSection.tsx` (the workflow overview) and add/remove the section in `HelpPage.tsx` |

**Rules:**
- The Colour & Status Legend must always render the real `Badge`/`Note`/`UseLegend` components sourced from the shared tone maps — never fork or hard-code tone values into the Help tab.
- If you add a new status value, alert message, or tooltip, add its plain-language meaning to the relevant section; don't leave users to guess.
- Help copy is for lab users, not developers: describe what a control does and what a message means, not how it's implemented.

## RunNx Settings Tab — Configuration & Dev Database Tools

The **Settings** tab (`frontend/src/pages/SettingsPage/`, formerly "Admin") is a sidebar+swap-panel page grouping the lab-configurable settings — sample defaults, scheduling (insert-size threshold, default run start hour), movie scheduling (default movie length + per-length cell rules), the credit-email template — plus a read-only **Instrument & scheduling facts** card (`FactsPanel.tsx`, fed by `GET /api/settings/facts`, surfacing the vendor-locked constants: 108h window, 3-use cap, tray-of-4, deck wells, movie-length values, timing ladder — never editable). The editable settings all ride the validated, audit-logged `settings_service` → `/api/settings` path; the movie-time rules + default reach the DB-free engine as an `engine/constants.MovieRules` bundle threaded through `pack_cells`/`fill_slots` (via `settings_service.get_movie_rules`), the same pattern as the insert-size threshold. Note the movie-time *values* (12/24/30) stay fixed by design — only the default and the cell rules are editable.

The raw database inspection/mutation tools (view tables, view/delete rows, clear a table's rows, clear backlog; `DeveloperTools.tsx`, backed by `backend/app/api/admin.py`) now live in a **"Developer tools"** section tucked behind the sidebar's **"Show developer tools"** reveal — out of the everyday path but still present. They bypass all normal business logic and service-layer invariants, and the app has no auth to protect them.

**The developer tools are explicitly a dev-only feature, not gated by environment.** The `admin` router is registered unconditionally in `main.py` and the reveal is always available — by the user's own decision, rather than auto-hidden by an environment flag. **Before a real production launch, this must be explicitly removed or gated** (e.g. re-introduce environment gating, or delete the router + the `DeveloperTools` section outright) — do not do this preemptively; wait to be asked. If you're asked to do this, the natural seam is: add an `environment` field to `backend/app/config.py`'s `Settings`, conditionally `app.include_router(admin.router)` in `main.py`, and conditionally render the `DeveloperTools` section / its reveal on the frontend via `import.meta.env.PROD`.

"Clear table" means `DELETE FROM` (empties rows, keeps schema) — not `DROP TABLE`. This was a deliberate choice so the table stays immediately usable without an Alembic re-migration. Admin actions do not write to the `AuditLog` — that trail models real domain actions via their service-layer invariants, which this tool deliberately bypasses.
