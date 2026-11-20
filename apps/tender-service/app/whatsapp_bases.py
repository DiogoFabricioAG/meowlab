"""Ingest WhatsApp-supplied bases and send grounded preparation notices back."""
from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from typing import Any, Callable
from urllib.error import HTTPError

import httpx
from fastapi import HTTPException
from sqlalchemy import BigInteger, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base
from .preparation import KINDS, PreparationJob, enqueue_selected, job_id, memory_for
from .workspace import MEOWLAB, WebOpportunity
from .workspace_bases import MAX_BYTES, MAX_FILES, MAX_TOTAL_BYTES, UploadedBases, files_for, has_bases, validate_file

logger = logging.getLogger(__name__)

PORTAL_TENDER_URL = "https://app.meowlab.tech/agentes/licitaciones"
MAX_NOTICE_ATTEMPTS = 5
MAX_SUMMARY_CHARS = 3000
UPLOAD_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)
USER_AGENT = "RadarComprasDesktop/0.5 (+https://radar.meowlab.tech)"


class PreparationNotice(Base):
    __tablename__ = "radar_preparation_notices"
    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100), index=True)
    opportunity: Mapped[str] = mapped_column(String(64), index=True)
    ocid: Mapped[str] = mapped_column(String(200))
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), index=True, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_retry_at: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class WhatsappBasesRequest(Base):
    __tablename__ = "radar_whatsapp_bases_requests"
    opportunity: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100), index=True)
    ocid: Mapped[str] = mapped_column(String(200))
    requested_at: Mapped[int] = mapped_column(BigInteger)


def _clean(value: Any, limit: int = 300) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x1f]+", " ", value)
    return re.sub(r"\s+", " ", cleaned).strip()[:limit]


def _meowlab_headers(accept: str = "application/json") -> dict[str, str]:
    token = os.getenv("RADAR_MEOWLAB_TOKEN", "").strip()
    if not token:
        raise ValueError("meowlab_not_configured")
    return {
        "Authorization": f"Bearer {token}",
        "User-Agent": USER_AGENT,
        "Accept": accept,
    }


def _default_get_json(path: str) -> tuple[int, Any]:
    url = MEOWLAB + path
    with httpx.Client(timeout=25, follow_redirects=False) as client:
        with client.stream("GET", url, headers=_meowlab_headers("application/json")) as response:
            if response.status_code != 200:
                return response.status_code, {}
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 1_048_576:
                    raise ValueError("response_too_large")
                chunks.append(chunk)
            return response.status_code, response.json() if not chunks else httpx.Response(200, content=b"".join(chunks)).json()


def _default_get_bytes(path: str) -> tuple[int, bytes]:
    url = MEOWLAB + path
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        with client.stream("GET", url, headers=_meowlab_headers("application/octet-stream")) as response:
            if response.status_code != 200:
                return response.status_code, b""
            cl = response.headers.get("content-length")
            if cl and cl.isdigit() and int(cl) > MAX_BYTES:
                return 413, b""
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    return 413, b""
                chunks.append(chunk)
            return 200, b"".join(chunks)


def _default_post_json(path: str, body: dict[str, Any]) -> tuple[int, Any]:
    url = MEOWLAB + path
    with httpx.Client(timeout=25, follow_redirects=False) as client:
        response = client.post(url, headers=_meowlab_headers("application/json"), json=body)
        try:
            data = response.json()
        except Exception:
            data = {}
        return response.status_code, data


def _source_titles(sections: dict[str, Any]) -> dict[str, str]:
    docs = (sections.get("sources") or {}).get("documents") or []
    titles: dict[str, str] = {}
    for doc in docs:
        if isinstance(doc, dict) and doc.get("id"):
            titles[str(doc["id"])] = _clean(doc.get("title") or doc["id"], 80)
    return titles


def _format_locator(locator: str) -> str:
    loc = _clean(locator, 60)
    if loc.startswith("page:"):
        return f"pág. {loc[5:]}"
    if loc.startswith("paragraph:"):
        return f"párr. {loc[10:]}"
    return loc


def build_preparation_summary(
    item: WebOpportunity,
    job: PreparationJob,
    portal_url: str = PORTAL_TENDER_URL,
) -> str:
    """Build a concise, grounded Spanish summary (<= 3000 chars) from PreparationJob sections."""
    candidate = item.candidate if isinstance(item.candidate, dict) else {}
    alert = candidate.get("alert") if isinstance(candidate.get("alert"), dict) else {}
    sections = job.sections if isinstance(job.sections, dict) else {}

    code = _clean(alert.get("code") or item.ocid, 120)
    buyer = _clean(alert.get("buyer"), 160)
    header = f"*{code}*" + (f" · {buyer}" if buyer else "")

    status_label = {
        "ready": "Resumen listo",
        "partial": "Resumen parcial (revisar pendientes)",
        "failed": "No se pudo completar el análisis",
    }.get(job.status, "Estado de preparación")

    products_sec = sections.get("products") if isinstance(sections.get("products"), dict) else {}
    documents_sec = sections.get("documents") if isinstance(sections.get("documents"), dict) else {}
    titles = _source_titles(sections)

    lines: list[str] = [f"{header}\n{status_label}"]

    overview = _clean(
        products_sec.get("summary") or documents_sec.get("summary") or alert.get("description"),
        360,
    )
    if overview:
        lines.append(overview)

    # Up to 5 main items/products, marking [por revisar] when quantity or unit is missing.
    product_findings = products_sec.get("findings") if isinstance(products_sec.get("findings"), list) else []
    part_lines: list[str] = []
    for finding in product_findings[:5]:
        if not isinstance(finding, dict):
            continue
        item_meta = finding.get("item") if isinstance(finding.get("item"), dict) else None
        if item_meta and _clean(item_meta.get("name"), 140):
            name = _clean(item_meta.get("name"), 140)
            qty = _clean(item_meta.get("quantityText"), 40)
            unit = _clean(item_meta.get("unit"), 40)
            if qty and unit:
                qty_part = f"{qty} {unit}"
            elif qty:
                qty_part = f"{qty} [por revisar]"
            else:
                qty_part = "[por revisar]"
            part_lines.append(f"• {name} — {qty_part}")
        else:
            text = _clean(finding.get("text"), 180)
            if text:
                part_lines.append(f"• {text} [por revisar]")
    if part_lines:
        lines.append("*Partidas principales*\n" + "\n".join(part_lines))

    # Up to 4 key documents/requirements citing real locators from findings.evidence.
    doc_findings = documents_sec.get("findings") if isinstance(documents_sec.get("findings"), list) else []
    doc_lines: list[str] = []
    for finding in doc_findings[:4]:
        if not isinstance(finding, dict):
            continue
        text = _clean(finding.get("text"), 200)
        if not text:
            continue
        ev_list = finding.get("evidence") if isinstance(finding.get("evidence"), list) else []
        refs: list[str] = []
        for ev in ev_list[:2]:
            if not isinstance(ev, dict):
                continue
            loc = _format_locator(str(ev.get("locator") or ""))
            src = titles.get(str(ev.get("sourceId") or ""), "")
            ref = " · ".join(part for part in (src, loc) if part)
            if ref and ref not in refs:
                refs.append(ref)
        cite = f" ({'; '.join(refs)})" if refs else ""
        doc_lines.append(f"• {text}{cite}")
    if doc_lines:
        lines.append("*Documentos y requisitos clave*\n" + "\n".join(doc_lines))

    # Pending items / doubts from missing lists.
    missing_items: list[str] = []
    for kind in KINDS:
        sec = sections.get(kind) if isinstance(sections.get(kind), dict) else {}
        for entry in (sec.get("missing") if isinstance(sec.get("missing"), list) else []):
            cleaned = _clean(entry, 160)
            if cleaned and cleaned not in missing_items:
                missing_items.append(cleaned)
            if len(missing_items) >= 4:
                break
        if len(missing_items) >= 4:
            break
    if missing_items:
        lines.append("*Pendientes por revisar*\n" + "\n".join(f"• {m}" for m in missing_items))

    lines.append(f"Ver en el portal: {portal_url}")
    summary = "\n\n".join(lines)
    if len(summary) <= MAX_SUMMARY_CHARS:
        return summary

    footer = f"\n\nVer en el portal: {portal_url}"
    budget = max(0, MAX_SUMMARY_CHARS - len(footer) - 1)
    return summary[:budget].rstrip() + "…" + footer


def poll_whatsapp_bases(
    session_factory,
    owner: str,
    *,
    get_json: Callable[[str], tuple[int, Any]] = _default_get_json,
    get_bytes: Callable[[str], tuple[int, bytes]] = _default_get_bytes,
    post_json: Callable[[str, dict[str, Any]], tuple[int, Any]] = _default_post_json,
    now: Callable[[], int] | None = None,
) -> int:
    """Poll pending WhatsApp base uploads, validate, store idempotently, enqueue and ack."""
    clock = now or (lambda: int(time.time()))
    status, data = get_json("/bases/pending?limit=10")
    if status in (401, 403):
        raise HTTPError(MEOWLAB + "/bases/pending?limit=10", status, "meowlab_unauthorized", {}, None)
    if status != 200 or not isinstance(data, dict):
        return 0
    uploads = data.get("uploads")
    if not isinstance(uploads, list):
        return 0

    accepted_count = 0
    for upload in uploads:
        if not isinstance(upload, dict):
            continue
        upload_id = str(upload.get("id") or "").strip()
        ocid = str(upload.get("ocid") or "").strip()
        filename = str(upload.get("filename") or "").strip()
        expected_sha = str(upload.get("sha256") or "").strip().lower()
        if not UPLOAD_ID_RE.fullmatch(upload_id) or not ocid:
            continue

        with session_factory() as db:
            item = db.scalar(
                select(WebOpportunity).where(
                    WebOpportunity.account == owner,
                    WebOpportunity.ocid == ocid,
                )
            )
            # Sync lag: opportunity not imported yet -> leave pending without rejecting.
            if item is None:
                continue
            if item.hidden or item.selection == "dismissed":
                post_json(
                    f"/bases/{upload_id}/ack",
                    {"status": "rejected", "reason": "Esta licitación fue descartada u ocultada en tu cuenta."},
                )
                continue
            item_key = item.key

        if not SHA256_RE.fullmatch(expected_sha):
            post_json(
                f"/bases/{upload_id}/ack",
                {"status": "rejected", "reason": "Falta una verificación SHA-256 válida para el archivo."},
            )
            continue

        content_status, body = get_bytes(f"/bases/{upload_id}/content")
        if content_status == 413:
            post_json(
                f"/bases/{upload_id}/ack",
                {"status": "rejected", "reason": "Cada archivo debe pesar como máximo 15 MB y no estar vacío."},
            )
            continue
        if content_status != 200:
            # Transient download failure -> leave pending for next cycle.
            continue

        actual_sha = hashlib.sha256(body).hexdigest().lower()
        if actual_sha != expected_sha:
            post_json(
                f"/bases/{upload_id}/ack",
                {"status": "rejected", "reason": "El archivo recibido no coincide con la verificación SHA-256."},
            )
            continue

        try:
            validate_file(filename, body)
        except HTTPException as exc:
            if exc.status_code in (413, 422):
                post_json(
                    f"/bases/{upload_id}/ack",
                    {"status": "rejected", "reason": str(exc.detail)},
                )
            continue

        identifier = hashlib.sha256(f"{owner}:{item_key}:{actual_sha}".encode()).hexdigest()
        with session_factory() as db:
            item = db.scalar(
                select(WebOpportunity).where(
                    WebOpportunity.account == owner,
                    WebOpportunity.key == item_key,
                )
            )
            if item is None:
                continue
            if item.hidden or item.selection == "dismissed":
                post_json(
                    f"/bases/{upload_id}/ack",
                    {"status": "rejected", "reason": "Esta licitación fue descartada u ocultada en tu cuenta."},
                )
                continue

            now_ts = int(clock())
            existing = db.get(UploadedBases, identifier)
            if existing is None:
                current_files = files_for(db, owner, item_key)
                if len(current_files) >= MAX_FILES or sum(len(r.body) for r in current_files) + len(body) > MAX_TOTAL_BYTES:
                    post_json(
                        f"/bases/{upload_id}/ack",
                        {"status": "rejected", "reason": "Puedes subir hasta ocho archivos y 60 MB en total por licitación."},
                    )
                    continue
                db.add(
                    UploadedBases(
                        id=identifier,
                        account=owner,
                        opportunity=item_key,
                        filename=filename,
                        sha256=actual_sha,
                        body=body,
                        created_at=now_ts,
                    )
                )
                db.flush()

            req = db.get(WhatsappBasesRequest, item_key)
            if req is None:
                db.add(
                    WhatsappBasesRequest(
                        opportunity=item_key,
                        account=owner,
                        ocid=item.ocid,
                        requested_at=now_ts,
                    )
                )
            else:
                req.account = owner
                req.ocid = item.ocid
                req.requested_at = now_ts

            enqueue_selected(db, owner, [item_key])
            db.commit()

        ack_status, _ = post_json(f"/bases/{upload_id}/ack", {"status": "accepted"})
        if ack_status == 200:
            accepted_count += 1

    return accepted_count


def notify_pending_preparations(
    session_factory,
    owner: str,
    *,
    post_json: Callable[[str, dict[str, Any]], tuple[int, Any]] = _default_post_json,
    now: Callable[[], int] | None = None,
    portal_url: str = PORTAL_TENDER_URL,
) -> int:
    """Send WhatsApp notices for finished PreparationJobs with uploaded bases."""
    clock = now or (lambda: int(time.time()))
    current_time = int(clock())
    sent_count = 0

    with session_factory() as db:
        memory = memory_for(db, owner)
        requests = db.scalars(
            select(WhatsappBasesRequest)
            .where(WhatsappBasesRequest.account == owner)
            .order_by(WhatsappBasesRequest.requested_at.asc(), WhatsappBasesRequest.opportunity.asc())
        ).all()

        for req in requests:
            item = db.scalar(
                select(WebOpportunity).where(
                    WebOpportunity.account == owner,
                    WebOpportunity.key == req.opportunity,
                )
            )
            if not item or item.hidden or item.selection != "interesting" or not has_bases(db, owner, item.key):
                continue

            current_job_id, _ = job_id(item, memory)
            job = db.get(PreparationJob, current_job_id)
            if not job or job.account != owner or job.status not in ("ready", "partial", "failed"):
                continue

            notice = db.get(PreparationNotice, job.id)
            if notice and notice.status in ("accepted", "failed", "unknown"):
                continue
            if notice and notice.next_retry_at > current_time:
                continue

            alert = item.candidate.get("alert") if isinstance(item.candidate, dict) else {}
            code = _clean((alert or {}).get("code") or item.ocid, 200) or item.ocid
            summary = build_preparation_summary(item, job, portal_url=portal_url)
            payload = {
                "ocid": item.ocid,
                "code": code,
                "jobFingerprint": job.fingerprint,
                "status": job.status,
                "summary": summary,
                "portalUrl": portal_url,
            }

            try:
                status_code, resp = post_json("/preparation-notices", payload)
            except Exception as exc:
                logger.warning("[radar-preparation] notice_send_failed kind=%s", type(exc).__name__)
                status_code, resp = 0, {}

            attempts = (notice.attempts if notice else 0) + 1
            delivered = status_code == 200 and isinstance(resp, dict) and (
                resp.get("status") == "accepted" or resp.get("replayed") is True
            )
            ambiguous = status_code == 200 and isinstance(resp, dict) and resp.get("status") == "unknown"

            if delivered:
                new_status = "accepted"
                retry_at = 0
                sent_count += 1
            elif ambiguous:
                new_status = "unknown"
                retry_at = 0
            elif attempts >= MAX_NOTICE_ATTEMPTS:
                new_status = "failed"
                retry_at = 0
            else:
                new_status = "pending"
                retry_at = current_time + 60 * (2 ** max(0, attempts - 1))

            if notice is None:
                db.add(
                    PreparationNotice(
                        job_id=job.id,
                        account=owner,
                        opportunity=job.opportunity,
                        ocid=item.ocid,
                        fingerprint=job.fingerprint,
                        status=new_status,
                        attempts=attempts,
                        next_retry_at=retry_at,
                        updated_at=current_time,
                    )
                )
            else:
                notice.status = new_status
                notice.attempts = attempts
                notice.next_retry_at = retry_at
                notice.updated_at = current_time
            db.commit()

    return sent_count
