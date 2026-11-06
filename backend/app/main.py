from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    admin,
    audit,
    auto_fill,
    batch_sheet,
    cell_uses,
    cells,
    cycles,
    imports,
    instruments,
    pacbio_cases,
    samples,
    schedule_export,
    schedule_notes,
    settings as settings_api,
    stats,
    topups,
)
from app.config import settings

app = FastAPI(title="RunNx", version="0.1.0")

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CROSS_SITE_HEADER = "X-RunNx"


@app.middleware("http")
async def block_cross_site_writes(request: Request, call_next):
    """The app has no auth, so any page a lab user visits could otherwise fire a form POST at the
    API from their browser. A custom header can't be set cross-site without a CORS preflight
    (which no foreign origin passes), so every /api write must carry it; the frontend's
    api/client.ts request() always sends it. Reads stay open - downloads are plain <a> links.
    Declared before CORSMiddleware so CORS wraps it (a 403 still carries CORS headers)."""
    if (
        request.method not in SAFE_METHODS
        and request.url.path.startswith("/api/")
        and request.headers.get(CROSS_SITE_HEADER) != "1"
    ):
        return JSONResponse(
            status_code=403,
            content={"detail": f"Request blocked: missing {CROSS_SITE_HEADER} header (cross-site protection)"},
        )
    return await call_next(request)


if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(imports.router)
app.include_router(samples.router)
app.include_router(auto_fill.router)
app.include_router(cycles.router)
app.include_router(batch_sheet.router)
app.include_router(schedule_export.router)
app.include_router(schedule_notes.router)
app.include_router(cell_uses.router)
app.include_router(cells.router)
app.include_router(topups.router)
app.include_router(pacbio_cases.router)
app.include_router(instruments.router)
app.include_router(stats.router)
app.include_router(audit.router)
app.include_router(settings_api.router)
app.include_router(admin.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
