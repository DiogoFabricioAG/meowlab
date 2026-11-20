"""Durable preparation outbox and worker, independent of any browser session."""
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from uuid import uuid4
from urllib.error import HTTPError

from fastapi import Depends, HTTPException
from sqlalchemy import BigInteger, Integer, JSON, String, and_, or_, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base
from .workspace import WebOpportunity, account, get_db, router
from .business_profile import WebBusiness

logger = logging.getLogger(__name__)
PROCESSOR_VERSION = "uploaded-bases-workspace-v4"
LEASE_SECONDS = 1800
KINDS = ("products", "documents")


class PreparationJob(Base):
    __tablename__ = "radar_preparation_jobs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100), index=True)
    opportunity: Mapped[str] = mapped_column(String(64), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), index=True, default="queued")
    sections: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_until: Mapped[int] = mapped_column(BigInteger, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    available_at: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at: Mapped[int] = mapped_column(BigInteger)


def memory_for(db, owner):
    row = db.get(WebBusiness, owner)
    return row.memory if row else {}


def fingerprint(candidate, memory):
    return hashlib.sha256(json.dumps([PROCESSOR_VERSION, candidate, memory], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def job_id(item, memory):
    from sqlalchemy.orm import object_session
    from .workspace_bases import metadata
    uploaded = metadata(object_session(item), item.account, item.key)
    value = fingerprint({"candidate": item.candidate, "uploadedBases": uploaded}, memory)
    return hashlib.sha256(f"{item.account}:{item.key}:{value}".encode()).hexdigest(), value


def enqueue_selected(db: Session, owner: str, keys=None, force=False):
    """Caller owns the transaction: selection, cursor and outbox commit together."""
    query = select(WebOpportunity).where(WebOpportunity.account == owner)
    if keys is not None:
        if not keys:
            return 0
        query = query.where(WebOpportunity.key.in_(keys))
    memory = memory_for(db, owner)
    now = int(time.time())
    enqueued = 0
    for item in db.scalars(query).all():
        from .workspace_bases import has_bases
        active = item.selection == "interesting" and not item.hidden and has_bases(db, owner, item.key)
        identifier, version = job_id(item, memory)
        # Cancel old queued/running generations without deleting their evidence.
        obsolete = update(PreparationJob).where(PreparationJob.account == owner, PreparationJob.opportunity == item.key,
                    PreparationJob.status.in_(["queued", "running"]))
        if active:
            obsolete = obsolete.where(PreparationJob.id != identifier)
        db.execute(obsolete.values(status="superseded", lease_token=None, lease_until=0, updated_at=now))
        if not active:
            continue
        existing = db.get(PreparationJob, identifier)
        if existing:
            if (force and existing.status != "running") or existing.status == "superseded":
                existing.status, existing.available_at, existing.attempts = "queued", now, 0
                existing.updated_at = now
                enqueued += 1
            continue
        db.add(PreparationJob(id=identifier, account=owner, opportunity=item.key, fingerprint=version,
               status="queued", sections={}, attempts=0, lease_until=0, available_at=now, updated_at=now))
        enqueued += 1
    return enqueued


def claim_job(db: Session, owner: str, now=None):
    # Cancels legacy automatic-download jobs, including after a deployment/restart.
    enqueue_selected(db, owner)
    now = int(time.time()) if now is None else now
    # Exhausted crashed runs require an explicit retry; never spin on them forever.
    db.execute(update(PreparationJob).where(PreparationJob.account == owner, PreparationJob.status == "running",
               PreparationJob.lease_until <= now, PreparationJob.attempts >= 3).values(status="failed", lease_token=None, updated_at=now))
    candidate = db.scalar(select(PreparationJob).join(WebOpportunity, WebOpportunity.key == PreparationJob.opportunity).where(PreparationJob.account == owner, PreparationJob.attempts < 3,
                 PreparationJob.available_at <= now, or_(PreparationJob.status == "queued", and_(PreparationJob.status == "running", PreparationJob.lease_until <= now)))
                 .order_by(WebOpportunity.revision.desc(), PreparationJob.updated_at, PreparationJob.id).with_for_update(skip_locked=True).limit(1))
    if not candidate:
        db.commit()
        return None
    token = uuid4().hex
    changed = db.execute(update(PreparationJob).where(PreparationJob.id == candidate.id,
              or_(PreparationJob.status == "queued", and_(PreparationJob.status == "running", PreparationJob.lease_until <= now)))
              .values(status="running", lease_token=token, lease_until=now + LEASE_SECONDS, attempts=PreparationJob.attempts + 1, updated_at=now))
    identifier = candidate.id
    db.commit()
    return (identifier, token) if changed.rowcount == 1 else None


def persist_result(db: Session, identifier, token, sections):
    job = db.get(PreparationJob, identifier)
    if not job or job.lease_token != token or job.status != "running":
        return False
    item = db.scalar(select(WebOpportunity).where(WebOpportunity.account == job.account, WebOpportunity.key == job.opportunity))
    from .workspace_bases import has_bases
    current = item and item.selection == "interesting" and not item.hidden and has_bases(db, job.account, item.key) and job.fingerprint == job_id(item, memory_for(db, job.account))[1]
    status = "superseded"
    if current:
        if sections.get("sources", {}).get("status") == "complete" and all(sections.get(kind, {}).get("status") == "ready" for kind in KINDS):
            status = "ready"
        elif any(sections.get(kind, {}).get("findings") for kind in KINDS) or sections.get("sources", {}).get("documents"):
            status = "partial"
        else:
            status = "failed"
    transient_failure = sections.get("sources", {}).get("status") == "unavailable" or any(sections.get(kind, {}).get("status") == "failed" for kind in KINDS)
    retry_at = 0
    if current and transient_failure and job.attempts < 3:
        status = "queued"
        retry_at = int(time.time()) + 60 * (2 ** max(0, job.attempts - 1))
    changed = db.execute(update(PreparationJob).where(PreparationJob.id == identifier, PreparationJob.lease_token == token,
              PreparationJob.status == "running").values(status=status, sections=sections, lease_token=None, lease_until=0, available_at=retry_at, updated_at=int(time.time())))
    db.commit()
    return changed.rowcount == 1


def process_one(session_factory, owner, *, collect=None, analyze=None):
    if analyze is None:
        from .preparation_analysis import analyze_section
        analyze = analyze_section
    with session_factory() as db:
        reservation = claim_job(db, owner)
        if not reservation:
            return False
        identifier, token = reservation
        job = db.get(PreparationJob, identifier)
        item = db.get(WebOpportunity, job.opportunity)
        if not item or item.account != owner or item.selection != "interesting" or item.hidden:
            persist_result(db, identifier, token, {})
            return True
        candidate = json.loads(json.dumps(item.candidate))
        memory = json.loads(json.dumps(memory_for(db, owner)))
        from .workspace_bases import files_for
        uploaded = files_for(db, owner, item.key)
    sections = {}
    try:
        from .workspace_bases import extract_uploaded
        sections["sources"] = collect(candidate) if collect else extract_uploaded(uploaded)
        # Index thematic RAG chunks + pgvector embeddings outside the specialist LLM pool.
        try:
            from .bases_rag import index_opportunity_rag
            with session_factory() as rag_db:
                index_opportunity_rag(rag_db, owner, item.key, sections["sources"])
                rag_db.commit()
        except Exception as exc:
            logger.warning("[radar-preparation] rag_index_failed error=%s", type(exc).__name__)
        # No SQL session crosses threads, and specialists see only this job's inputs.
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(analyze, kind, sections["sources"], memory): kind for kind in KINDS}
            for future in as_completed(futures):
                kind = futures[future]
                try:
                    sections[kind] = future.result()
                except Exception:
                    logger.warning("[radar-preparation] specialist_failed kind=%s", kind)
                    sections[kind] = {"status": "failed", "summary": "No pudimos completar este apartado.", "findings": [], "missing": ["Vuelve a intentar la preparación más tarde."]}
    except Exception:
        logger.warning("[radar-preparation] source_collection_failed")
        sections["sources"] = {"status": "unavailable", "documents": [], "notices": [{"code": "collection_failed", "message": "No pudimos leer los archivos cargados. Revisa que se puedan abrir e inténtalo de nuevo.", "sourceId": None}]}
    with session_factory() as db:
        persist_result(db, identifier, token, sections)
    return True


def poll_selections(session_factory, owner, pull=None):
    from .workspace import WebAccount, apply_page, pull_changes
    pull = pull or pull_changes
    # One complete page per tick; sustained loops drain every page without a total cap.
    with session_factory() as db:
        state = db.get(WebAccount, owner)
        data = pull(state.cursor if state else 0)
        count = apply_page(db, owner, data)
        # Also picks up pre-worker selections and memory updates after a restart.
        enqueue_selected(db, owner)
        db.commit()
        return count


def preparation_view(db, owner, key):
    item = db.scalar(select(WebOpportunity).where(WebOpportunity.account == owner, WebOpportunity.key == key))
    if not item:
        raise HTTPException(404, "Esta licitación no está disponible en tu cuenta.")
    from .workspace_bases import metadata
    uploaded = metadata(db, owner, key)
    if not uploaded:
        return {"status": "waiting_for_bases", "updatedAt": None, "sections": {}, "basesUploaded": False, "uploadedBases": []}
    identifier, _ = job_id(item, memory_for(db, owner))
    job = db.get(PreparationJob, identifier)
    if not job:
        return {"status": "not_started", "updatedAt": None, "sections": {}, "basesUploaded": True, "uploadedBases": uploaded}
    # Raw extracted text stays server-side; UI gets source inventory and evidence snippets.
    sections = json.loads(json.dumps(job.sections))
    from .workspace import safe_source
    source_section = sections.get("sources", {})
    inventory = []
    for document in source_section.get("documents", []):
        allowed_upload = next((row for row in uploaded if row["id"] == document.get("id")), None)
        inventory.append({key: document.get(key) for key in ("id", "title", "sha256", "status", "pageCount", "origin")} | {"url": allowed_upload["url"] if allowed_upload else safe_source(document.get("url"))})
    if source_section:
        source_section["documents"] = inventory
    return {"status": job.status, "updatedAt": datetime.fromtimestamp(job.updated_at, timezone.utc).isoformat(), "sections": sections, "basesUploaded": True, "uploadedBases": uploaded}


@router.get("/opportunities/{key}/preparation")
def get_preparation(key: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    return preparation_view(db, owner, key)


@router.post("/opportunities/{key}/preparation")
def retry_preparation(key: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    item = db.scalar(select(WebOpportunity).where(WebOpportunity.account == owner, WebOpportunity.key == key))
    if not item:
        raise HTTPException(404, "Esta licitación no está disponible en tu cuenta.")
    if item.selection != "interesting" or item.hidden:
        raise HTTPException(409, "Recupera o vuelve a marcar esta licitación como interesante antes de prepararla.")
    from .workspace_bases import require_bases
    require_bases(db, owner, key)
    enqueue_selected(db, owner, [key], force=True)
    db.commit()
    return preparation_view(db, owner, key)


def _default_poll_seconds() -> int:
    raw = os.getenv("RADAR_PREPARATION_POLL_SECONDS", "").strip()
    if not raw:
        return 15
    try:
        return max(1, int(raw))
    except ValueError:
        return 15


class PreparationWorker:
    def __init__(self, session_factory, owner, interval=None):
        self.session_factory, self.owner = session_factory, owner
        self.interval = _default_poll_seconds() if interval is None else interval
        self.stop_event = threading.Event()
        self.thread = None

    def cycle(self):
        try:
            count = poll_selections(self.session_factory, self.owner)
        except HTTPError as error:
            logger.warning("[radar-preparation] selection_authorization_pending" if error.code in (401, 403) else "[radar-preparation] selection_poll_pending")
            if error.code in (401, 403):
                return 0, False
            count = 0
        except Exception:
            logger.warning("[radar-preparation] selection_poll_pending")
            count = 0
        # Existing durable jobs can progress even when MeowLab is temporarily unavailable.
        try:
            from .whatsapp_bases import poll_whatsapp_bases
            poll_whatsapp_bases(self.session_factory, self.owner)
        except Exception:
            logger.warning("[radar-preparation] whatsapp_bases_poll_pending")
        try:
            processed = process_one(self.session_factory, self.owner)
        except Exception:
            logger.warning("[radar-preparation] worker_cycle_failed")
            processed = False
        try:
            from .whatsapp_bases import notify_pending_preparations
            notify_pending_preparations(self.session_factory, self.owner)
        except Exception:
            logger.warning("[radar-preparation] preparation_notice_pending")
        return count, processed

    def run(self):
        while not self.stop_event.is_set():
            count, processed = self.cycle()
            if self.stop_event.wait(1 if count == 100 or processed else self.interval):
                break

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self.run, name="radar-preparation", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2)
