"""Isolated tests for MeowLab's native Tender Cat service."""
from __future__ import annotations

import hashlib
import io
import zipfile

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bases_rag, database, main, preparation as prep, security, tender_market, workspace
from app.workspace_bases import UploadedBases

TOKEN = "native-tender-secret-token"
COMPANY = "comp-pilot-1"
OWNER = "pilot-a"


def _pdf_bytes(text: str = "Adquisicion de 100 polos de algodon") -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def service_client(monkeypatch):
    monkeypatch.setenv("TENDER_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("RADAR_PORTAL_COMPANY_ID", COMPANY)
    monkeypatch.setenv("RADAR_WEB_ACCOUNT", OWNER)
    monkeypatch.setenv("RADAR_PREPARATION_ENABLED", "0")

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    database.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", factory)
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "SessionLocal", factory)

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[database.get_db] = override_get_db
    with TestClient(main.app) as client:
        yield client, factory, engine
    main.app.dependency_overrides.clear()
    engine.dispose()


def _headers(token: str = TOKEN, company: str = COMPANY) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-MeowLab-Company": company}


def _sync_payload(ocid: str = "ocds-dgv273-seacev3-501", seq: int = 1) -> dict:
    return {
        "status": "ok",
        "cursor": seq,
        "changes": [
            {
                "seq": seq,
                "ocid": ocid,
                "state": "interesting",
                "candidate": {
                    "alert": {
                        "ocid": ocid,
                        "code": "AS-SM-501-2026-MML-1",
                        "description": "Adquisicion de polos institucionales",
                        "buyer": "Municipalidad de Lima",
                        "amount": "PEN 25000",
                        "deadline": "2026-12-01T17:00:00Z",
                        "sourceUrl": "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/501/2",
                    },
                    "evidence": {
                        "sourceUrl": "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/501/2",
                        "observedAt": "2026-11-20T10:00:00Z",
                        "items": [{"description": "Polo algodon", "quantity": 100, "unit": "UNIDAD"}],
                        "documents": [],
                    },
                },
            }
        ],
    }


def test_health_and_fail_closed_auth(service_client, monkeypatch, tmp_path):
    client, _, _ = service_client
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "tender-native"}

    # Missing Bearer -> 401
    r1 = client.get("/api/workspace/opportunities", headers={"X-MeowLab-Company": COMPANY})
    assert r1.status_code == 401
    assert r1.headers["cache-control"] == "no-store"
    assert r1.headers["x-content-type-options"] == "nosniff"

    # Wrong Bearer -> 401
    assert client.get("/api/workspace/opportunities", headers=_headers(token="wrong")).status_code == 401

    # Cross-company header -> 403
    assert client.get("/api/workspace/opportunities", headers=_headers(company="other-company")).status_code == 403

    # Missing server config -> fail closed 503
    monkeypatch.delenv("TENDER_SERVICE_TOKEN")
    assert client.get("/api/workspace/opportunities", headers=_headers()).status_code == 503

    # *_FILE Docker Secret support (TENDER_SERVICE_TOKEN_FILE, RADAR_MEOWLAB_TOKEN_FILE, RADAR_OPENAI_API_KEY_FILE)
    secret_file = tmp_path / "tender_token"
    secret_file.write_text("file-secret-123\n", encoding="utf-8")
    monkeypatch.setenv("TENDER_SERVICE_TOKEN_FILE", str(secret_file))
    assert client.get("/api/workspace/opportunities", headers=_headers(token="file-secret-123")).status_code == 200

    meowlab_file = tmp_path / "meowlab_token"
    meowlab_file.write_text("meowlab-file-secret\n", encoding="utf-8")
    monkeypatch.setenv("RADAR_MEOWLAB_TOKEN_FILE", str(meowlab_file))
    assert security.read_secret("RADAR_MEOWLAB_TOKEN") == "meowlab-file-secret"

    openai_file = tmp_path / "openai_key"
    openai_file.write_text("sk-file-secret\n", encoding="utf-8")
    monkeypatch.setenv("RADAR_OPENAI_API_KEY_FILE", str(openai_file))
    assert bases_rag._openai_api_key() == "sk-file-secret"


def test_cross_account_ownership_by_key_returns_404(service_client):
    client, factory, _ = service_client
    other_key = hashlib.sha256(b"other-owner:ocds-dgv273-seacev3-999").hexdigest()
    with factory() as db:
        db.add(
            workspace.WebOpportunity(
                key=other_key,
                account="other-owner",
                ocid="ocds-dgv273-seacev3-999",
                revision=1,
                selection="interesting",
                candidate={"alert": {"ocid": "ocds-dgv273-seacev3-999", "code": "OTHER-1"}},
            )
        )
        db.commit()

    h = _headers()
    assert client.get("/api/workspace/opportunities", headers=h).json() == {"opportunities": []}
    assert client.get(f"/api/workspace/opportunities/{other_key}/preparation", headers=h).status_code == 404
    assert client.get(f"/api/workspace/opportunities/{other_key}/case-work", headers=h).status_code == 404
    assert client.get(f"/api/workspace/opportunities/{other_key}/market", headers=h).status_code == 404
    assert client.get(f"/api/workspace/opportunities/{other_key}/documents.zip", headers=h).status_code == 404
    assert client.put(
        f"/api/workspace/opportunities/{other_key}",
        headers=h,
        json={"version": 0, "notes": "hack"},
    ).status_code == 404
    assert client.post(
        f"/api/workspace/opportunities/{other_key}/bases?filename=bases.pdf",
        headers=h,
        content=_pdf_bytes(),
    ).status_code == 404


def test_full_native_lifecycle_bases_preparation_work_market_and_exports(service_client, monkeypatch):
    client, factory, _ = service_client
    h = _headers()

    # 1. Sync selections from MeowLab
    monkeypatch.setattr(workspace, "pull_changes", lambda cursor: _sync_payload())
    sync_resp = client.post("/api/workspace/sync", headers=h)
    assert sync_resp.status_code == 200
    assert sync_resp.json() == {"updated": 1, "more": False}

    opps = client.get("/api/workspace/opportunities", headers=h).json()["opportunities"]
    assert len(opps) == 1
    key = opps[0]["id"]

    # 2. Upload PDF bases & download back
    pdf = _pdf_bytes()
    up_resp = client.post(f"/api/workspace/opportunities/{key}/bases?filename=Bases_Integradas.pdf", headers=h, content=pdf)
    assert up_resp.status_code == 200
    up_data = up_resp.json()
    assert up_data["basesUploaded"] is True
    base_id = up_data["uploadedBases"][0]["id"]
    assert client.get(f"/api/workspace/opportunities/{key}/bases/{base_id}", headers=h).content == pdf

    # 3. Preparation run (mocked specialist analysis)
    def fake_analyze(kind, sources, memory):
        if kind == "products":
            return {
                "status": "ready",
                "summary": "Polos institucionales",
                "findings": [
                    {
                        "text": "Polo de algodon",
                        "item": {"name": "Polo de algodon", "kind": "product", "quantityText": "100", "unit": "UNIDAD"},
                        "evidence": [{"sourceId": base_id, "locator": "page:1", "quote": "100 polos"}],
                    }
                ],
                "missing": [],
            }
        return {
            "status": "ready",
            "summary": "Anexo 1 requerido",
            "findings": [
                {
                    "text": "Anexo 1",
                    "format": {
                        "title": "Anexo 1 - Declaracion Jurada",
                        "sourceId": base_id,
                        "startLocator": "page:1",
                        "endLocator": "page:1",
                        "stage": "Admision",
                    },
                    "evidence": [{"sourceId": base_id, "locator": "page:1", "quote": "Anexo 1"}],
                }
            ],
            "missing": [],
        }

    assert prep.process_one(factory, OWNER, analyze=fake_analyze) is True
    prep_view = client.get(f"/api/workspace/opportunities/{key}/preparation", headers=h).json()
    assert prep_view["status"] == "ready"

    # 4. Case-work (requirements + documents: index + Anexo 1)
    case_work = client.get(f"/api/workspace/opportunities/{key}/case-work", headers=h).json()
    assert len(case_work["requirements"]) == 1
    assert len(case_work["documents"]) == 2
    req_id = case_work["requirements"][0]["id"]
    doc_id = case_work["documents"][1]["id"]

    # 5. Versioned save (quotes + notes + checklist + documentEdits) and optimistic lock 409
    save_payload = {
        "version": 0,
        "notes": "Revisar talla M y L",
        "quotes": [
            {
                "description": "Polo de algodon",
                "quantity": 100,
                "unit": "UNIDAD",
                "price": 18.5,
                "currency": "PEN",
                "source": "Cotizacion proveedor local",
                "requirementId": req_id,
            }
        ],
        "checklist": [doc_id],
        "documentEdits": {doc_id: "DECLARACION JURADA\nRUC: 20123456789"},
    }
    saved = client.put(f"/api/workspace/opportunities/{key}", headers=h, json=save_payload)
    assert saved.status_code == 200
    assert saved.json()["version"] == 1
    assert client.put(f"/api/workspace/opportunities/{key}", headers=h, json=save_payload).status_code == 409

    # 6. Market references
    with factory() as db:
        tender_market.save_references(
            db,
            OWNER,
            key,
            {req_id: [{"url": "https://proveedor.pe/polo", "title": "Proveedor", "price": "18.50", "currency": "PEN"}]},
        )
        db.commit()
    market = client.get(f"/api/workspace/opportunities/{key}/market", headers=h).json()
    assert req_id in market["references"]

    # 7. DOCX & ZIP exports
    docx_resp = client.get(f"/api/workspace/opportunities/{key}/documents/{doc_id}.docx", headers=h)
    assert docx_resp.status_code == 200
    assert docx_resp.content[:2] == b"PK"

    zip_resp = client.get(f"/api/workspace/opportunities/{key}/documents.zip", headers=h)
    assert zip_resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        assert any(name.endswith(".docx") for name in zf.namelist())

    # 8. Delete uploaded base
    del_resp = client.delete(f"/api/workspace/opportunities/{key}/bases/{base_id}", headers=h)
    assert del_resp.status_code == 200
    assert del_resp.json()["basesUploaded"] is False


def test_sync_preserves_preexisting_row_cursor_work_and_bases(service_client, monkeypatch):
    client, factory, _ = service_client
    ocid = "ocds-dgv273-seacev3-777"
    legacy_key = hashlib.sha256(f"{OWNER}\0{ocid}".encode()).hexdigest()
    pdf = _pdf_bytes("Bases preexistentes")
    digest = hashlib.sha256(pdf).hexdigest()
    base_id = hashlib.sha256(f"{OWNER}:{legacy_key}:{digest}".encode()).hexdigest()
    saved_work = {
        "notes": "Notas previas del equipo",
        "document": "",
        "quotes": [],
        "documentEdits": {"doc-1": "Borrador guardado"},
        "checklist": ["doc-1"],
    }

    with factory() as db:
        db.add(workspace.WebAccount(id=OWNER, cursor=5))
        db.add(
            workspace.WebOpportunity(
                key=legacy_key,
                account=OWNER,
                ocid=ocid,
                revision=4,
                selection="dismissed",
                candidate={"alert": {"ocid": ocid, "code": "AS-777-OLD"}},
                work=saved_work,
                work_version=3,
                hidden=True,
            )
        )
        db.add(
            UploadedBases(
                id=base_id,
                account=OWNER,
                opportunity=legacy_key,
                filename="bases_previas.pdf",
                sha256=digest,
                body=pdf,
                created_at=100,
            )
        )
        db.commit()

    sync_page = _sync_payload(ocid=ocid, seq=6)
    sync_page["changes"][0]["candidate"]["alert"]["code"] = "AS-777-NEW"
    monkeypatch.setattr(workspace, "pull_changes", lambda cursor: sync_page if cursor == 5 else {"status": "ok", "cursor": cursor, "changes": []})

    resp = client.post("/api/workspace/sync", headers=_headers())
    assert resp.status_code == 200
    assert resp.json() == {"updated": 1, "more": False}

    with factory() as db:
        all_opps = db.scalars(select(workspace.WebOpportunity)).all()
        assert len(all_opps) == 1
        row = all_opps[0]
        assert row.key == legacy_key
        assert row.revision == 6
        assert row.selection == "interesting"
        assert row.hidden is False
        assert row.candidate["alert"]["code"] == "AS-777-NEW"
        assert row.work == saved_work
        assert row.work_version == 3
        assert db.get(workspace.WebAccount, OWNER).cursor == 6
        assert db.get(UploadedBases, base_id) is not None
        assert db.scalar(select(prep.PreparationJob)) is not None

    # Verify safe_source rejects non-SEACE hosts and custom ports
    assert workspace.safe_source("https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/777/2") is not None
    assert workspace.safe_source("https://prod4.seace.gob.pe:8086/api/test") is None
    assert workspace.safe_source("https://evil.seace.gob.pe/test") is None


def test_replace_bases_atomic_preserves_work_and_enforces_isolation(service_client):
    client, factory, _ = service_client
    ocid = "ocds-dgv273-seacev3-888"
    h = _headers()

    # Seed opportunity with two bases and saved work (quotes + documentEdits).
    with factory() as db:
        opp = workspace.WebOpportunity(
            key=hashlib.sha256(f"{OWNER}\0{ocid}".encode()).hexdigest(),
            account=OWNER,
            ocid=ocid,
            revision=1,
            selection="interesting",
            candidate={"alert": {"ocid": ocid, "code": "AS-888", "description": "Compra de prueba"}},
            work={
                "quotes": [{"description": "Item 1", "quantity": "2", "unit": "und", "price": "50", "currency": "PEN", "source": "Manual"}],
                "documentEdits": {"doc-1": "Borrador intacto"},
                "checklist": ["doc-1"],
            },
            work_version=4,
            hidden=False,
        )
        db.add(opp)
        db.commit()
        key = opp.key

    pdf_one = _pdf_bytes("Bases iniciales uno")
    pdf_two = _pdf_bytes("Bases iniciales dos")
    r1 = client.post(f"/api/workspace/opportunities/{key}/bases?filename=bases_1.pdf", headers=h, content=pdf_one)
    assert r1.status_code == 200
    r2 = client.post(f"/api/workspace/opportunities/{key}/bases?filename=bases_2.pdf", headers=h, content=pdf_two)
    assert r2.status_code == 200
    data_before = r2.json()
    assert len(data_before["uploadedBases"]) == 2
    base1_id = data_before["uploadedBases"][0]["id"]
    base2_id = data_before["uploadedBases"][1]["id"]
    version_before = data_before["knowledgeVersion"]

    # 1. Invalid replacement file (bad extension / bad bytes) preserves previous files, version and work.
    bad_ext = client.post(
        f"/api/workspace/opportunities/{key}/bases?filename=malicioso.exe&replace={base1_id}",
        headers=h,
        content=b"MZ\x90\x00not-a-pdf",
    )
    assert bad_ext.status_code == 422
    bad_bytes = client.post(
        f"/api/workspace/opportunities/{key}/bases?filename=falso.pdf&replace={base1_id}",
        headers=h,
        content=b"<html>not a pdf</html>",
    )
    assert bad_bytes.status_code == 422
    still_there = client.get(f"/api/workspace/opportunities/{key}/bases/{base1_id}", headers=h)
    assert still_there.status_code == 200
    assert still_there.content == pdf_one

    # 2. Cross-company / unknown replace target is rejected.
    other_headers = {**h, "X-MeowLab-Company": "company-b"}
    cross = client.post(
        f"/api/workspace/opportunities/{key}/bases?filename=otra.pdf&replace={base1_id}",
        headers=other_headers,
        content=_pdf_bytes("Intento ajeno"),
    )
    assert cross.status_code in (403, 404)
    missing_target = client.post(
        f"/api/workspace/opportunities/{key}/bases?filename=otra.pdf&replace=inexistente",
        headers=h,
        content=_pdf_bytes("Destino inexistente"),
    )
    assert missing_target.status_code == 404

    # 3. Valid replacement atomically swaps base1_id, keeps base2_id, preserves work, bumps knowledgeVersion & enqueues job.
    pdf_new = _pdf_bytes("Bases actualizadas v2")
    replaced = client.post(
        f"/api/workspace/opportunities/{key}/bases?filename=bases_1_v2.pdf&replace={base1_id}",
        headers=h,
        content=pdf_new,
    )
    assert replaced.status_code == 200
    after = replaced.json()
    after_ids = [b["id"] for b in after["uploadedBases"]]
    assert base1_id not in after_ids
    assert base2_id in after_ids
    assert len(after_ids) == 2
    assert after["knowledgeVersion"] != version_before
    assert after["work"]["quotes"][0]["price"] == "50"
    assert after["work"]["documentEdits"] == {"doc-1": "Borrador intacto"}
    new_base_id = [b["id"] for b in after["uploadedBases"] if b["id"] != base2_id][0]
    assert client.get(f"/api/workspace/opportunities/{key}/bases/{base1_id}", headers=h).status_code == 404
    assert client.get(f"/api/workspace/opportunities/{key}/bases/{new_base_id}", headers=h).content == pdf_new

    with factory() as db:
        job = db.scalar(select(prep.PreparationJob).where(prep.PreparationJob.account == OWNER, prep.PreparationJob.opportunity == key))
        assert job is not None

    # 4. Repeating replacement with the exact same file is idempotent.
    repeat = client.post(
        f"/api/workspace/opportunities/{key}/bases?filename=bases_1_v2.pdf&replace={new_base_id}",
        headers=h,
        content=pdf_new,
    )
    assert repeat.status_code == 200
    assert new_base_id in [b["id"] for b in repeat.json()["uploadedBases"]]


