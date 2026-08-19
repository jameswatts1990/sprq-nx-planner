# Production deployment notes (RunNx)

Detailed production-deployment operational notes. The everyday essentials (VM address, redeploy command, port constraint) are in `CLAUDE.md`; read this when deploying or diagnosing the deployed environment.

The app is deployed on a Hetzner VM (`37.27.2.77`, reachable at `http://37.27.2.77:8080/`), checked out at `/opt/sprq-nx-planner`, run via the root `docker-compose.yml` (nginx serving the built static frontend + reverse-proxying `/api`, FastAPI backend, Postgres). This is the source of truth for that environment — Postgres, not SQLite; a built static frontend, not a live Vite dev server. To redeploy after pushing changes: `cd /opt/sprq-nx-planner && git pull && docker compose up -d --build`.

## Notes & gotchas

- **This VM is shared with an unrelated existing service** (`spooldeal-aliexpress-proxy` / `joule-bot`, running its own nginx bound to host port 80). Don't assume port 80/443 are free on this box — the app's frontend runs on **8080** specifically because of this conflict (`docker-compose.yml`'s comment explains why). Check `ss -tlnp` before ever changing published ports.
- **No auth, no HTTPS, plain HTTP on the bare IP** — an explicit accepted gap, not an oversight. Revisit before this holds anything more sensitive than test data.
- **Postgres credentials live in a `.env` next to `docker-compose.yml` on the VM only**, generated via `openssl rand -hex 24`, never committed — `docker-compose.yml` reads them via `${POSTGRES_USER}`/`${POSTGRES_PASSWORD}`/`${POSTGRES_DB}` substitution. `.env.example` (committed) has placeholders.
- **`backend/Dockerfile` does not `COPY` the `backend/scripts/` directory into the image.** One-off scripts (like the SQLite→Postgres migration) have to be copied into a running container manually with `docker compose cp backend/scripts/<script>.py backend:/tmp/<script>.py` before `docker compose exec`-ing them — `python <script>.py` will 404 with "No such file or directory" otherwise if you assume it's baked into the image.
- **`restart: unless-stopped` does not restart a container after `docker kill`/`docker stop`** — that's correct, intentional Docker behavior (it only guards against unexpected crashes, not deliberate stops), not a bug. Don't reflexively "fix" this if a manually-killed container doesn't come back on its own; that's the policy working as designed.
