"""Focused tests for tender_work.py document linking and neutral stage/no-fabrication rules."""
from __future__ import annotations

import hashlib

import fitz
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import database, preparation as prep, tender_work, workspace
from app.workspace_bases import UploadedBases


def _pdf_bytes(text: str = "Anexo 1 Declaracion Jurada") -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def _setup(with_format: bool):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    database.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    owner = "pilot-a"
    ocid = "ocds-dgv273-seacev3-901"
    key = hashlib.sha256(f"{owner}\0{ocid}".encode()).hexdigest()
    pdf = _pdf_bytes()
    digest = hashlib.sha256(pdf).hexdigest()
    base_id = hashlib.sha256(f"{owner}:{key}:{digest}".encode()).hexdigest()

    with factory() as db:
        db.add(
            workspace.WebOpportunity(
                key=key,
                account=owner,
                ocid=ocid,
                revision=1,
                selection="interesting",
                candidate={"alert": {"ocid": ocid, "code": "AS-901", "buyer": "Entidad", "description": "Polos"}},
            )
        )
        db.add(UploadedBases(id=base_id, account=owner, opportunity=key, filename="bases.pdf", sha256=digest, body=pdf, created_at=100))
        db.flush()
        prep.enqueue_selected(db, owner, [key])
        db.commit()

    def analyze(kind, _sources, _memory):
        if kind == "products":
            return {"status": "ready", "summary": "Polos", "findings": [], "missing": []}
        finding = {
            "text": "Constancia RNP vigente y Anexo 1",
            "evidence": [{"sourceId": base_id, "locator": "page:1", "quote": "Anexo 1"}],
        }
        if with_format:
            finding["format"] = {
                "title": "Anexo 1 — Declaración Jurada",
                "sourceId": base_id,
                "startLocator": "page:1",
                "endLocator": "page:1",
                "stage": "Oferta / Admisión",
            }
        return {"status": "ready", "summary": "Documentos", "findings": [finding], "missing": []}

    assert prep.process_one(factory, owner, analyze=analyze) is True
    return engine, factory, owner, key


def test_current_workspace_links_check_to_draft_when_format_exists():
    engine, factory, owner, key = _setup(with_format=True)
    try:
        with factory() as db:
            _, view = tender_work.current_workspace(db, owner, key)
            assert [d["title"] for d in view["documents"]] == [
                "00. Índice del expediente",
                "Anexo 1 — Declaración Jurada",
            ]
            assert len(view["checks"]) == 1
            assert view["checks"][0]["documentId"] == view["documents"][1]["id"]
            assert "Obligatorio" not in view["checks"][0]["stage"]
    finally:
        engine.dispose()


def test_current_workspace_without_format_does_not_fabricate_suggested_annexes():
    engine, factory, owner, key = _setup(with_format=False)
    try:
        with factory() as db:
            _, view = tender_work.current_workspace(db, owner, key)
            assert [d["id"] for d in view["documents"]] == ["index"]
            assert len(view["checks"]) == 1
            assert view["checks"][0]["documentId"] is None
    finally:
        engine.dispose()
