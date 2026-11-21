"""Native Tender Cat workspace routes and models (server-authenticated via MeowLab)."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from decimal import Decimal
from typing import Literal
from urllib.error import HTTPError
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import JSON, Integer, String, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base, get_db
from .security import read_secret, require_meowlab_service

router = APIRouter(prefix="/api/workspace", tags=["Tender Cat native"])
logger = logging.getLogger(__name__)
MEOWLAB = os.getenv(
    "RADAR_MEOWLAB_URL",
    "https://whatsapp-webhook-meta-production.diogofabricio17.workers.dev/v1/projects/radar",
).rstrip("/")
account = require_meowlab_service


class WebAccount(Base):
    __tablename__ = "radar_web_accounts"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    cursor: Mapped[int] = mapped_column(Integer, default=0)


class WebOpportunity(Base):
    __tablename__ = "radar_web_opportunities"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100), index=True)
    ocid: Mapped[str] = mapped_column(String(200))
    revision: Mapped[int] = mapped_column(Integer)
    selection: Mapped[str] = mapped_column(String(20))
    candidate: Mapped[dict] = mapped_column(JSON)
    work: Mapped[dict] = mapped_column(JSON, default=dict)
    work_version: Mapped[int] = mapped_column(Integer, default=0)
    hidden: Mapped[bool] = mapped_column(default=False)


def safe_source(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parsed = urlsplit(value)
        return (
            value
            if parsed.scheme == "https"
            and parsed.hostname in ("prod1.seace.gob.pe", "prod2.seace.gob.pe", "prod4.seace.gob.pe")
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
            else None
        )
    except ValueError:
        return None


def pull_changes(cursor: int):
    token = read_secret("RADAR_MEOWLAB_TOKEN")
    if not token:
        raise HTTPException(503, "Falta conectar la cuenta de WhatsApp del piloto.")
    url = f"{MEOWLAB}/sync?after={cursor}&limit=100"
    # Fixed destination; credentials are never accepted from the browser.
    with httpx.Client(timeout=25, follow_redirects=False) as client:
        with client.stream(
            "GET",
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "RadarComprasDesktop/0.5 (+https://radar.meowlab.tech)",
                "Accept": "application/json",
            },
        ) as response:
            if response.status_code != 200:
                # Preserve the authorization contract used by the preparation worker.
                raise HTTPError(url, response.status_code, "meowlab_sync_failed", {}, None)
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 4_194_304:
                    raise ValueError("sync_response_too_large")
                chunks.append(chunk)
            return json.loads(b"".join(chunks))


def apply_page(db: Session, owner: str, data: dict):
    state = db.scalar(select(WebAccount).where(WebAccount.id == owner).with_for_update())
    if not state:
        state = WebAccount(id=owner, cursor=0)
        db.add(state)
    changes = data.get("changes")
    cursor = data.get("cursor")
    if (
        data.get("status") != "ok"
        or not isinstance(changes, list)
        or len(changes) > 100
        or type(cursor) is not int
        or cursor < state.cursor
    ):
        raise ValueError("invalid_sync_page")
    previous = state.cursor
    for change in changes:
        seq = change.get("seq")
        candidate = change.get("candidate", {})
        alert = candidate.get("alert", {})
        ocid = change.get("ocid")
        if (
            type(seq) is not int
            or seq <= previous
            or seq > cursor
            or not isinstance(ocid, str)
            or len(ocid) > 200
            or alert.get("ocid") != ocid
            or change.get("state") not in ("interesting", "dismissed")
        ):
            raise ValueError("invalid_sync_change")
        previous = seq
        key = hashlib.sha256(f"{owner}\0{ocid}".encode()).hexdigest()
        item = db.get(WebOpportunity, key)
        if not item:
            item = WebOpportunity(
                key=key,
                account=owner,
                ocid=ocid,
                revision=0,
                selection="dismissed",
                candidate={},
                work={},
                work_version=0,
                hidden=False,
            )
            db.add(item)
        if seq > item.revision:
            item.candidate, item.revision, item.selection = candidate, seq, change["state"]
            if change["state"] == "interesting":
                item.hidden = False
    if previous != cursor:
        raise ValueError("invalid_sync_cursor")
    state.cursor = cursor
    db.flush()
    from .preparation import enqueue_selected
    enqueue_selected(db, owner)
    db.commit()
    return len(changes)


@router.post("/sync")
def sync(owner: str = Depends(account), db: Session = Depends(get_db)):
    state = db.get(WebAccount, owner)
    try:
        data = pull_changes(state.cursor if state else 0)
        count = apply_page(db, owner, data)
        return {"updated": count, "more": count == 100}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.warning("[tender-service] selection_sync_failed")
        raise HTTPException(503, "No pudimos actualizar desde WhatsApp. Tus licitaciones guardadas siguen disponibles.") from None


def present(item: WebOpportunity):
    from sqlalchemy.orm import object_session
    from .workspace_bases import context_version, metadata
    uploaded = metadata(object_session(item), item.account, item.key)
    candidate = item.candidate
    alert = dict(candidate.get("alert", {}))
    alert["sourceUrl"] = safe_source(alert.get("sourceUrl"))
    evidence = candidate.get("evidence") or {}
    documents = [
        {"title": str(d.get("title", "Documento"))[:200], "url": safe_source(d.get("url"))}
        for d in evidence.get("documents", [])[:20]
        if isinstance(d, dict) and safe_source(d.get("url"))
    ]
    return {
        "id": item.key,
        "alert": alert,
        "selection": item.selection,
        "hidden": item.hidden,
        "items": evidence.get("items", [])[:20],
        "documents": documents,
        "work": item.work,
        "version": item.work_version,
        "observedAt": evidence.get("observedAt"),
        "basesUploaded": bool(uploaded),
        "uploadedBases": uploaded,
        "knowledgeVersion": context_version(object_session(item), item.account, item.key),
    }


@router.get("/opportunities")
def opportunities(owner: str = Depends(account), db: Session = Depends(get_db), portal_company: str | None = None):
    if portal_company is not None and (not portal_company or portal_company != os.getenv("RADAR_PORTAL_COMPANY_ID", "").strip()):
        raise HTTPException(403, "Esta cuenta de Tender Cat no está vinculada a la empresa elegida en MeowLab.")
    items = db.scalars(
        select(WebOpportunity).where(WebOpportunity.account == owner).order_by(WebOpportunity.revision.desc())
    ).all()
    return {"opportunities": [present(item) for item in items]}


class QuoteLine(BaseModel):
    description: str = Field(min_length=1, max_length=1000)
    quantity: Decimal = Field(gt=0, le=1_000_000_000)
    unit: str = Field(min_length=1, max_length=60)
    price: Decimal = Field(ge=0, le=1_000_000_000)
    currency: Literal["PEN", "USD"] = "PEN"
    source: str = Field(min_length=1, max_length=2048)
    requirementId: str | None = Field(default=None, max_length=64)
    inputPrice: Decimal | None = Field(default=None, ge=0, le=1_000_000_000)
    priceUnit: str | None = Field(default=None, max_length=60)
    conversionFactor: Decimal | None = Field(default=None, gt=0, le=1_000_000_000)
    observedAt: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def normalize_price(self):
        for field in ("description", "unit", "source"):
            value = getattr(self, field).strip()
            if not value:
                raise ValueError("Completa descripción, unidad y procedencia del precio.")
            setattr(self, field, value)
        if self.inputPrice is not None:
            if not self.conversionFactor or not self.priceUnit or not self.priceUnit.strip():
                raise ValueError("Indica la unidad del precio y su equivalencia.")
            self.price = self.inputPrice / self.conversionFactor
            if self.price > 1_000_000_000:
                raise ValueError("Precio normalizado fuera del límite.")
        return self


class Work(BaseModel):
    version: int = Field(ge=0)
    notes: str = Field(default="", max_length=30_000)
    document: str = Field(default="", max_length=100_000)
    quotes: list[QuoteLine] = Field(default_factory=list, max_length=200)
    hidden: bool = False
    documentEdits: dict[str, str] = Field(default_factory=dict, max_length=60)
    checklist: list[str] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def bounded_documents(self):
        if sum(len(v) for v in self.documentEdits.values()) > 1_000_000 or any(
            len(k) > 80 or len(v) > 100000 for k, v in self.documentEdits.items()
        ):
            raise ValueError("Los borradores exceden el tamaño permitido.")
        return self


@router.put("/opportunities/{key}")
def save_work(key: str, payload: Work, owner: str = Depends(account), db: Session = Depends(get_db)):
    item = db.scalar(
        select(WebOpportunity).where(WebOpportunity.key == key, WebOpportunity.account == owner).with_for_update()
    )
    if not item:
        raise HTTPException(404, "Esta licitación no está disponible en tu cuenta.")
    if item.work_version != payload.version:
        raise HTTPException(409, "Hay cambios más recientes. Actualiza la página antes de guardar.")
    incoming = payload.model_dump(mode="json", exclude={"version", "hidden"})
    stored = Work(version=item.work_version, **item.work).model_dump(mode="json", exclude={"version", "hidden"})
    if incoming != stored:
        from .workspace_bases import require_bases
        require_bases(db, owner, key)
    from datetime import datetime, timezone
    if payload.quotes:
        from .workspace_bases import has_bases
        if has_bases(db, owner, key):
            from .tender_work import current_workspace
            requirements = {r["id"]: r for r in current_workspace(db, owner, key)[1]["requirements"]}
            for quote in payload.quotes:
                requirement = requirements.get(quote.requirementId)
                if requirement:
                    if not requirement["quantity"] or not requirement["unit"]:
                        raise HTTPException(409, "Primero completa la lectura de cantidad y unidad de las bases.")
                    if quote.unit != requirement["unit"]:
                        raise HTTPException(409, "La unidad cambió en las bases. Vuelve a abrir el precio de esta partida.")
                    quote.quantity = Decimal(requirement["quantity"])
                    quote.description = requirement["name"]

    def signature(quote):
        return {k: v for k, v in quote.items() if k != "observedAt"}

    for quote in payload.quotes:
        prior = next(
            (old for old in stored["quotes"] if signature(old) == signature(quote.model_dump(mode="json"))),
            None,
        )
        quote.observedAt = prior.get("observedAt") if prior else datetime.now(timezone.utc).isoformat()
    result = db.execute(
        update(WebOpportunity)
        .where(
            WebOpportunity.key == key,
            WebOpportunity.account == owner,
            WebOpportunity.work_version == payload.version,
        )
        .values(
            work=payload.model_dump(mode="json", exclude={"version", "hidden"}),
            hidden=payload.hidden,
            work_version=payload.version + 1,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Hay cambios más recientes. Actualiza la página antes de guardar.")
    from .preparation import enqueue_selected
    enqueue_selected(db, owner, [key])
    db.commit()
    db.refresh(item)
    return present(item)
