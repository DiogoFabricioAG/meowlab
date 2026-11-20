"""FastAPI entrypoint for MeowLab's native Tender Cat service (internal network)."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import bases_rag, preparation, tender_market, tender_work, whatsapp_bases, workspace_bases  # noqa: F401
from .database import Base, SessionLocal, engine, get_db
from .market_worker import MarketWorker
from .security import read_secret
from .workspace import router as workspace_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # SQLite is used for isolated local runs. The pilot uses the existing
    # PostgreSQL schema and its current migration owner.
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)
    worker = None
    if os.getenv("RADAR_PREPARATION_ENABLED") == "1":
        owner = os.getenv("RADAR_WEB_ACCOUNT", "").strip()
        if owner and len(owner) <= 100 and read_secret("RADAR_MEOWLAB_TOKEN"):
            worker = preparation.PreparationWorker(SessionLocal, owner)
            worker.start()
    market = None
    if os.getenv("TENDER_MARKET_ENABLED") == "1":
        owner = os.getenv("RADAR_WEB_ACCOUNT", "").strip()
        if owner and read_secret("RADAR_OPENAI_API_KEY"):
            market = MarketWorker(SessionLocal, owner)
            market.start()
    try:
        yield
    finally:
        if market:
            market.stop()
        if worker:
            worker.stop()


app = FastAPI(
    title="MeowLab Tender Cat — Servicio nativo",
    version="0.1.0",
    description="Servicio interno para expedientes, bases, preparación, precios y exportes de Tender Cat.",
    lifespan=lifespan,
)
app.include_router(workspace_router)


@app.middleware("http")
async def private_workspace_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/workspace"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(select(1))
    return {"status": "ok", "service": "tender-native"}
