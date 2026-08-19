# Local dev notes (RunNx)

Detailed local-dev operational notes for this checkout (`c:\Users\jw24\dev\sprq-nx-planner`). The everyday essentials are in `CLAUDE.md`; read this when a dev-environment issue actually bites. Native dev is `npm run dev` (frontend, port 5173) + `uvicorn --reload` (backend, port 8000) against a local SQLite `backend/dev.db`. No Docker, no network-drive workarounds needed here.

## Environment quirks

- **node/npm** are installed at `C:\Users\jw24\tools\node` (non-standard location) and added to the user's persistent PATH — if a new shell can't find them, re-check PATH rather than assuming they're missing.
- **Bare `python`/`python3` resolve to non-functional Windows Store stub aliases** on this machine ("Python was not found; run without arguments to install from the Microsoft Store...") even though Python 3.12 is genuinely installed. Use the `py` launcher (`py -m venv`, `py -m pip`, `py -m pytest`) or the venv's own interpreter directly (`backend/.venv/Scripts/python.exe`) — never bare `python`.
- **Docker is not installed on this machine.** `docker-compose.yml` / `docker-compose.dev.yml` exist in the repo but aren't the active dev workflow here — don't assume Postgres/Docker are involved when diagnosing dev-environment issues on this machine.

## Process hygiene

`uvicorn --reload` and `npm run dev` are each two-process trees (a watcher parent + a spawned worker child) — killing "whatever's listening on the port" can leave an orphaned sibling tree running from an earlier restart attempt, especially if a previous start failed to bind (port already in use) and was never actually reaped. Before diagnosing "why is X stale/broken", check what's *actually* running: `Get-CimInstance Win32_Process -Filter "Name = 'python.exe'"` / `Get-Process node -ErrorAction SilentlyContinue`, and `Get-NetTCPConnection -LocalPort <port>`. Kill every matching PID, confirm cleared, then restart once.

## Alembic on a populated `dev.db`

Alembic migrations can pass on a fresh DB and fail on this project's actual `dev.db`: adding a `NOT NULL` column with no default to a table that already has rows (e.g. during the grid-scheduler redesign's `run_batches.run_date` column) fails with an `IntegrityError` during the batch-table copy — even though the same migration applies cleanly to an empty test database, which is what the test suite uses. When authoring a breaking schema change against a table that might already hold local dev/test data, either give the new column a server default or explicitly call out in the migration/PR that `dev.db` needs to be wiped and re-migrated (fine for this project — dev.db only ever holds disposable test data, never real samples).
