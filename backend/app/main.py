from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit, cell_uses, cells, cycles, imports, instruments, samples, schedule, schedules
from app.config import settings

app = FastAPI(title="Revio SPRQ-Nx LIMS", version="0.1.0")

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(imports.router)
app.include_router(samples.router)
app.include_router(schedule.router)
app.include_router(schedules.router)
app.include_router(cycles.router)
app.include_router(cell_uses.router)
app.include_router(cells.router)
app.include_router(instruments.router)
app.include_router(audit.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
