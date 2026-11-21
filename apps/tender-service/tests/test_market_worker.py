"""Tests for automatic market price research worker and GET /market status."""
from __future__ import annotations

import hashlib

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import database, main, market_worker, preparation as prep, tender_market, whatsapp_bases as wb, workspace
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


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}", "X-MeowLab-Company": COMPANY}


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("TENDER_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("RADAR_PORTAL_COMPANY_ID", COMPANY)
    monkeypatch.setenv("RADAR_WEB_ACCOUNT", OWNER)
    monkeypatch.setenv("RADAR_PREPARATION_ENABLED", "0")
    monkeypatch.setenv("TENDER_MARKET_ENABLED", "1")
    monkeypatch.setenv("RADAR_OPENAI_API_KEY", "sk-test-key")

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
        yield client, factory
    main.app.dependency_overrides.clear()
    engine.dispose()


def _seed_opportunity(factory, ocid: str = "ocds-dgv273-seacev3-801") -> str:
    key = hashlib.sha256(f"{OWNER}\0{ocid}".encode()).hexdigest()
    with factory() as db:
        db.add(
            workspace.WebOpportunity(
                key=key,
                account=OWNER,
                ocid=ocid,
                revision=1,
                selection="interesting",
                candidate={
                    "alert": {
                        "ocid": ocid,
                        "code": "AS-SM-801-2026-MML-1",
                        "description": "Adquisicion de polos",
                        "buyer": "Municipalidad de Lima",
                    }
                },
                work={
                    "notes": "Precio manual guardado",
                    "document": "",
                    "quotes": [
                        {
                            "description": "Polo algodon",
                            "quantity": "100",
                            "unit": "UNIDAD",
                            "price": "19.50",
                            "currency": "PEN",
                            "source": "Cotizacion directa",
                        }
                    ],
                    "documentEdits": {},
                    "checklist": [],
                },
                work_version=2,
            )
        )
        db.commit()
    return key


def _analyze_items(names: list[str], source_id: str):
    def analyze(kind, _sources, _memory):
        if kind == "products":
            return {
                "status": "ready",
                "summary": "Partidas identificadas",
                "findings": [
                    {
                        "text": name,
                        "item": {"name": name, "kind": "product", "quantityText": "100", "unit": "UNIDAD"},
                        "evidence": [{"sourceId": source_id, "locator": "page:1", "quote": name}],
                    }
                    for name in names
                ],
                "missing": [],
            }
        return {"status": "ready", "summary": "Documentos", "findings": [], "missing": []}

    return analyze


def test_whatsapp_bases_to_automatic_market_without_browser(env):
    client, factory = env
    key = _seed_opportunity(factory)
    pdf = _pdf_bytes()
    digest = hashlib.sha256(pdf).hexdigest()
    base_id = hashlib.sha256(f"{OWNER}:{key}:{digest}".encode()).hexdigest()

    # 1. Ingest bases from WhatsApp (no browser session)
    assert (
        wb.poll_whatsapp_bases(
            factory,
            OWNER,
            get_json=lambda _: (
                200,
                {
                    "uploads": [
                        {
                            "id": "up-801",
                            "ocid": "ocds-dgv273-seacev3-801",
                            "filename": "bases.pdf",
                            "sha256": digest,
                        }
                    ]
                },
            ),
            get_bytes=lambda _: (200, pdf),
            post_json=lambda *_: (200, {"status": "accepted"}),
        )
        == 1
    )

    # Before preparation completes -> automaticStatus is waiting
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json() == {
        "references": {},
        "automaticStatus": "waiting",
    }

    # 2. Preparation worker analyzes bases
    assert prep.process_one(factory, OWNER, analyze=_analyze_items(["Polo pima M", "Gorra drill"], base_id)) is True
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "queued"

    # 3. Market worker researches prices (including one empty [] result)
    searched = []

    def fake_search(batch):
        searched.append([item["id"] for item in batch])
        return {
            batch[0]["id"]: [{"url": "https://proveedor.pe/polo", "title": "Polo", "price": "20.00", "currency": "PEN"}],
            batch[1]["id"]: [],
        }

    assert market_worker.research_one(factory, OWNER, search=fake_search) is True
    assert len(searched) == 1

    market = client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()
    assert market["automaticStatus"] == "complete"
    assert len(market["references"]) == 2

    # Subsequent cycle finds nothing left to research (empty [] was persisted & reused)
    assert market_worker.research_one(factory, OWNER, search=fake_search) is False
    assert len(searched) == 1

    # Saved manual quotes & work_version remain untouched
    with factory() as db:
        opp = db.get(workspace.WebOpportunity, key)
        assert opp.work_version == 2
        assert opp.work["quotes"][0]["price"] == "19.50"


def test_retries_backoff_lease_and_generation_change_reuse(env):
    client, factory = env
    key = _seed_opportunity(factory, ocid="ocds-dgv273-seacev3-802")
    pdf1 = _pdf_bytes("Bases v1")
    digest1 = hashlib.sha256(pdf1).hexdigest()
    base1_id = hashlib.sha256(f"{OWNER}:{key}:{digest1}".encode()).hexdigest()

    with factory() as db:
        db.add(UploadedBases(id=base1_id, account=OWNER, opportunity=key, filename="v1.pdf", sha256=digest1, body=pdf1, created_at=100))
        db.flush()
        prep.enqueue_selected(db, OWNER, [key])
        db.commit()

    assert prep.process_one(factory, OWNER, analyze=_analyze_items(["Polo pima M"], base1_id)) is True

    clock = [1000]

    def fail_search(_batch):
        raise RuntimeError("transient_openai_error")

    # Attempt 1 -> retry
    assert market_worker.research_one(factory, OWNER, search=fail_search, clock=lambda: clock[0]) is True
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "retry"

    # Before backoff expires -> not claimed
    clock[0] += 30
    assert market_worker.research_one(factory, OWNER, search=fail_search, clock=lambda: clock[0]) is False

    # Attempt 2 -> retry, Attempt 3 -> failed
    clock[0] += 120
    assert market_worker.research_one(factory, OWNER, search=fail_search, clock=lambda: clock[0]) is True
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "retry"

    clock[0] += 300
    assert market_worker.research_one(factory, OWNER, search=fail_search, clock=lambda: clock[0]) is True
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "failed"

    # Failed job is not retried again
    clock[0] += 10_000
    assert market_worker.research_one(factory, OWNER, search=fail_search, clock=lambda: clock[0]) is False

    # Upload new PDF (v2) -> new generation, old job superseded; existing refs preserved & reused!
    pdf2 = _pdf_bytes("Bases v2")
    up_v2 = client.post(f"/api/workspace/opportunities/{key}/bases?filename=v2.pdf", headers=_headers(), content=pdf2)
    assert up_v2.status_code == 200
    assert prep.process_one(factory, OWNER, analyze=_analyze_items(["Polo pima M", "Casaca impermeable"], base1_id)) is True

    # Simulate pre-existing empty reference for Polo pima M + concurrent manual refresh for Casaca
    with factory() as db:
        _, view = market_worker.current_workspace(db, OWNER, key)
        req_ids = [r["id"] for r in view["requirements"]]
        tender_market.save_references(db, OWNER, key, {req_ids[0]: []})
        db.commit()

    called_batches = []

    def search_only_new(batch):
        called_batches.append([r["name"] for r in batch])
        return {batch[0]["id"]: [{"url": "https://proveedor.pe/casaca", "title": "Casaca", "price": "85.00", "currency": "PEN"}]}

    assert market_worker.research_one(factory, OWNER, search=search_only_new, clock=lambda: clock[0]) is True
    assert called_batches == [["Casaca impermeable"]]
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "complete"


def test_stale_token_and_removed_bases_are_fenced(env):
    client, factory = env
    key = _seed_opportunity(factory, ocid="ocds-dgv273-seacev3-803")
    pdf = _pdf_bytes("Bases v1")
    digest = hashlib.sha256(pdf).hexdigest()
    base_id = hashlib.sha256(f"{OWNER}:{key}:{digest}".encode()).hexdigest()

    with factory() as db:
        db.add(UploadedBases(id=base_id, account=OWNER, opportunity=key, filename="v1.pdf", sha256=digest, body=pdf, created_at=100))
        db.flush()
        prep.enqueue_selected(db, OWNER, [key])
        db.commit()

    assert prep.process_one(factory, OWNER, analyze=_analyze_items(["Polo pima M"], base_id)) is True

    def remove_bases_mid_flight(batch):
        # User removes bases while search_prices is running!
        assert client.delete(f"/api/workspace/opportunities/{key}/bases/{base_id}", headers=_headers()).status_code == 200
        return {batch[0]["id"]: [{"url": "https://proveedor.pe/polo", "title": "Polo", "price": "20.00", "currency": "PEN"}]}

    assert market_worker.research_one(factory, OWNER, search=remove_bases_mid_flight) is True
    with factory() as db:
        # Stale references must NOT be saved after bases are removed
        assert db.scalars(select(tender_market.MarketReferences)).all() == []
        assert db.scalar(select(prep.PreparationJob)) is None


def test_disabled_status_when_market_worker_off(env, monkeypatch):
    client, factory = env
    key = _seed_opportunity(factory, ocid="ocds-dgv273-seacev3-804")
    pdf = _pdf_bytes("Bases off")
    digest = hashlib.sha256(pdf).hexdigest()
    base_id = hashlib.sha256(f"{OWNER}:{key}:{digest}".encode()).hexdigest()
    with factory() as db:
        db.add(UploadedBases(id=base_id, account=OWNER, opportunity=key, filename="v1.pdf", sha256=digest, body=pdf, created_at=100))
        db.commit()
    monkeypatch.setenv("TENDER_MARKET_ENABLED", "0")
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json() == {
        "references": {},
        "automaticStatus": "disabled",
    }


def test_archive_mid_flight_releases_lease_and_restores_same_generation(env):
    client, factory = env
    key = _seed_opportunity(factory, ocid="ocds-dgv273-seacev3-805")
    pdf = _pdf_bytes("Bases archivable")
    digest = hashlib.sha256(pdf).hexdigest()
    base_id = hashlib.sha256(f"{OWNER}:{key}:{digest}".encode()).hexdigest()

    with factory() as db:
        db.add(UploadedBases(id=base_id, account=OWNER, opportunity=key, filename="v1.pdf", sha256=digest, body=pdf, created_at=100))
        db.flush()
        prep.enqueue_selected(db, OWNER, [key])
        db.commit()

    assert prep.process_one(factory, OWNER, analyze=_analyze_items(["Polo pima M"], base_id)) is True

    def archive_during_search(batch):
        with factory() as db:
            opp = db.get(workspace.WebOpportunity, key)
            opp.hidden = True
            db.commit()
        return {batch[0]["id"]: [{"url": "https://proveedor.pe/polo", "title": "Polo", "price": "20.00", "currency": "PEN"}]}

    assert market_worker.research_one(factory, OWNER, search=archive_during_search) is True
    with factory() as db:
        assert db.scalars(select(tender_market.MarketReferences)).all() == []
        job = db.scalar(select(prep.PreparationJob))
        assert job.sections["marketResearch"] == {"status": "queued"}

    # While archived, worker does not pick it up.
    assert market_worker.research_one(factory, OWNER, search=lambda *_: pytest.fail("should not run while archived")) is False

    # Restore same generation -> worker completes it cleanly.
    with factory() as db:
        opp = db.get(workspace.WebOpportunity, key)
        opp.hidden = False
        db.commit()

    assert market_worker.research_one(
        factory,
        OWNER,
        search=lambda batch: {batch[0]["id"]: [{"url": "https://proveedor.pe/polo", "title": "Polo", "price": "20.00", "currency": "PEN"}]},
    ) is True
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "complete"


def test_terminal_preparation_without_requirements_is_not_stuck_waiting(env):
    client, factory = env
    key = _seed_opportunity(factory, ocid="ocds-dgv273-seacev3-806")
    pdf = _pdf_bytes("Sin partidas")
    digest = hashlib.sha256(pdf).hexdigest()
    base_id = hashlib.sha256(f"{OWNER}:{key}:{digest}".encode()).hexdigest()

    with factory() as db:
        db.add(UploadedBases(id=base_id, account=OWNER, opportunity=key, filename="v1.pdf", sha256=digest, body=pdf, created_at=100))
        db.flush()
        prep.enqueue_selected(db, OWNER, [key])
        db.commit()

    assert prep.process_one(factory, OWNER, analyze=_analyze_items([], base_id)) is True
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "complete"

    with factory() as db:
        job = db.scalar(select(prep.PreparationJob))
        job.status = "failed"
        db.commit()
    assert client.get(f"/api/workspace/opportunities/{key}/market", headers=_headers()).json()["automaticStatus"] == "failed"
