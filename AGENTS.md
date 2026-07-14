# Agent Instructions

> This file is mirrored across CLAUDE.md, AGENTS.md, and GEMINI.md so the same instructions load in any AI environment.

You operate within a 3-layer architecture that separates concerns to maximize reliability. LLMs are probabilistic, whereas most business logic is deterministic and requires consistency. This system fixes that mismatch.

## The 3-Layer Architecture

**Layer 1: Directive (What to do)**

- Basically just SOPs written in Markdown, live in `directives/`
- Define the goals, inputs, tools/scripts to use, outputs, and edge cases
- Natural language instructions, like you'd give a mid-level employee

**Layer 2: Orchestration (Decision making)**

- This is you. Your job: intelligent routing.
- Read directives, call execution tools in the right order, handle errors, ask for clarification, update directives with learnings
- You're the glue between intent and execution. E.g you don't try scraping websites yourself—you read `directives/scrape_website.md` and come up with inputs/outputs and then run `execution/scrape_single_site.py`

**Layer 3: Execution (Doing the work)**

- Deterministic Python scripts in `execution/`
- Environment variables, api tokens, etc are stored in `.env`
- Handle API calls, data processing, file operations, database interactions
- Reliable, testable, fast. Use scripts instead of manual work. Commented well.

**Why this works:** if you do everything yourself, errors compound. 90% accuracy per step = 59% success over 5 steps. The solution is push complexity into deterministic code. That way you just focus on decision-making.

## Operating Principles

**1. Check for tools first**

Before writing a script, check `execution/` per your directive. Only create new scripts if none exist.

**2. Self-anneal when things break**

- Read error message and stack trace
- Fix the script and test it again (unless it uses paid tokens/credits/etc—in which case you check w user first)
- Update the directive with what you learned (API limits, timing, edge cases)
- Example: you hit an API rate limit → you then look into API → find a batch endpoint that would fix → rewrite script to accommodate → test → update directive.

**3. Update directives as you learn**

Directives are living documents. When you discover API constraints, better approaches, common errors, or timing expectations—update the directive. But don't create or overwrite directives without asking unless explicitly told to. Directives are your instruction set and must be preserved (and improved upon over time, not extemporaneously used and then discarded).

## Self-annealing loop

Errors are learning opportunities. When something breaks:

1. Fix it
2. Update the tool
3. Test tool, make sure it works
4. Update directive to include new flow
5. System is now stronger

## File Organization

**Deliverables vs Intermediates:**

- **Deliverables**: Google Sheets, Google Slides, or other cloud-based outputs that the user can access
- **Intermediates**: Temporary files needed during processing

**Directory structure:**

- `.tmp/` - All intermediate files (dossiers, scraped data, temp exports). Never commit, always regenerated.
- `execution/` - Python scripts (the deterministic tools)
- `directives/` - SOPs in Markdown (the instruction set)
- `.env` - Environment variables and API keys
- `credentials.json`, `token.json` - Google OAuth credentials (required files, in `.gitignore`)

**Key principle:** Local files are only for processing. Deliverables live in cloud services (Google Sheets, Slides, etc.) where the user can access them. Everything in `.tmp/` can be deleted and regenerated.

## Summary

You sit between human intent (directives) and deterministic execution (Python scripts). Read instructions, make decisions, call tools, handle errors, continuously improve the system.

Be pragmatic. Be reliable. Self-anneal.

## sprq-nx-planner Local Dev Environment

This checkout lives on a mapped SMB network drive (`U:` → `\\home-smb\...`), not a local disk. That causes recurring, non-code-related failures — recognize the pattern before debugging application code:

- **Frontend (Vite, port 5173) crashing with `Internal server error: The service is no longer running` / `Exception 0xc0000006`**: esbuild's native binary is memory-mapped and executed off the network share; a transient SMB read stall kills it with a Windows page-in error, and every request through that Vite process 500s afterward until the whole `npm run dev` process is restarted. Confirmed recurring (not a one-off) — expect it again. **The "move `node_modules` to local disk" fix does not work**: `\\home-smb\...` (Samba) does not support creating NTFS junctions or symlinks from a Windows client (`New-Item -ItemType Junction`/`SymbolicLink` both fail with `ERROR_INVALID_FUNCTION`), and Vite/Node module resolution requires `node_modules` to be physically reachable by walking up from `frontend/` on `U:` — there's no way to point it at a local copy without a working link. Until someone decides to move the actual working checkout off the network drive, the only mitigation is: restart `npm run dev` when this happens. Separately, Vite's own file-watcher (chokidar/Node's native `fs.watch`) can crash the whole process with `ECONNRESET` when watching files over SMB — `frontend/vite.config.ts` already sets `server.watch.usePolling: true` to work around this; don't remove it.
- **Backend (FastAPI/uvicorn, port 8000) returning API 500s or hanging on every request, including `/api/health`**: check process age/CPU first (`Get-CimInstance Win32_Process -Filter "Name = 'python.exe'"`) before assuming a code bug. A `uvicorn --reload` process left running across a long idle period on this drive can end up wedged (accepts the TCP connection but never responds). Fix: kill both the reloader and its child worker process, then start a fresh `python -m uvicorn app.main:app --reload --port 8000` from `backend/`. Give the fresh process ~15s to fully start — `WatchFiles` enumerating `backend/.venv` (thousands of files) over SMB is slow, so "Application startup complete" takes longer to appear in the log than it would locally.
- **Backend silently serving stale code after edits, with no crash and no 500** — a distinct, sneakier manifestation of the same `WatchFiles`-over-SMB flakiness above: the process stays up and responds successfully (200 OK), but a Pydantic response model field you just added (or any other code change) is simply absent from the JSON, because `--reload` never actually detected the file change and restarted the worker. Confirmed happening even for a `uvicorn` process started earlier the same session. Symptom is easy to misdiagnose as "the field isn't wired up" when it's actually "the running process predates the code that wires it up." Before debugging a missing/wrong field or unchanged behavior, check the backend log for a `WatchFiles detected changes` / reload line matching your edit timestamp — if it's not there, kill the process tree (see "Process hygiene" below) and start fresh rather than trusting `--reload`.
- **Backend 500s with `sqlite3.OperationalError: disk I/O error` in the traceback (distinct from the wedged/hanging case above — this one responds, just fails on writes)**: this is SQLite itself, not the app. SQLite's file-locking model is not reliably supported on network/SMB filesystems (documented SQLite limitation), and it surfaces as a `disk I/O error` on ordinary INSERTs once enough concurrent access/retries happen. **`backend/.env`'s `DATABASE_URL=sqlite:///./dev.db` is NOT actually local** — that's a relative path resolved against the backend process's CWD, which is itself on `U:`, so the db file ends up on the network share regardless. Do not trust a previous note (or your own assumption) that this path is "a local SQLite file" without checking — it isn't. The real fix: override `DATABASE_URL` to point at a genuinely local disk path outside the `U:` mount (e.g. a temp/scratch directory) when starting uvicorn, e.g. `DATABASE_URL=sqlite:///C:/Users/<user>/AppData/Local/Temp/.../dev.db`. Run `alembic upgrade head` against that same path before first start.
- **Process hygiene**: `uvicorn --reload` and `npm run dev` are each two-process trees (a watcher parent + a spawned worker child) — killing "whatever's listening on the port" can leave an orphaned sibling tree running in the background from an earlier restart attempt, especially if a previous start failed to bind (port already in use) and was never actually reaped. Symptom: confusing/stale-looking responses, or a file (like `dev.db`) that won't delete because something still has it open. Before diagnosing "why is X stale/broken", check what's *actually* running rather than assuming: `Get-CimInstance Win32_Process -Filter "Name = 'python.exe'"` / `Get-Process node -ErrorAction SilentlyContinue`, and `Get-NetTCPConnection -LocalPort <port>`. Kill every matching PID, confirm the process list and file lock are actually clear, *then* restart once. Also: don't use `-ErrorAction SilentlyContinue` on a cleanup `Remove-Item` you actually care about — it silently swallows "file in use" and leaves stale state in place while looking like it succeeded.
- **Alembic migrations can pass on a fresh DB and fail on this project's actual `dev.db`**: adding a `NOT NULL` column with no default to a table that already has rows (e.g. during the grid-scheduler redesign's `run_batches.run_date` column) fails with an `IntegrityError` during the batch-table copy — even though the same migration applies cleanly to an empty test database, which is what the test suite uses. When authoring a breaking schema change against a table that might already hold local dev/test data, either give the new column a server default or explicitly call out in the migration/PR that `dev.db` needs to be wiped and re-migrated (fine for this project — dev.db only ever holds disposable test data, never real samples).
- **node/npm not found on PATH**: they're installed at `C:\Users\jw24\tools\node`, a non-standard location — not actually missing. This has been added to the user's persistent PATH, so new shells should resolve them automatically.
- **Docker is not installed on this machine.** `docker-compose.yml` / `docker-compose.dev.yml` exist in the repo but aren't the active dev workflow here — the real setup is native `npm run dev` (frontend) + `uvicorn --reload` (backend) against SQLite, with `DATABASE_URL` overridden to a local-disk path per the bullet above. Don't assume Postgres/Docker are involved when diagnosing dev-environment issues on this machine.

## sprq-nx-planner Production Deployment

The app is deployed on a Hetzner VM (`37.27.2.77`, reachable at `http://37.27.2.77:8080/`), checked out at `/opt/sprq-nx-planner`, run via the root `docker-compose.yml` (nginx serving the built static frontend + reverse-proxying `/api`, FastAPI backend, Postgres). This is the source of truth for that environment — Postgres, not SQLite; a built static frontend, not a live Vite dev server — so none of the network-drive/SQLite-locking/file-watcher issues documented above under "Local Dev Environment" apply there. To redeploy after pushing changes: `cd /opt/sprq-nx-planner && git pull && docker compose up -d --build`.

- **This VM is shared with an unrelated existing service** (`spooldeal-aliexpress-proxy` / `joule-bot`, running its own nginx bound to host port 80). Don't assume port 80/443 are free on this box — the app's frontend runs on **8080** specifically because of this conflict (`docker-compose.yml`'s comment explains why). Check `ss -tlnp` before ever changing published ports.
- **No auth, no HTTPS, plain HTTP on the bare IP** — an explicit accepted gap, not an oversight. Revisit before this holds anything more sensitive than test data.
- **Postgres credentials live in a `.env` next to `docker-compose.yml` on the VM only**, generated via `openssl rand -hex 24`, never committed — `docker-compose.yml` reads them via `${POSTGRES_USER}`/`${POSTGRES_PASSWORD}`/`${POSTGRES_DB}` substitution. `.env.example` (committed) has placeholders.
- **`backend/Dockerfile` does not `COPY` the `backend/scripts/` directory into the image.** One-off scripts (like the SQLite→Postgres migration) have to be copied into a running container manually with `docker compose cp backend/scripts/<script>.py backend:/tmp/<script>.py` before `docker compose exec`-ing them — `python <script>.py` will 404 with "No such file or directory" otherwise if you assume it's baked into the image.
- **`restart: unless-stopped` does not restart a container after `docker kill`/`docker stop`** — that's correct, intentional Docker behavior (it only guards against unexpected crashes, not deliberate stops), not a bug. Don't reflexively "fix" this if a manually-killed container doesn't come back on its own; that's the policy working as designed.
- **`git clone <url> .` vs `git clone <url>` (no destination arg) is easy to get wrong when typing commands by hand** — the former clones into the current directory (prints `Cloning into '.'...`); the latter creates a *new* subdirectory named after the repo (prints `Cloning into '<reponame>'...`), which silently nests the repo one level deeper than intended if you're already sitting in a directory of the same name. If `git log` says "not a git repository" right after a clone that appeared to succeed, check for this first.
- **This VM's console is a browser-based terminal with no working copy/paste in either direction** — every command has to be hand-typed. Any workflow involving a long random string (an SSH public key, a PAT, a generated password) typed by hand will eventually get a character wrong; the failure looks like an auth error ("Permission denied (publickey)", GitHub rejecting a deploy key) and is easy to misdiagnose as a server-config problem. The reliable fix is to never require typing a secret at all: route it through git instead (commit a public key file to the repo, `git pull` it, `cat` it into place) or have the destination generate its own secret locally (`PGPASS=$(openssl rand ...)` inside a script) rather than transcribing one from elsewhere.
- **A private GitHub repo can't be `git clone`d over HTTPS with a password** (GitHub dropped that years ago) — needs either an SSH deploy key or a PAT. Given the no-copy-paste constraint above, the pragmatic fix here was to make the repo public temporarily (no secrets in it — `.env` is gitignored), which needs nothing typed at all beyond the repo name to confirm the visibility change.

## sprq-nx-planner Scheduling Domain Reference

Before making any change that draws from or affects scheduling — cell reuse, the 108-hour window, run/cycle batching, or cost/KPI modeling — read `docs/pacbio-sprq-nx-scheduling-reference.md`. It maps this app's scheduling rules onto the PacBio Revio/SPRQ-Nx technical document they were derived from, with file:line references into the current code. Re-check it (and the source PacBio deck, held outside this repo) before changing `engine/constants.py`, the window/status logic in `services/cell_service.py`, the reuse-ordering sorts in `engine/packing.py`/`engine/slot_scheduling.py`, or the cost tables in `engine/kpis.py` — several of those constants and constraints (3-use cap, single 108h deadline from first use, reuse-before-new-cell priority, cost-per-use figures) are direct implementations of vendor-documented instrument behavior, not arbitrary choices.

## sprq-nx-planner Help Tab Maintenance

The frontend has a user-facing **Help** tab (`frontend/src/pages/HelpPage/`) that documents every screen for non-technical lab users. It is backfilled from the actual UI, so it silently goes stale unless it's updated alongside UI changes. Treat it as part of the definition of done for any user-facing change.

**When you change a user-facing feature, interaction, alert/Note message, tooltip, or colour/badge meaning, update the matching Help section in the same change.** Map:

| If you touch… | Update this Help section file |
| --- | --- |
| `pages/ImportPage.tsx` | `sections/ImportSection.tsx` |
| `pages/BacklogPage.tsx` | `sections/BacklogSection.tsx` |
| `pages/SchedulePage/*` (grid, Run design, drag/drop, locking, clear, cell picker, slot detail) | `sections/ScheduleSection.tsx` |
| `pages/CellsPage.tsx`, `pages/CellDetailPage.tsx`, `components/cells/*` | `sections/CellsSection.tsx` |
| `pages/HistoryRunsPage.tsx`, `pages/RunDetailPage.tsx`, `pages/HistorySamplesPage.tsx` | `sections/HistorySection.tsx` |
| `pages/AdminPage/*` | `sections/AdminSection.tsx` |
| A `Badge`/`Note` tone, a status→tone map (`utils/cellStatus.ts`, `utils/cycleStatus.ts`, `utils/useStatusTone.ts`), or the Use 1/2/3 swatches (`components/shared/SectionHeading.tsx`) | `sections/LegendSection.tsx` — but note the legend renders live components from the shared tone maps, so a tone change usually needs only a wording tweak, never a colour re-description |
| Add/rename/remove a tab (`components/layout/AppShell.tsx` `NAV_ITEMS`) | `sections/GettingStartedSection.tsx` (the workflow overview) and add/remove the section in `HelpPage.tsx` |

**Rules:**
- The Colour & Status Legend must always render the real `Badge`/`Note`/`UseLegend` components sourced from the shared tone maps — never fork or hard-code tone values into the Help tab.
- If you add a new status value, alert message, or tooltip, add its plain-language meaning to the relevant section; don't leave users to guess.
- Help copy is for lab users, not developers: describe what a control does and what a message means, not how it's implemented.

## sprq-nx-planner Admin Tab — Database Tools

The **Admin** tab (`frontend/src/pages/AdminPage/`, backed by `backend/app/api/admin.py`) is a raw database inspection/mutation tool (view tables, view/delete rows, clear a table's rows) built for local development convenience. It bypasses all normal business logic and service-layer invariants, and the app has no auth to protect it.

**This is explicitly a dev-only feature, not gated by environment.** It is registered unconditionally in `main.py` and the nav tab is always visible — by the user's own decision, rather than auto-hidden by an environment flag. **Before a real production launch, this must be explicitly removed or gated** (e.g. re-introduce environment gating, or delete the router/page outright) — do not do this preemptively; wait to be asked. If you're asked to do this, the natural seam is: add an `environment` field to `backend/app/config.py`'s `Settings`, conditionally `app.include_router(admin.router)` in `main.py`, and conditionally include the nav item/route on the frontend via `import.meta.env.PROD`.

"Clear table" means `DELETE FROM` (empties rows, keeps schema) — not `DROP TABLE`. This was a deliberate choice so the table stays immediately usable without an Alembic re-migration. Admin actions do not write to the `AuditLog` — that trail models real domain actions via their service-layer invariants, which this tool deliberately bypasses.
