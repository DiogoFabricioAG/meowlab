"""Cloud discovery and durable WhatsApp outbox. No desktop or Meta dependencies."""
import copy
import hashlib
import json
import logging
import math
import os
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from uuid import uuid4

import httpx
from sqlalchemy import BigInteger, JSON, String, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .preparation_sources import discover_alert_documents
from .security import read_secret
from .workspace import MEOWLAB, WebOpportunity
from .business_profile import WebBusiness

logger = logging.getLogger(__name__)
LIMA = timezone(timedelta(hours=-5))
SEACE = "https://prod4.seace.gob.pe:8086/api/oportunidades"
USER_AGENT = "RadarComprasDesktop/0.5 (+https://radar.meowlab.tech)"
CATEGORIES = {"goods": "62", "services": "65", "works": "64"}
REFRESH_SECONDS = 6 * 3600
LEASE_SECONDS = 1800
SEND_INTERVAL = 1800
REGIONS = ("Amazonas", "Áncash", "Apurímac", "Arequipa", "Ayacucho", "Cajamarca", "Callao", "Cusco", "Huancavelica", "Huánuco", "Ica", "Junín", "La Libertad", "Lambayeque", "Lima", "Loreto", "Madre de Dios", "Moquegua", "Pasco", "Piura", "Puno", "San Martín", "Tacna", "Tumbes", "Ucayali")
STOPWORDS = set("adquisicion alquiler compra compras contratacion empresa negocio ofrece ofrecemos producto productos servicio servicios suministro suministros venta vendemos para como desde hasta sobre entre esta este estos estas unos unas con sin del las los una por que sus nuestro nuestra todo de y e".split())


class DiscoveryState(Base):
    __tablename__ = "radar_discovery_state"
    account: Mapped[str] = mapped_column(String(100), primary_key=True)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_until: Mapped[int] = mapped_column(BigInteger, default=0)
    fingerprint: Mapped[str] = mapped_column(String(64), default="")
    searched_at: Mapped[int] = mapped_column(BigInteger, default=0)
    retry_at: Mapped[int] = mapped_column(BigInteger, default=0)
    next_send_at: Mapped[int] = mapped_column(BigInteger, default=0)
    heartbeat: Mapped[int] = mapped_column(BigInteger, default=0)


class DiscoveryCandidate(Base):
    __tablename__ = "radar_discovery_candidates"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100), index=True)
    ocid: Mapped[str] = mapped_column(String(200), index=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    # Immutable once an alert has been attempted, even if SEACE later changes it.
    delivery: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    available_at: Mapped[int] = mapped_column(BigInteger, default=0)
    observed_at: Mapped[int] = mapped_column(BigInteger)


def normalized(value):
    value = "".join(c for c in unicodedata.normalize("NFKD", str(value or "")) if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9\s-]", " ", value.lower()).split())


def atomic_query(value):
    return " ".join(list(dict.fromkeys(w for w in normalized(value).split() if len(w) >= 3 and w not in STOPWORDS))[:2])


def queries_for(memory):
    excluded = [normalized(t).split() for t in memory.get("excludedTopics", []) if isinstance(t, str)]
    queries = dict.fromkeys(atomic_query(t) for t in memory.get("topics", []) if isinstance(t, str))
    return [q for q in queries if len(q) >= 2 and not any(t and all(w in q.split() for w in t) for t in excluded)]


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        value = re.sub(r"[^0-9.,-]", "", value)
        value = value.replace(".", "").replace(",", ".") if "," in value and value.rfind(",") > value.rfind(".") else value.replace(",", "")
    try:
        result = float(value)
        return result if math.isfinite(result) and result > 0 else None
    except (ValueError, TypeError):
        return None


def source_date(value):
    if not isinstance(value, str):
        return None
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).replace(tzinfo=LIMA)
        except ValueError:
            pass
    return None


def iso(date):
    return date.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") if date else None


def clean(value, limit):
    return re.sub(r"[\x00-\x1f]", " ", str(value or "")).strip()[:limit]


def read_json(url, *, method="GET", token=None, body=None, maximum=16_000_000):
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        headers.update(Origin="https://prod4.seace.gob.pe", Referer="https://prod4.seace.gob.pe/openegocio/")
    # Fixed destinations only; no user URL, proxy rotation, redirect or access bypass.
    with httpx.Client(timeout=httpx.Timeout(60, connect=15), follow_redirects=False) as client:
        with client.stream(method, url, headers=headers, json=body) as response:
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > maximum:
                    raise ValueError("response_too_large")
                chunks.append(chunk)
            data = json.loads(b"".join(chunks)) if chunks else {}
            return response.status_code, data


def search_seace(query, category):
    url = f"{SEACE}/codObjeto/codDepartamento/sintesisProceso/codTipoProceso/{CATEGORIES[category]}/0/{quote(query, safe='')}/0"
    status, data = read_json(url)
    if status != 200 or not isinstance(data, list):
        raise ValueError(f"seace_search_http_{status}")
    return data


def meowlab(path, body=None):
    token = read_secret("RADAR_MEOWLAB_TOKEN")
    if not token or path not in ("/status", "/candidates", "/alerts"):
        raise ValueError("meowlab_not_configured")
    return read_json(MEOWLAB + path, method="GET" if body is None else "POST", token=token, body=body, maximum=65_536)


def normalize_rows(rows, category, now):
    """Keep the complete published inventory; only the WhatsApp projection is bounded."""
    grouped = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid_seace_row")
        identifier = str(row.get("idProcedimiento", "")).strip()
        if not re.fullmatch(r"\d{1,18}", identifier):
            continue
        published = source_date(row.get("fechaConvocatoria"))
        try:
            year = int(row.get("anhoProceso") or (published.year if published else 0))
        except (ValueError, TypeError):
            continue
        deadline = source_date(row.get("fecFinParticipantes"))
        if row.get("fecFinParticipantes") and not deadline:
            continue
        if year != datetime.fromtimestamp(now, LIMA).year or (deadline and deadline.timestamp() <= now):
            continue
        ocid = f"ocds-dgv273-seacev3-{identifier}"
        if ocid not in grouped:
            currency = clean(row.get("monedaProceso"), 60)
            currency = "PEN" if "sol" in currency.lower() else currency
            amount = number(row.get("valorReferencial"))
            source = f"https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/{identifier}/2"
            grouped[ocid] = {"alert": {"ocid": ocid, "code": clean(row.get("nomenclatura"), 200) or identifier,
                "description": clean(row.get("sintesisProceso") or row.get("detItem"), 800) or "Sin descripción publicada",
                "buyer": clean(row.get("detEntidad"), 300) or "Entidad por confirmar",
                "amount": f"{currency} {amount:g}".strip() if amount else "Monto por confirmar",
                "deadline": iso(deadline) or "Por confirmar", "sourceUrl": source},
                "evidence": {"sourceUrl": source, "observedAt": iso(datetime.fromtimestamp(now, timezone.utc)),
                    "items": [], "documents": [], **({"registrationDeadline": deadline.isoformat(timespec="seconds")} if deadline else {})},
                "year": year, "category": category, "amount": amount, "currency": currency,
                "deadline": int(deadline.timestamp()) if deadline else None, "rows": []}
        candidate = grouped[ocid]
        if row not in candidate["rows"]:
            candidate["rows"].append(row)
            description = clean(row.get("detItem") or row.get("sintesisProceso"), 500)
            item = {"description": description, "quantity": number(row.get("cantItem")), "unit": clean(row.get("detUnidadMedida"), 60) or None}
            if description and item not in candidate["evidence"]["items"] and len(candidate["evidence"]["items"]) < 20:
                candidate["evidence"]["items"].append(item)
    return list(grouped.values())


def eligible(candidate, memory, now):
    if candidate["year"] != datetime.fromtimestamp(now, LIMA).year or (candidate["deadline"] and candidate["deadline"] <= now):
        return False
    words = normalized(" ".join(str(r.get("sintesisProceso", "")) + " " + str(r.get("detItem", "")) for r in candidate["rows"])).split()
    def includes(query):
        return all(any(word.startswith(token) for word in words) for token in query.split())
    if not any(includes(q) for q in queries_for(memory)):
        return False
    if any(includes(normalized(t)) for t in memory.get("excludedTopics", []) if isinstance(t, str) and normalized(t)):
        return False
    preferences = memory.get("searchPreferences") or {}
    entity = normalized(preferences.get("entity"))
    if entity and entity not in normalized(candidate["alert"]["buyer"]):
        return False
    amount = candidate["amount"]
    low, high = preferences.get("minAmount"), preferences.get("maxAmount")
    if amount is not None and (low is not None or high is not None):
        if candidate["currency"] != preferences.get("currency", "PEN") or (low is not None and amount < low) or (high is not None and amount > high):
            return False
    # Do not infer a delivery region from a buyer's name. Missing locations pass,
    # matching the desktop's includeUnknown rule.
    regions = {normalized(r) for r in preferences.get("regions", [])}
    for row in candidate["rows"]:
        published = row.get("detDepartamento") or row.get("departamento")
        if regions and isinstance(published, str) and normalized(published) in {normalized(r) for r in REGIONS} and normalized(published) not in regions:
            return False
    return True


def next_slot(now):
    date = datetime.fromtimestamp(now, LIMA)
    if date.hour < 8:
        return int(date.replace(hour=8, minute=0, second=0, microsecond=0).timestamp())
    if date.hour >= 20:
        return int((date + timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0).timestamp())
    return now


class DiscoveryWorker:
    def __init__(self, factory, owner, *, search=search_seace, gateway=meowlab, clock=time.time, enrich=discover_alert_documents):
        self.factory, self.owner, self.search, self.gateway, self.clock, self.enrich = factory, owner, search, gateway, clock, enrich

    def _enrich_documents(self, payload):
        try:
            documents = self.enrich(payload)
        except Exception as error:
            logger.warning("[radar-discovery] document_metadata_pending kind=%s", type(error).__name__)
            return []
        return documents if isinstance(documents, list) else []

    def lease(self):
        now, token = int(self.clock()), uuid4().hex
        with self.factory() as db:
            if not db.get(DiscoveryState, self.owner):
                try:
                    db.add(DiscoveryState(account=self.owner))
                    db.commit()
                except IntegrityError:
                    db.rollback()
            changed = db.execute(update(DiscoveryState).where(DiscoveryState.account == self.owner,
                DiscoveryState.lease_until <= now).values(lease_token=token, lease_until=now + LEASE_SECONDS, heartbeat=now))
            db.commit()
            return token if changed.rowcount == 1 else None

    def renew(self, token):
        now = int(self.clock())
        with self.factory() as db:
            changed = db.execute(update(DiscoveryState).where(DiscoveryState.account == self.owner,
                DiscoveryState.lease_token == token, DiscoveryState.lease_until > now).values(lease_until=now + LEASE_SECONDS, heartbeat=now))
            db.commit()
            if changed.rowcount != 1:
                raise RuntimeError("discovery_lease_lost")

    def collect(self, memory, token):
        now, failed, received = int(self.clock()), False, 0
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(self.search, query, category): category for query in queries_for(memory) for category in CATEGORIES}
            for future in as_completed(futures):
                self.renew(token)
                try:
                    candidates = normalize_rows(future.result(), futures[future], int(self.clock()))
                    with self.factory() as db:
                        for candidate in candidates:
                            key = digest([self.owner, candidate["alert"]["ocid"]])
                            existing = db.get(DiscoveryCandidate, key)
                            if existing:
                                # Merge items found under different topics; never truncate the universe.
                                previous_rows = existing.snapshot.get("rows", []) if existing.observed_at >= now else []
                                merged = normalize_rows(previous_rows + candidate["rows"], candidate["category"], int(self.clock()))
                                existing.snapshot = merged[0] if merged else candidate
                                existing.observed_at = int(self.clock())
                            else:
                                db.add(DiscoveryCandidate(key=key, account=self.owner, ocid=candidate["alert"]["ocid"], snapshot=candidate, observed_at=int(self.clock())))
                            received += 1
                        db.commit()
                except Exception as error:
                    failed = True
                    # No response body, credentials, private business or external error string.
                    logger.warning("[radar-discovery] search_pending kind=%s", type(error).__name__)
        with self.factory() as db:
            values = {"retry_at": int(self.clock()) + 300 if failed else 0}
            if not failed:
                values.update(searched_at=now, fingerprint=digest(memory))
            db.execute(update(DiscoveryState).where(DiscoveryState.account == self.owner, DiscoveryState.lease_token == token).values(**values))
            db.commit()
        return received, not failed

    def dispatch(self, memory, token):
        now = int(self.clock())
        with self.factory() as db:
            state = db.get(DiscoveryState, self.owner)
            if state.next_send_at > now or next_slot(now) > now:
                return "not_due"
        status, remote = self.gateway("/status")
        if status == 200 and isinstance(remote, dict) and remote.get("entitled") is False:
            return "subscription_inactive"
        if status != 200 or not isinstance(remote, dict) or not remote.get("linked") or not remote.get("open"):
            return "window_closed"
        with self.factory() as db:
            # Recover a crashed send as unknown, never automatically duplicate it.
            db.execute(update(DiscoveryCandidate).where(DiscoveryCandidate.account == self.owner, DiscoveryCandidate.status == "sending").values(status="unknown"))
            db.commit()
            selected = select(WebOpportunity.ocid).where(WebOpportunity.account == self.owner)
            rows = db.scalars(select(DiscoveryCandidate).where(DiscoveryCandidate.account == self.owner,
                DiscoveryCandidate.status == "pending", DiscoveryCandidate.available_at <= now,
                DiscoveryCandidate.observed_at >= max(state.searched_at, now - REFRESH_SECONDS),
                DiscoveryCandidate.ocid.not_in(selected)).order_by(DiscoveryCandidate.available_at.asc(), DiscoveryCandidate.observed_at.desc(), DiscoveryCandidate.key))
            row = next((r for r in rows if eligible(r.snapshot, memory, now)), None)
            if row is None:
                return "empty"
            key = row.key
            payload = row.delivery if row.delivery is not None else copy.deepcopy({k: row.snapshot[k] for k in ("alert", "evidence")})
            needs_enrichment = row.delivery is None
        if needs_enrichment:
            documents = self._enrich_documents(payload)
            if documents:
                payload["evidence"]["documents"] = documents
        self.renew(token)
        # Publishing checks the effective RADAR role, tenant and channel in MeowLab.
        # It does not require an open 24h window or create a user selection.
        publication = {"requestId": str(uuid4()), "candidates": [payload]}
        published_status, published = self.gateway("/candidates", publication)
        if published_status != 200 or published.get("status") != "ok" or published.get("requestId") != publication["requestId"]:
            return "publication_pending"
        with self.factory() as db:
            state = db.get(DiscoveryState, self.owner)
            current_memory = db.get(WebBusiness, self.owner)
            if state.lease_token != token or state.lease_until <= int(self.clock()) or digest(current_memory.memory if current_memory else {}) != digest(memory):
                return "context_changed"
            if db.scalar(select(WebOpportunity.key).where(WebOpportunity.account == self.owner, WebOpportunity.ocid == payload["alert"]["ocid"])):
                return "already_selected"
            row = db.get(DiscoveryCandidate, key)
            # Reserve in SQL before the side effect; restarts retain this payload.
            row.delivery, row.status = payload, "sending"
            state.next_send_at = int(self.clock()) + SEND_INTERVAL
            db.commit()
        try:
            status, result = self.gateway("/alerts", {**payload["alert"], "evidence": payload["evidence"]})
        except Exception:
            status, result = 0, {"status": "unknown"}
        outcome, retry_at = "unknown", int(self.clock()) + SEND_INTERVAL
        reconciled = False
        if status == 200 and result.get("status") in ("accepted", "unknown"):
            outcome = result["status"]
            if outcome == "accepted" and result.get("replayed") is True:
                outcome, reconciled = "already_notified", True
        elif status == 429 or result.get("status") == "window_closed" or result.get("error") in ("composition_pending", "sync_unavailable"):
            outcome = "pending"
            remote_retry = result.get("retryAt")
            if isinstance(remote_retry, (int, float)) and math.isfinite(remote_retry):
                retry_at = max(retry_at, math.ceil(remote_retry / 1000))
        elif status == 409 and result.get("error") == "idempotency_conflict":
            outcome, reconciled = "conflict", True
        elif status in (400, 401, 403) or (status == 200 and result.get("status") == "rejected"):
            outcome = "rejected"
        with self.factory() as db:
            db.execute(update(DiscoveryCandidate).where(DiscoveryCandidate.key == key, DiscoveryCandidate.status == "sending").values(status=outcome, available_at=retry_at))
            if reconciled:
                db.execute(update(DiscoveryState).where(DiscoveryState.account == self.owner, DiscoveryState.lease_token == token).values(next_send_at=0))
            db.commit()
        return outcome

    def entitled(self):
        try:
            status, remote = self.gateway("/status")
        except Exception:
            return None
        if status == 200 and isinstance(remote, dict) and "entitled" in remote:
            return bool(remote["entitled"])
        return None

    def cycle(self, *, send=False, force=False):
        if os.getenv("RADAR_DISCOVERY_ENABLED") != "1":
            return {"status": "disabled"}
        token = self.lease()
        if not token:
            return {"status": "busy"}
        try:
            with self.factory() as db:
                business = db.get(WebBusiness, self.owner)
                memory = json.loads(json.dumps(business.memory if business else {}))
                state = db.get(DiscoveryState, self.owner)
                now = int(self.clock())
                changed_day = datetime.fromtimestamp(state.searched_at, LIMA).date() != datetime.fromtimestamp(now, LIMA).date()
                due = force or (state.retry_at <= now and (state.fingerprint != digest(memory) or now < state.searched_at or now - state.searched_at >= REFRESH_SECONDS or changed_day))
            if not queries_for(memory):
                return {"status": "missing_business"}
            if self.entitled() is False:
                return {"status": "subscription_inactive", "received": 0, "searchComplete": False, "browserRequired": False}
            received, complete = self.collect(memory, token) if due else (0, True)
            outcome = "dry_run"
            if send:
                # Drain known legacy replays without consuming a new-message slot.
                # Bounded per cycle, never a cap on the persistent candidate universe.
                for _ in range(20):
                    previous = outcome
                    outcome = self.dispatch(memory, token)
                    if outcome == "empty" and previous in ("already_notified", "conflict"):
                        outcome = previous
                        break
                    if outcome not in ("already_notified", "conflict"):
                        break
            return {"status": outcome, "received": received, "searchComplete": complete, "browserRequired": False}
        finally:
            with self.factory() as db:
                db.execute(update(DiscoveryState).where(DiscoveryState.account == self.owner, DiscoveryState.lease_token == token).values(lease_until=0, lease_token=None, heartbeat=int(self.clock())))
                db.commit()
