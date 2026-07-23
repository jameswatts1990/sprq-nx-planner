from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    samples,
    schedule_export,
    stats,
)
from app.config import settings

app = FastAPI(title="RunNx", version="0.1.0")

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
app.include_router(cell_uses.router)
app.include_router(cells.router)
app.include_router(instruments.router)
app.include_router(stats.router)
app.include_router(audit.router)
app.include_router(admin.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
