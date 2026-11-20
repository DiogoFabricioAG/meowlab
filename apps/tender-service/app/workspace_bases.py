"""Private user-supplied bases. No remote document downloads."""
import hashlib
import io
import time
import zipfile
from urllib.parse import quote
from uuid import uuid4

import fitz
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import LargeBinary, String, Integer, select, func, delete
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base
from .workspace import WebOpportunity, account, get_db, router

MAX_BYTES = 15 * 1024 * 1024
MAX_FILES = 8
MAX_TOTAL_BYTES = 60 * 1024 * 1024


class UploadedBases(Base):
    __tablename__ = "radar_uploaded_bases"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100), index=True)
    opportunity: Mapped[str] = mapped_column(String(64), index=True)
    filename: Mapped[str] = mapped_column(String(180))
    sha256: Mapped[str] = mapped_column(String(64))
    body: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[int] = mapped_column(Integer)


class BasesContext(Base):
    __tablename__ = "radar_bases_context"
    opportunity: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100))
    version: Mapped[str] = mapped_column(String(32))


def context_version(db, owner, key):
    row = db.get(BasesContext, key)
    return row.version if row and row.account == owner else ""


def files_for(db, owner, key):
    return db.scalars(select(UploadedBases).where(UploadedBases.account == owner,
                      UploadedBases.opportunity == key).order_by(UploadedBases.id)).all()


def has_bases(db, owner, key):
    return db.scalar(select(UploadedBases.id).where(UploadedBases.account == owner,
                     UploadedBases.opportunity == key).limit(1)) is not None


def require_bases(db, owner, key):
    if not has_bases(db, owner, key):
        raise HTTPException(409, "Sube las bases de esta licitación antes de conversar o trabajar en ella.")


def file_url(key, identifier):
    return f"/api/workspace/opportunities/{key}/bases/{identifier}"


def metadata(db, owner, key):
    rows = db.execute(select(UploadedBases.id, UploadedBases.filename, UploadedBases.sha256,
                              func.length(UploadedBases.body).label('size')).where(
                              UploadedBases.account == owner, UploadedBases.opportunity == key).order_by(UploadedBases.id)).all()
    return [{"id": row.id, "title": row.filename, "sha256": row.sha256,
             "url": file_url(key, row.id), "bytes": row.size, "origin": "user_upload"} for row in rows]


def validate_file(filename, body):
    if not filename or len(filename) > 180 or any(ord(c) < 32 or c in '/\\' for c in filename):
        raise HTTPException(422, "Usa un nombre de archivo PDF o Word válido.")
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(413, "Cada archivo debe pesar como máximo 15 MB y no estar vacío.")
    try:
        if filename.lower().endswith('.pdf') and body.startswith(b'%PDF-'):
            with fitz.open(stream=body, filetype='pdf') as document:
                if document.needs_pass or not len(document):
                    raise ValueError('unreadable_pdf')
        elif filename.lower().endswith('.docx'):
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                entries = archive.infolist()
                if len(entries) > 2000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024:
                    raise ValueError('expanded_size')
                if any(e.flag_bits & 1 or e.file_size > 20 * 1024 * 1024 for e in entries):
                    raise ValueError('unsafe_zip')
                from .preparation_sources import _extract_docx_chunks
                status, _, _, _ = _extract_docx_chunks(body, 'validation')
                if status == 'failed':
                    raise ValueError('unreadable_docx')
        else:
            raise ValueError('unsupported_format')
    except Exception:
        raise HTTPException(422, "No pudimos abrir ese archivo. Sube un PDF sin contraseña o un documento .docx válido.") from None


def extract_uploaded(rows):
    from .preparation_sources import _extract_pdf_chunks, _extract_docx_chunks
    documents, notices = [], []
    for row in rows:
        if row.filename.lower().endswith('.pdf'):
            status, pages, chunks, warnings = _extract_pdf_chunks(row.body, row.id, row.filename)
        else:
            status, pages, chunks, warnings = _extract_docx_chunks(row.body, row.id)
        documents.append({"id": row.id, "title": row.filename, "url": file_url(row.opportunity, row.id),
                          "sha256": row.sha256, "status": status, "pageCount": pages,
                          "origin": "user_upload", "chunks": chunks})
        notices.extend(warnings)
    return {"status": "complete" if documents and all(d['status'] == 'complete' for d in documents) else "partial",
            "documents": documents, "notices": notices,
            "origin": "user_upload", "scope": "Sólo archivos aportados por el usuario; no se verificó que sean todas las bases oficiales."}


@router.post('/opportunities/{key}/bases')
async def upload_bases(key: str, request: Request, filename: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    item = db.scalar(select(WebOpportunity).where(WebOpportunity.account == owner, WebOpportunity.key == key).with_for_update())
    if not item:
        raise HTTPException(404, "Esta licitación no está disponible en tu cuenta.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Cada archivo debe pesar como máximo 15 MB.")
        body.extend(chunk)
    body = bytes(body)
    validate_file(filename, body)
    digest = hashlib.sha256(body).hexdigest()
    identifier = hashlib.sha256(f'{owner}:{key}:{digest}'.encode()).hexdigest()
    existing = db.get(UploadedBases, identifier)
    if not existing:
        rows = files_for(db, owner, key)
        if len(rows) >= MAX_FILES or sum(len(r.body) for r in rows) + len(body) > MAX_TOTAL_BYTES:
            raise HTTPException(413, "Puedes subir hasta ocho archivos y 60 MB en total por licitación.")
        db.add(UploadedBases(id=identifier, account=owner, opportunity=key, filename=filename,
                            sha256=digest, body=body, created_at=int(time.time())))
        db.flush()
    from .preparation import enqueue_selected
    enqueue_selected(db, owner, [key])
    db.commit()
    from .workspace import present
    return present(item)


@router.get('/opportunities/{key}/bases/{identifier}')
def download_bases(key: str, identifier: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    row = db.scalar(select(UploadedBases).where(UploadedBases.id == identifier, UploadedBases.account == owner,
                    UploadedBases.opportunity == key))
    if not row:
        raise HTTPException(404, "Ese archivo no está disponible en tu cuenta.")
    return Response(row.body, media_type='application/octet-stream',
                    headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(row.filename, safe='')})


@router.delete('/opportunities/{key}/bases/{identifier}')
def remove_bases(key: str, identifier: str, owner: str = Depends(account), db: Session = Depends(get_db)):
    item = db.scalar(select(WebOpportunity).where(WebOpportunity.account == owner, WebOpportunity.key == key).with_for_update())
    row = db.scalar(select(UploadedBases).where(UploadedBases.id == identifier, UploadedBases.account == owner, UploadedBases.opportunity == key))
    if not item or not row:
        raise HTTPException(404, "Ese archivo no está disponible en tu cuenta.")
    db.delete(row)
    from .preparation import PreparationJob, enqueue_selected
    # Remove extracted text, findings and queued jobs; stale workers cannot publish.
    db.execute(delete(PreparationJob).where(PreparationJob.account == owner, PreparationJob.opportunity == key))
    from .tender_market import MarketReferences
    db.execute(delete(MarketReferences).where(MarketReferences.account == owner, MarketReferences.opportunity == key))
    from .bases_rag import delete_opportunity_rag
    delete_opportunity_rag(db, owner, key)
    context = db.get(BasesContext, key)
    if not context:
        context = BasesContext(opportunity=key, account=owner, version=uuid4().hex)
        db.add(context)
    else:
        context.version = uuid4().hex
    db.flush()
    enqueue_selected(db, owner, [key])
    db.commit()
    from .workspace import present
    return present(item)
