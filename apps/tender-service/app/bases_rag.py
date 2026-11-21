"""Thematic mini-RAG indexing and hybrid retrieval over uploaded tender bases.

Supports native pgvector cosine similarity on PostgreSQL (production) and a
transparent JSON/Python + lexical thematic fallback on SQLite (tests).
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import time
from typing import Any

import httpx
from sqlalchemy import BigInteger, Integer, JSON, String, Text, delete, select, text
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base
from .security import read_secret

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536
MAX_RAG_CHUNK_CHARS = 1400
MAX_EMBED_BATCH = 64

RAG_TOPICS: dict[str, dict[str, Any]] = {
    "especificaciones_tecnicas": {
        "label": "Especificaciones Técnicas y Bienes",
        "keywords": (
            "especificacion", "especificaciones", "tecnica", "tecnicas", "ficha tecnica",
            "caracteristica", "caracteristicas", "norma", "calidad", "muestra", "muestras",
            "marca", "modelo", "cantidad", "unidad", "medida", "bien", "bienes", "insumo",
            "material", "equipo", "embalaje", "rotulado", "vida util", "lote",
        ),
    },
    "entrega_y_pago": {
        "label": "Entrega, Conformidad y Pago",
        "keywords": (
            "plazo de entrega", "lugar de entrega", "entrega", "almacen", "recepcion",
            "conformidad", "guia de remision", "factura", "comprobante", "orden de compra",
            "pago", "abono", "cci", "cuenta", "moneda", "soles", "flete", "descarga",
        ),
    },
    "admisibilidad_y_anexos": {
        "label": "Admisibilidad, Anexos y Cotización",
        "keywords": (
            "admisibilidad", "declaracion jurada", "anexo", "formulario", "cotizacion",
            "oferta", "propuesta", "foliacion", "firma", "sello", "validez", "vigencia",
            "postor", "impedimento", "impedimentos", "consortium", "consorcio",
        ),
    },
    "calificacion_y_experiencia": {
        "label": "Calificación, RNP y Experiencia",
        "keywords": (
            "calificacion", "experiencia", "facturacion", "rnp", "registro nacional",
            "habilitado", "habilitacion", "constancia", "acreditacion", "personal",
            "equipamiento", "solvencia", "capacidad",
        ),
    },
    "penalidades_y_garantias": {
        "label": "Penalidades, Garantías y Contrato",
        "keywords": (
            "penalidad", "penalidades", "mora", "retraso", "atraso", "garantia",
            "garantias", "reposicion", "vicios ocultos", "resolucion", "incumplimiento",
            "subsanacion", "perfeccionamiento", "fiel cumplimiento",
        ),
    },
    "general_y_cronograma": {
        "label": "Información General y Cronograma",
        "keywords": (
            "cronograma", "consulta", "consultas", "observacion", "absolucion",
            "instrucciones", "seccion", "objeto", "convocatoria", "entidad",
            "postulacion", "presentacion",
        ),
    },
}

_STOPWORDS = {
    "de", "la", "el", "los", "las", "en", "y", "o", "a", "del", "al", "por",
    "para", "con", "sin", "un", "una", "que", "se", "su", "sus", "es", "son",
    "como", "cual", "cuales", "donde", "cuando", "cuanto", "cuanta", "sobre",
    "este", "esta", "estos", "estas", "ese", "esa", "lo", "le", "les", "si", "no",
}


class BasesRagChunk(Base):
    __tablename__ = "radar_bases_rag_chunks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(String(100), index=True)
    opportunity: Mapped[str] = mapped_column(String(120), index=True)
    source_id: Mapped[str] = mapped_column(String(128))
    source_title: Mapped[str] = mapped_column(String(260))
    locator: Mapped[str] = mapped_column(String(64))
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    topic: Mapped[str] = mapped_column(String(64), index=True)
    section_heading: Mapped[str] = mapped_column(String(240), default="")
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger)


def _normalize(value: str) -> str:
    lowered = str(value or "").lower()
    replacements = (
        ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ü", "u"), ("ñ", "n"),
    )
    for src, dst in replacements:
        lowered = lowered.replace(src, dst)
    return lowered


def _tokenize(value: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", _normalize(value))
    return {tok for tok in tokens if len(tok) >= 2 and tok not in _STOPWORDS}


def classify_topic(heading: str, content: str) -> str:
    norm_head = _normalize(heading)
    norm_body = _normalize(content)
    best_topic = "general_y_cronograma"
    best_score = 0
    for topic, meta in RAG_TOPICS.items():
        score = 0
        for kw in meta["keywords"]:
            if kw in norm_head:
                score += 4
            elif kw in norm_body:
                score += 1
        if score > best_score:
            best_score = score
            best_topic = topic
    return best_topic


def infer_query_topics(query: str) -> list[str]:
    norm_q = _normalize(query)
    scored: list[tuple[int, str]] = []
    for topic, meta in RAG_TOPICS.items():
        score = sum(2 if " " in kw else 1 for kw in meta["keywords"] if kw in norm_q)
        if score > 0:
            scored.append((score, topic))
    scored.sort(reverse=True)
    return [t for _, t in scored[:2]]


def _extract_heading(block: str) -> str:
    for line in str(block or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if len(stripped) <= 120 and (
            re.match(r"^(?:SECCI[ÓO]N|CAP[ÍI]TULO|ANEXO|ART[ÍI]CULO)\b", stripped, re.I)
            or re.match(r"^\d+(?:\.\d+)*[.)]?\s+[A-ZÁÉÍÓÚÑ]", stripped)
            or stripped.isupper()
        ):
            return stripped[:220]
        break
    return ""


def _split_long_block(text_block: str, max_chars: int = MAX_RAG_CHUNK_CHARS) -> list[str]:
    clean = str(text_block or "").strip()
    if not clean:
        return []
    if len(clean) <= max_chars:
        return [clean]
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", clean) if p.strip()]
    if len(paragraphs) == 1:
        paragraphs = [p.strip() for p in clean.splitlines() if p.strip()]
    parts: list[str] = []
    current = ""
    for para in paragraphs:
        if len(para) > max_chars:
            if current:
                parts.append(current)
                current = ""
            for i in range(0, len(para), max_chars - 120):
                parts.append(para[i:i + max_chars].strip())
            continue
        candidate = f"{current}\n\n{para}".strip() if current else para
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                parts.append(current)
            current = para
    if current:
        parts.append(current)
    return parts


def build_thematic_chunks(sources_section: dict[str, Any]) -> list[dict[str, Any]]:
    """Groups extracted source chunks into coherent thematic RAG blocks."""
    docs = (sources_section or {}).get("documents") or []
    grouped: list[dict[str, Any]] = []
    for doc in docs:
        source_id = str(doc.get("id") or "")
        source_title = str(doc.get("title") or "Bases")[:260]
        raw_chunks = doc.get("chunks") or []
        pending: dict[str, Any] | None = None

        for chunk in raw_chunks:
            locator = str(chunk.get("locator") or "chunk:0")[:64]
            page = chunk.get("page") if isinstance(chunk.get("page"), int) else None
            for part in _split_long_block(str(chunk.get("text") or "")):
                heading = _extract_heading(part)
                topic = classify_topic(heading, part)
                if (
                    pending
                    and pending["topic"] == topic
                    and len(pending["text"]) + len(part) + 2 <= MAX_RAG_CHUNK_CHARS
                    and not heading
                ):
                    pending["text"] = f"{pending['text']}\n\n{part}"
                else:
                    if pending:
                        grouped.append(pending)
                    pending = {
                        "source_id": source_id,
                        "source_title": source_title,
                        "locator": locator,
                        "page": page,
                        "topic": topic,
                        "section_heading": heading,
                        "text": part,
                    }
        if pending:
            grouped.append(pending)
    return grouped


def _openai_api_key() -> str:
    return read_secret("RADAR_OPENAI_API_KEY") or read_secret("OPENAI_API_KEY")


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    """Computes OpenAI text-embedding-3-small vectors in batches, or None on unavailability."""
    api_key = _openai_api_key()
    if not api_key or not texts:
        return None
    vectors: list[list[float]] = []
    try:
        with httpx.Client(timeout=25.0) as client:
            for start in range(0, len(texts), MAX_EMBED_BATCH):
                batch = [t[:8000] for t in texts[start:start + MAX_EMBED_BATCH]]
                resp = client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"model": EMBEDDING_MODEL, "input": batch},
                )
                resp.raise_for_status()
                payload = resp.json()
                data = sorted(payload.get("data", []), key=lambda item: item.get("index", 0))
                if len(data) != len(batch):
                    return None
                for item in data:
                    vec = item.get("embedding")
                    if not isinstance(vec, list) or len(vec) != EMBEDDING_DIMS:
                        return None
                    vectors.append([float(x) for x in vec])
        return vectors
    except Exception as exc:
        logger.warning("[radar-rag] embedding_unavailable error=%s", type(exc).__name__)
        return None


def ensure_pgvector(db: Session) -> bool:
    """Idempotently enables pgvector extension, vector column and HNSW index on PostgreSQL."""
    bind = db.get_bind()
    if not bind or bind.dialect.name != "postgresql":
        return False
    try:
        db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        db.execute(text(f"ALTER TABLE radar_bases_rag_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector({EMBEDDING_DIMS})"))
        db.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_radar_bases_rag_chunks_vec "
                "ON radar_bases_rag_chunks USING hnsw (embedding_vec vector_cosine_ops)"
            )
        )
        db.flush()
        return True
    except Exception as exc:
        logger.warning("[radar-rag] pgvector_setup_skipped error=%s", type(exc).__name__)
        return False


def _vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in vec) + "]"


def index_opportunity_rag(
    db: Session,
    owner: str,
    opportunity_key: str,
    sources_section: dict[str, Any],
    *,
    embed_fn=None,
) -> int:
    """Rebuilds thematic RAG chunks (and pgvector embeddings when available) for an opportunity."""
    chunks = build_thematic_chunks(sources_section)
    embed = embed_fn or embed_texts
    vectors = embed([c["text"] for c in chunks]) if chunks else []

    db.execute(
        delete(BasesRagChunk).where(
            BasesRagChunk.account == owner,
            BasesRagChunk.opportunity == opportunity_key,
        )
    )
    if not chunks:
        db.flush()
        return 0

    has_pgvector = ensure_pgvector(db)
    now = int(time.time())
    for idx, chunk in enumerate(chunks):
        vec = vectors[idx] if vectors and idx < len(vectors) else None
        cid = hashlib.sha256(
            f"{owner}:{opportunity_key}:{chunk['source_id']}:{chunk['locator']}:{idx}".encode()
        ).hexdigest()
        row = BasesRagChunk(
            id=cid,
            account=owner,
            opportunity=opportunity_key,
            source_id=chunk["source_id"],
            source_title=chunk["source_title"],
            locator=chunk["locator"],
            page=chunk["page"],
            topic=chunk["topic"],
            section_heading=chunk["section_heading"],
            text=chunk["text"],
            embedding=vec,
            created_at=now,
        )
        db.add(row)
        if has_pgvector and vec is not None:
            db.flush()
            db.execute(
                text("UPDATE radar_bases_rag_chunks SET embedding_vec = CAST(:vec AS vector) WHERE id = :id"),
                {"vec": _vector_literal(vec), "id": cid},
            )
    db.flush()
    return len(chunks)


def delete_opportunity_rag(db: Session, owner: str, opportunity_key: str) -> None:
    db.execute(
        delete(BasesRagChunk).where(
            BasesRagChunk.account == owner,
            BasesRagChunk.opportunity == opportunity_key,
        )
    )


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _lexical_score(query_tokens: set[str], row_text: str, heading: str) -> float:
    if not query_tokens:
        return 0.0
    doc_tokens = _tokenize(row_text)
    head_tokens = _tokenize(heading)
    overlap = len(query_tokens & doc_tokens)
    head_overlap = len(query_tokens & head_tokens)
    return min(1.0, (overlap + 1.5 * head_overlap) / max(1, len(query_tokens)))


def search_bases_rag(
    db: Session,
    owner: str,
    opportunity_key: str,
    query: str,
    *,
    topic: str | None = None,
    top_k: int = 5,
    embed_fn=None,
) -> dict[str, Any]:
    """Retrieves the most relevant thematic chunks using pgvector/cosine + lexical scoring."""
    top_k = max(1, min(int(top_k or 5), 10))
    explicit_topic = topic if topic in RAG_TOPICS else None
    inferred_topics = [explicit_topic] if explicit_topic else infer_query_topics(query)
    query_tokens = _tokenize(query)
    embed = embed_fn or embed_texts
    query_vec_list = embed([query])
    query_vec = query_vec_list[0] if query_vec_list else None

    bind = db.get_bind()
    is_pg = bool(bind and bind.dialect.name == "postgresql")
    candidates: list[tuple[BasesRagChunk, float | None]] = []
    mode = "lexical_thematic"

    if is_pg and query_vec is not None and ensure_pgvector(db):
        try:
            q_lit = _vector_literal(query_vec)
            sql = (
                "SELECT id, 1 - (embedding_vec <=> CAST(:qvec AS vector)) AS sim "
                "FROM radar_bases_rag_chunks "
                "WHERE account = :acc AND opportunity = :opp AND embedding_vec IS NOT NULL "
            )
            params: dict[str, Any] = {"qvec": q_lit, "acc": owner, "opp": opportunity_key, "lim": max(top_k * 4, 20)}
            if explicit_topic:
                sql += "AND topic = :topic "
                params["topic"] = explicit_topic
            sql += "ORDER BY embedding_vec <=> CAST(:qvec AS vector) LIMIT :lim"
            pg_rows = db.execute(text(sql), params).fetchall()
            if pg_rows:
                ids = [r[0] for r in pg_rows]
                sim_by_id = {r[0]: float(r[1]) for r in pg_rows}
                orm_rows = db.scalars(select(BasesRagChunk).where(BasesRagChunk.id.in_(ids))).all()
                candidates = [(row, sim_by_id.get(row.id)) for row in orm_rows]
                mode = "pgvector_hybrid"
        except Exception as exc:
            logger.warning("[radar-rag] pgvector_query_fallback error=%s", type(exc).__name__)

    if not candidates:
        stmt = select(BasesRagChunk).where(
            BasesRagChunk.account == owner,
            BasesRagChunk.opportunity == opportunity_key,
        )
        if explicit_topic:
            stmt = stmt.where(BasesRagChunk.topic == explicit_topic)
        rows = db.scalars(stmt).all()
        for row in rows:
            sim = _cosine_similarity(query_vec, row.embedding) if (query_vec and row.embedding) else None
            candidates.append((row, sim))
        if any(sim is not None for _, sim in candidates):
            mode = "hybrid"

    scored: list[tuple[float, BasesRagChunk]] = []
    for row, vec_sim in candidates:
        lex = _lexical_score(query_tokens, row.text, row.section_heading)
        topic_boost = 0.12 if row.topic in inferred_topics else 0.0
        if vec_sim is not None:
            total = (0.70 * max(0.0, vec_sim)) + (0.30 * lex) + topic_boost
        else:
            total = lex + topic_boost
        scored.append((total, row))

    scored.sort(key=lambda item: item[0], reverse=True)
    top_rows = scored[:top_k]

    return {
        "untrustedData": True,
        "ragMode": mode,
        "query": query,
        "matchedTopics": inferred_topics,
        "totalIndexedChunks": len(candidates),
        "results": [
            {
                "topic": row.topic,
                "topicLabel": RAG_TOPICS.get(row.topic, {}).get("label", row.topic),
                "sectionHeading": row.section_heading,
                "sourceId": row.source_id,
                "sourceTitle": row.source_title,
                "locator": row.locator,
                "page": row.page,
                "score": round(score, 4),
                "text": row.text,
            }
            for score, row in top_rows
        ],
    }
