"""Source collection and document extraction for advance preparation jobs.

Collects published SEACE opportunity documents from the candidate snapshot and
its verified SEACE ficha endpoint, downloads attachments with strict security
and size bounds (no access-control bypass), and extracts traceable text chunks
from PDF and DOCX files (including archives). Scanned PDFs require OCR and are
marked 'needs_ocr' (rendering overall status 'partial' or 'unavailable') when
OCR is unavailable or incomplete—never faking full text extraction.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import io
import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import tempfile
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

logger = logging.getLogger(__name__)

SEACE_FICHA_API_PREFIX = "https://prod4.seace.gob.pe:8086/api/oportunidades/fichaProceso/idProceso/"
SEACE_FICHA_WEB_RE = re.compile(r"^/ficha/idProceso/tipo/(\d+)/2$")
SEACE_OCID_PROC_RE = re.compile(r"^ocds-dgv273-seacev3-(\d+)$")
ALFRESCO_DOWNLOAD_PREFIX = "https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode="
WHATSAPP_ALFRESCO_URL_RE = re.compile(
    r"^https://prod1\.seace\.gob\.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco\?fileCode=[a-f0-9-]{36}$",
    re.IGNORECASE,
)
ALLOWED_SEACE_HOSTS = frozenset({"prod1.seace.gob.pe", "prod2.seace.gob.pe", "prod4.seace.gob.pe"})
MAX_WHATSAPP_EVIDENCE_DOCUMENTS = 6
MAX_WHATSAPP_DOCUMENT_TITLE = 160
ALERT_METADATA_TIMEOUT_SECONDS = 10.0

USER_AGENT = "RadarComprasDesktop/0.5 (+https://radar.meowlab.tech)"
MAX_FICHA_BYTES = 4 * 1024 * 1024
MAX_DOCUMENT_BYTES = 15 * 1024 * 1024
MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_REDIRECTS = 3
DEFAULT_TIMEOUT_SECONDS = 25
MAX_CONCURRENCY = 2
MAX_ARCHIVE_MEMBERS = 25
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024
MAX_OCR_PAGES = 120
MIN_PAGE_TEXT_CHARS = 15

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W_P = f"{{{WORD_NS}}}p"
W_TBL = f"{{{WORD_NS}}}tbl"
W_TR = f"{{{WORD_NS}}}tr"
W_TC = f"{{{WORD_NS}}}tc"
W_T = f"{{{WORD_NS}}}t"
W_TAB = f"{{{WORD_NS}}}tab"
W_BR = f"{{{WORD_NS}}}br"
W_CR = f"{{{WORD_NS}}}cr"


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SourceFetchError(Exception):
    def __init__(self, code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _clean_text(value: Any, max_len: int = 300) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_len]


def _preserve_multiline_text(value: str, max_len: int | None = None) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+", " ", value)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in cleaned.splitlines()]
    non_empty = [line for line in lines if line]
    text = "\n".join(non_empty)
    return text if max_len is None else text[:max_len]


def _is_private_or_forbidden_ip(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr.strip("[]"))
    except ValueError:
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_seace_url(url: Any, *, allow_api_port: bool = False, resolve_dns: bool = False) -> str:
    """Validate that a URL is an official HTTPS SEACE URL without credentials or SSRF vectors."""
    if not isinstance(url, str):
        raise SourceFetchError("invalid_url", "El enlace publicado no es una URL válida.")
    raw = url.strip()
    if not raw or len(raw) > 2048 or any(ord(c) < 32 for c in raw):
        raise SourceFetchError("invalid_url", "El enlace publicado tiene un formato inválido.")
    try:
        parsed = urlsplit(raw)
    except ValueError as exc:
        raise SourceFetchError("invalid_url", "El enlace publicado no se pudo analizar como URL.") from exc

    if parsed.scheme.lower() != "https":
        raise SourceFetchError("invalid_url", "Sólo se permiten enlaces oficiales sobre HTTPS.")
    if parsed.username or parsed.password:
        raise SourceFetchError("invalid_url", "No se permiten credenciales en los enlaces.")

    host = (parsed.hostname or "").lower()
    if not host or host not in ALLOWED_SEACE_HOSTS:
        raise SourceFetchError("invalid_url", "El enlace no pertenece a un dominio oficial de SEACE permitido.")

    try:
        port = parsed.port
    except ValueError as exc:
        raise SourceFetchError("invalid_url", "El puerto del enlace no es válido.") from exc

    allowed_ports = {None, 443, 8086} if (allow_api_port and host == "prod4.seace.gob.pe") else {None, 443}
    if port not in allowed_ports:
        raise SourceFetchError("invalid_url", "El puerto del enlace no está permitido.")

    if ".." in parsed.path or "\\" in parsed.path:
        raise SourceFetchError("invalid_url", "La ruta del enlace no es segura.")

    if resolve_dns:
        try:
            infos = socket.getaddrinfo(host, port or 443, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise SourceFetchError("download_failed", "No se pudo resolver el servidor oficial de SEACE.") from exc
        if not infos:
            raise SourceFetchError("download_failed", "El servidor de SEACE no devolvió direcciones de red.")
        for info in infos:
            sockaddr = info[4]
            if not sockaddr or _is_private_or_forbidden_ip(str(sockaddr[0])):
                raise SourceFetchError("invalid_url", "El dominio resolvió a una dirección de red no pública.")

    clean_url = parsed._replace(fragment="").geturl()
    return clean_url


def extract_verified_procedure_id(candidate: Any) -> str | None:
    """Extract a SEACE procedure ID only when backed by reliable SEACE identity, never from arbitrary OCIDs."""
    if not isinstance(candidate, dict):
        return None
    alert = candidate.get("alert") if isinstance(candidate.get("alert"), dict) else {}
    evidence = candidate.get("evidence") if isinstance(candidate.get("evidence"), dict) else {}

    proc_ids: list[str] = []

    for url_candidate in (evidence.get("sourceUrl"), alert.get("sourceUrl")):
        if not isinstance(url_candidate, str) or len(url_candidate) > 2048:
            continue
        try:
            parsed = urlsplit(url_candidate.strip())
        except ValueError:
            continue
        if (
            parsed.scheme == "https"
            and parsed.hostname == "prod4.seace.gob.pe"
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
        ):
            match = SEACE_FICHA_WEB_RE.match(parsed.fragment or "")
            if match:
                proc_ids.append(match.group(1))

    ocid = str(alert.get("ocid") or "").strip()
    ocid_match = SEACE_OCID_PROC_RE.match(ocid)
    if ocid_match:
        ocid_proc_id = ocid_match.group(1)
        if not proc_ids:
            proc_ids.append(ocid_proc_id)
        elif ocid_proc_id not in proc_ids:
            return None

    if not proc_ids:
        return None
    first = proc_ids[0]
    if any(pid != first for pid in proc_ids):
        return None
    return first


def _normalize_fetcher_response(raw_resp: Any, max_bytes: int) -> tuple[int, dict[str, str], bytes]:
    if isinstance(raw_resp, (bytes, bytearray)):
        body = bytes(raw_resp)
        if len(body) > max_bytes:
            raise SourceFetchError("too_large", "El archivo supera el tamaño máximo permitido.")
        return 200, {}, body

    if isinstance(raw_resp, tuple):
        if len(raw_resp) == 2:
            status, body_or_data = raw_resp
            headers: dict[str, str] = {}
        elif len(raw_resp) == 3:
            status, headers, body_or_data = raw_resp
            headers = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
        else:
            raise SourceFetchError("download_failed", "Respuesta de transporte inválida.")
        if isinstance(body_or_data, (dict, list)):
            body = json.dumps(body_or_data).encode("utf-8")
        elif isinstance(body_or_data, str):
            body = body_or_data.encode("utf-8")
        elif isinstance(body_or_data, (bytes, bytearray)):
            body = bytes(body_or_data)
        else:
            raise SourceFetchError("download_failed", "Cuerpo de respuesta inválido.")
        if len(body) > max_bytes:
            raise SourceFetchError("too_large", "El archivo supera el tamaño máximo permitido.")
        return int(status), headers, body

    if isinstance(raw_resp, dict):
        if "status" in raw_resp and ("body" in raw_resp or "data" in raw_resp or "json" in raw_resp or "headers" in raw_resp):
            status = int(raw_resp.get("status", 200))
            raw_headers = raw_resp.get("headers") or {}
            headers = {str(k).lower(): str(v) for k, v in raw_headers.items()} if isinstance(raw_headers, dict) else {}
            if "body" in raw_resp and raw_resp["body"] is not None:
                b = raw_resp["body"]
                body = b.encode("utf-8") if isinstance(b, str) else bytes(b)
            elif "data" in raw_resp and raw_resp["data"] is not None:
                d = raw_resp["data"]
                body = d if isinstance(d, bytes) else json.dumps(d).encode("utf-8")
            elif "json" in raw_resp and raw_resp["json"] is not None:
                body = json.dumps(raw_resp["json"]).encode("utf-8")
            else:
                body = b""
            if len(body) > max_bytes:
                raise SourceFetchError("too_large", "El archivo supera el tamaño máximo permitido.")
            return status, headers, body
        body = json.dumps(raw_resp).encode("utf-8")
        if len(body) > max_bytes:
            raise SourceFetchError("too_large", "La respuesta supera el tamaño máximo permitido.")
        return 200, {"content-type": "application/json"}, body

    if hasattr(raw_resp, "status_code") or hasattr(raw_resp, "status"):
        status = int(getattr(raw_resp, "status_code", getattr(raw_resp, "status", 200)))
        raw_headers = getattr(raw_resp, "headers", {}) or {}
        headers = {str(k).lower(): str(v) for k, v in raw_headers.items()}
        content = getattr(raw_resp, "content", None)
        if content is None and callable(getattr(raw_resp, "read", None)):
            content = raw_resp.read(max_bytes + 1)
        body = bytes(content or b"")
        if len(body) > max_bytes:
            raise SourceFetchError("too_large", "El archivo supera el tamaño máximo permitido.")
        return status, headers, body

    raise SourceFetchError("download_failed", "Formato de respuesta no reconocido.")


def _default_network_request(url: str, headers: dict[str, str], max_bytes: int, timeout: float) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    opener = urllib.request.build_opener(_NoRedirectHandler)
    try:
        with opener.open(req, timeout=timeout) as resp:
            status = int(getattr(resp, "status", 200))
            resp_headers = {str(k).lower(): str(v) for k, v in resp.headers.items()}
            cl = resp_headers.get("content-length")
            if cl and cl.isdigit() and int(cl) > max_bytes:
                raise SourceFetchError("too_large", "El documento publicado supera el límite de tamaño permitido.", status)
            chunks: list[bytes] = []
            total = 0
            while True:
                block = resp.read(65536)
                if not block:
                    break
                total += len(block)
                if total > max_bytes:
                    raise SourceFetchError("too_large", "El documento publicado supera el límite de tamaño permitido.", status)
                chunks.append(block)
            return status, resp_headers, b"".join(chunks)
    except urllib.error.HTTPError as exc:
        resp_headers = {str(k).lower(): str(v) for k, v in (exc.headers.items() if exc.headers else [])}
        return int(exc.code), resp_headers, b""
    except SourceFetchError:
        raise
    except TimeoutError as exc:
        raise SourceFetchError("timeout", "La consulta a SEACE agotó el tiempo de espera.") from exc
    except urllib.error.URLError as exc:
        if isinstance(getattr(exc, "reason", None), (TimeoutError, socket.timeout)):
            raise SourceFetchError("timeout", "La consulta a SEACE agotó el tiempo de espera.") from exc
        raise SourceFetchError("download_failed", "No se pudo conectar con la fuente oficial de SEACE.") from exc
    except Exception as exc:
        raise SourceFetchError("download_failed", "Ocurrió un error al descargar desde la fuente oficial.") from exc


def _call_fetcher(
    fetcher: Callable[..., Any],
    url: str,
    headers: dict[str, str],
    max_bytes: int,
    timeout: float,
) -> tuple[int, dict[str, str], bytes]:
    try:
        try:
            raw = fetcher(url, headers=headers, timeout=timeout, max_bytes=max_bytes)
        except TypeError:
            try:
                raw = fetcher(url, headers=headers, timeout=timeout)
            except TypeError:
                try:
                    raw = fetcher(url, headers)
                except TypeError:
                    raw = fetcher(url)
    except SourceFetchError:
        raise
    except TimeoutError as exc:
        raise SourceFetchError("timeout", "La descarga agotó el tiempo disponible.") from exc
    except Exception as exc:
        raise SourceFetchError("download_failed", "No se pudo completar la descarga desde la fuente.") from exc
    return _normalize_fetcher_response(raw, max_bytes=max_bytes)


def _fetch_bounded(
    url: str,
    *,
    fetcher: Callable[..., Any] | None,
    allow_api_port: bool = False,
    max_bytes: int = MAX_DOCUMENT_BYTES,
    accept: str = "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream,*/*",
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[str, dict[str, str], bytes]:
    current = validate_seace_url(url, allow_api_port=allow_api_port, resolve_dns=(fetcher is None))
    visited: set[str] = set()

    for _ in range(MAX_REDIRECTS + 1):
        if current in visited:
            raise SourceFetchError("redirect_failed", "El enlace oficial contiene un bucle de redirecciones.")
        visited.add(current)

        req_headers = {
            "Accept": accept,
            "User-Agent": USER_AGENT,
        }
        if fetcher is None:
            status, headers, body = _default_network_request(current, req_headers, max_bytes, timeout)
        else:
            status, headers, body = _call_fetcher(fetcher, current, req_headers, max_bytes, timeout)

        if status in (301, 302, 303, 307, 308):
            location = headers.get("location")
            if not location or len(visited) > MAX_REDIRECTS:
                raise SourceFetchError("redirect_failed", "No se pudo seguir la redirección del enlace publicado.", status)
            next_url = urljoin(current, location)
            current = validate_seace_url(next_url, allow_api_port=allow_api_port, resolve_dns=(fetcher is None))
            continue

        if status in (403, 429):
            raise SourceFetchError(
                "access_denied",
                "SEACE denegó o limitó la descarga automática de este archivo (HTTP 403/429). No se aplican mecanismos de evasión.",
                status,
            )
        if status == 404:
            raise SourceFetchError("not_found", "El documento publicado no se encontró en SEACE (HTTP 404).", status)
        if status < 200 or status >= 300:
            raise SourceFetchError("download_failed", f"SEACE devolvió un estado HTTP {status} al consultar el recurso.", status)

        cl = headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > max_bytes:
            raise SourceFetchError("too_large", "El documento publicado supera el límite de tamaño permitido.", status)

        if len(body) > max_bytes:
            raise SourceFetchError("too_large", "El documento publicado supera el límite de tamaño permitido.", status)

        return current, headers, body

    raise SourceFetchError("redirect_failed", "El enlace superó el límite de redirecciones permitidas.")


def _make_source_id(url: str, fallback_index: int = 0) -> str:
    basis = url.strip() if url and url.strip() else f"invalid-source-{fallback_index}"
    return "src-" + hashlib.sha256(basis.encode("utf-8")).hexdigest()[:24]


def _extract_docx_chunks(data: bytes, doc_id: str) -> tuple[str, int | None, list[dict[str, Any]], list[dict[str, Any]]]:
    """Extract paragraph and table cell blocks from an OOXML .docx without inventing page numbers."""
    notices: list[dict[str, Any]] = []
    extra_parts: list[tuple[str, bytes]] = []
    has_media = False
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
            if "word/document.xml" not in zf.namelist():
                return (
                    "failed",
                    None,
                    [],
                    [{"code": "invalid_docx", "message": "El archivo Word no contiene word/document.xml válido.", "sourceId": doc_id}],
                )
            info = zf.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                return (
                    "failed",
                    None,
                    [],
                    [{"code": "too_large", "message": "El contenido XML del documento Word supera el límite seguro.", "sourceId": doc_id}],
                )
            xml_bytes = zf.read("word/document.xml")
            has_media = any(name.startswith("word/media/") for name in zf.namelist())
            for name in zf.namelist():
                if re.fullmatch(r"word/(?:header\d*|footer\d*|footnotes|endnotes)\.xml", name):
                    if zf.getinfo(name).file_size > MAX_DOCX_XML_BYTES:
                        notices.append({"code": "unread_part", "message": "Una parte adicional de Word supera el límite de lectura.", "sourceId": doc_id})
                    else:
                        extra_parts.append((name, zf.read(name)))
    except zipfile.BadZipFile:
        return (
            "failed",
            None,
            [],
            [{"code": "invalid_docx", "message": "El archivo Word está dañado o no es un contenedor OOXML válido.", "sourceId": doc_id}],
        )
    except Exception:
        return (
            "failed",
            None,
            [],
            [{"code": "invalid_docx", "message": "No se pudo abrir el archivo Word publicado.", "sourceId": doc_id}],
        )

    try:
        if b"<!DOCTYPE" in xml_bytes.upper() or b"<!ENTITY" in xml_bytes.upper():
            raise ET.ParseError("XML declarations are not accepted")
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return (
            "failed",
            None,
            [],
            [{"code": "invalid_docx", "message": "El XML interno del documento Word es inválido.", "sourceId": doc_id}],
        )

    def paragraph_text(p_elem: ET.Element) -> str:
        parts: list[str] = []
        for node in p_elem.iter():
            if node.tag == W_T and node.text:
                parts.append(node.text)
            elif node.tag == W_TAB:
                parts.append("\t")
            elif node.tag in (W_BR, W_CR):
                parts.append("\n")
        return _preserve_multiline_text("".join(parts))

    body = root.find(f"{{{WORD_NS}}}body")
    container = body if body is not None else root

    chunks: list[dict[str, Any]] = []
    p_counter = 0
    t_counter = 0

    for child in list(container):
        if child.tag == W_P:
            text = paragraph_text(child)
            if text:
                p_counter += 1
                locator = f"paragraph:{p_counter}"
                chunks.append({
                    "id": f"{doc_id}:{locator}",
                    "text": text,
                    "page": None,
                    "locator": locator,
                })
        elif child.tag == W_TBL:
            t_counter += 1
            rows_text: list[str] = []
            for r_idx, tr in enumerate(child.findall(f".//{W_TR}"), start=1):
                cells_text: list[str] = []
                for tc in tr.findall(f"./{W_TC}"):
                    cell_paras = [paragraph_text(p) for p in tc.findall(f".//{W_P}")]
                    cell_val = " / ".join(cp for cp in cell_paras if cp)
                    if cell_val:
                        cells_text.append(cell_val)
                if cells_text:
                    rows_text.append(f"Fila {r_idx}: " + " | ".join(cells_text))
            if rows_text:
                current_lines: list[str] = []
                current_len = 0
                part_idx = 0
                for line in rows_text:
                    if current_lines and current_len + len(line) + 1 > 3500:
                        part_idx += 1
                        locator = f"table:{t_counter}:part:{part_idx}" if part_idx > 1 else f"table:{t_counter}"
                        chunks.append({
                            "id": f"{doc_id}:{locator}",
                            "text": "\n".join(current_lines),
                            "page": None,
                            "locator": locator,
                        })
                        current_lines = [line]
                        current_len = len(line)
                    else:
                        current_lines.append(line)
                        current_len += len(line) + 1
                if current_lines:
                    locator = f"table:{t_counter}:part:{part_idx + 1}" if part_idx > 0 else f"table:{t_counter}"
                    chunks.append({
                        "id": f"{doc_id}:{locator}",
                        "text": "\n".join(current_lines),
                        "page": None,
                        "locator": locator,
                    })

    if not chunks:
        for p_elem in container.findall(f".//{W_P}"):
            text = paragraph_text(p_elem)
            if text:
                p_counter += 1
                locator = f"paragraph:{p_counter}"
                chunks.append({
                    "id": f"{doc_id}:{locator}",
                    "text": text,
                    "page": None,
                    "locator": locator,
                })

    for name, part in extra_parts:
        try:
            if b"<!DOCTYPE" in part.upper() or b"<!ENTITY" in part.upper():
                raise ET.ParseError("XML declarations are not accepted")
            extra = ET.fromstring(part)
            for index, paragraph in enumerate(extra.findall(f".//{W_P}"), start=1):
                text = paragraph_text(paragraph)
                if text:
                    locator = f"part:{name}:paragraph:{index}"
                    chunks.append({"id": f"{doc_id}:{locator}", "text": text, "page": None, "locator": locator})
        except ET.ParseError:
            notices.append({"code": "unread_part", "message": "No se pudo interpretar una parte adicional del Word.", "sourceId": doc_id})
    if has_media or any(node.tag.rsplit('}', 1)[-1] in ("drawing", "pict", "object", "altChunk", "sdt") for node in root.iter()):
        notices.append({"code": "visual_content", "message": "El Word incluye imágenes, objetos o contenido especial que requiere revisión visual; el texto extraído no acredita una lectura completa.", "sourceId": doc_id})

    if not chunks:
        notices.append({
            "code": "empty_document",
            "message": "El documento Word no contiene bloques de texto extraíbles.",
            "sourceId": doc_id,
        })
        return "failed", None, [], notices

    return "needs_ocr" if notices else "complete", None, chunks, notices


def _find_tesseract_binary() -> str | None:
    if os.getenv("RADAR_DISABLE_OCR", "").strip().lower() in ("1", "true", "yes"):
        return None
    configured = os.getenv("RADAR_TESSERACT_CMD", "").strip()
    if configured and os.path.isfile(configured):
        return configured
    found = shutil.which("tesseract")
    if found:
        return found
    return None


def _ocr_pdf_page_with_tesseract(page: Any, tesseract_cmd: str) -> str:
    """Optional controlled local OCR via tesseract binary, trying upright and rotated orientations."""
    with tempfile.TemporaryDirectory(prefix="radar_ocr_") as tmpdir:
        for rotation in (0, 90, 270):
            try:
                if rotation != 0:
                    import fitz
                    matrix = fitz.Matrix(1, 1).prerotate(rotation)
                    pix = page.get_pixmap(dpi=180, alpha=False, matrix=matrix)
                else:
                    pix = page.get_pixmap(dpi=180, alpha=False)
                png_bytes = pix.tobytes("png")
            except Exception:
                continue

            img_path = os.path.join(tmpdir, f"page_{rotation}.png")
            with open(img_path, "wb") as fh:
                fh.write(png_bytes)

            for lang in ("spa+eng", "spa", "eng"):
                try:
                    proc = subprocess.run(
                        [tesseract_cmd, img_path, "stdout", "-l", lang, "--psm", "6"],
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=20,
                        check=False,
                    )
                    if proc.returncode == 0 and proc.stdout and len(_clean_text(proc.stdout)) >= MIN_PAGE_TEXT_CHARS:
                        return _preserve_multiline_text(proc.stdout)
                except Exception:
                    continue
    return ""


def _extract_pdf_chunks(data: bytes, doc_id: str, title: str) -> tuple[str, int | None, list[dict[str, Any]], list[dict[str, Any]]]:
    """Extract per-page text from PDF; detect scanned/image-only pages and require OCR."""
    notices: list[dict[str, Any]] = []
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return (
            "failed",
            None,
            [],
            [{"code": "pdf_engine_unavailable", "message": "El motor de lectura PDF (PyMuPDF) no está disponible.", "sourceId": doc_id}],
        )

    try:
        pdf = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return (
            "failed",
            None,
            [],
            [{"code": "invalid_pdf", "message": f"El archivo «{title}» no es un documento PDF válido o está dañado.", "sourceId": doc_id}],
        )

    try:
        if pdf.is_encrypted:
            return (
                "failed",
                None,
                [],
                [{"code": "encrypted_pdf", "message": f"El PDF «{title}» está protegido con contraseña y no puede leerse.", "sourceId": doc_id}],
            )

        page_count = int(pdf.page_count)
        if page_count <= 0:
            return (
                "failed",
                0,
                [],
                [{"code": "empty_pdf", "message": f"El PDF «{title}» no contiene páginas.", "sourceId": doc_id}],
            )

        chunks: list[dict[str, Any]] = []
        scanned_pages: list[int] = []
        ocr_recovered_pages: list[int] = []
        tesseract_cmd = _find_tesseract_binary()

        for page_index in range(page_count):
            page_num = page_index + 1
            page = pdf.load_page(page_index)
            raw_text = page.get_text("text") or ""
            cleaned = _preserve_multiline_text(raw_text)
            non_ws_len = len(re.sub(r"\s+", "", cleaned))
            image_area = sum((fitz.Rect(image["bbox"]) & page.rect).get_area() for image in page.get_image_info())
            image_body = image_area >= page.rect.get_area() * 0.25 and non_ws_len < 1000

            if non_ws_len >= MIN_PAGE_TEXT_CHARS and not image_body:
                locator = f"page:{page_num}"
                chunks.append({
                    "id": f"{doc_id}:{locator}",
                    "text": cleaned,
                    "page": page_num,
                    "locator": locator,
                })
                continue

            has_images = bool(page.get_images(full=False))
            if tesseract_cmd and page_count <= MAX_OCR_PAGES:
                ocr_text = _ocr_pdf_page_with_tesseract(page, tesseract_cmd)
                if len(re.sub(r"\s+", "", ocr_text)) >= MIN_PAGE_TEXT_CHARS:
                    locator = f"page:{page_num}"
                    chunks.append({
                        "id": f"{doc_id}:{locator}",
                        "text": ocr_text,
                        "page": page_num,
                        "locator": locator,
                    })
                    ocr_recovered_pages.append(page_num)
                    continue

            if has_images or non_ws_len < MIN_PAGE_TEXT_CHARS:
                scanned_pages.append(page_num)
                if cleaned:
                    locator = f"page:{page_num}"
                    chunks.append({
                        "id": f"{doc_id}:{locator}",
                        "text": cleaned,
                        "page": page_num,
                        "locator": locator,
                    })

        if scanned_pages:
            notices.append({
                "code": "needs_ocr",
                "message": (
                    f"El PDF «{title}» contiene {len(scanned_pages)} de {page_count} página(s) escaneadas o sin capa de texto "
                    "y requiere OCR o revisión visual."
                ),
                "sourceId": doc_id,
            })
            return "needs_ocr", page_count, chunks, notices

        if ocr_recovered_pages:
            notices.append({
                "code": "ocr_applied",
                "message": (
                    f"Se aplicó OCR en {len(ocr_recovered_pages)} página(s) escaneadas de «{title}»; "
                    "requiere verificación visual de tablas y páginas apaisadas."
                ),
                "sourceId": doc_id,
            })
            return "needs_ocr", page_count, chunks, notices

        if not chunks:
            notices.append({
                "code": "needs_ocr",
                "message": f"El PDF «{title}» no tiene capa de texto extraíble y requiere OCR.",
                "sourceId": doc_id,
            })
            return "needs_ocr", page_count, [], notices

        return "complete", page_count, chunks, notices
    finally:
        pdf.close()


def _detect_payload_kind(data: bytes, filename_hint: str, content_type: str) -> str:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
                names = set(zf.namelist())
                if "word/document.xml" in names:
                    return "docx"
                if "xl/workbook.xml" in names:
                    return "xlsx"
                if "ppt/presentation.xml" in names:
                    return "pptx"
                return "zip"
        except zipfile.BadZipFile:
            return "corrupt_zip"
    if data.startswith(b"Rar!\x1a\x07"):
        return "rar"
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "ole_legacy"
    return "unknown"


def _extract_archive_documents(
    data: bytes,
    parent_title: str,
    parent_url: str,
    parent_sha256: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Extract PDF and DOCX files inside a ZIP archive without silently dropping any member."""
    docs: list[dict[str, Any]] = []
    notices: list[dict[str, Any]] = []
    parent_id = _make_source_id(parent_url)

    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
            infos = [info for info in zf.infolist() if not info.is_dir()]
            if not infos:
                notices.append({
                    "code": "empty_archive",
                    "message": f"El archivo comprimido «{parent_title}» está vacío.",
                    "sourceId": parent_id,
                })
                docs.append({
                    "id": parent_id,
                    "title": parent_title,
                    "url": parent_url,
                    "sha256": parent_sha256,
                    "status": "failed",
                    "pageCount": None,
                    "chunks": [],
                })
                return docs, notices

            if len(infos) > MAX_ARCHIVE_MEMBERS:
                notices.append({
                    "code": "archive_member_limit",
                    "message": (
                        f"El archivo comprimido «{parent_title}» contiene {len(infos)} archivos; "
                        f"sólo se procesaron los primeros {MAX_ARCHIVE_MEMBERS}."
                    ),
                    "sourceId": parent_id,
                })
                infos = infos[:MAX_ARCHIVE_MEMBERS]

            for idx, info in enumerate(infos, start=1):
                member_name = os.path.basename(info.filename.replace("\\", "/")) or f"archivo-{idx}"
                member_title = f"{parent_title} ({member_name})"[:300]
                member_id = "src-" + hashlib.sha256(f"{parent_url}#entry={info.filename}".encode("utf-8")).hexdigest()[:24]

                if info.file_size > MAX_DOCUMENT_BYTES:
                    notices.append({
                        "code": "too_large",
                        "message": f"El archivo «{member_name}» dentro de «{parent_title}» supera el límite de tamaño.",
                        "sourceId": member_id,
                    })
                    docs.append({
                        "id": member_id,
                        "title": member_title,
                        "url": parent_url,
                        "sha256": None,
                        "status": "failed",
                        "pageCount": None,
                        "chunks": [],
                    })
                    continue

                try:
                    member_bytes = zf.read(info)
                except Exception:
                    notices.append({
                        "code": "archive_read_failed",
                        "message": f"No se pudo descomprimir «{member_name}» dentro de «{parent_title}».",
                        "sourceId": member_id,
                    })
                    docs.append({
                        "id": member_id,
                        "title": member_title,
                        "url": parent_url,
                        "sha256": None,
                        "status": "failed",
                        "pageCount": None,
                        "chunks": [],
                    })
                    continue

                member_sha = hashlib.sha256(member_bytes).hexdigest()
                kind = _detect_payload_kind(member_bytes, member_name, "")
                if kind == "pdf":
                    st, page_count, chunks, sub_notices = _extract_pdf_chunks(member_bytes, member_id, member_title)
                    notices.extend(sub_notices)
                    docs.append({
                        "id": member_id,
                        "title": member_title,
                        "url": parent_url,
                        "sha256": member_sha,
                        "status": st,
                        "pageCount": page_count,
                        "chunks": chunks,
                    })
                elif kind == "docx":
                    st, page_count, chunks, sub_notices = _extract_docx_chunks(member_bytes, member_id)
                    notices.extend(sub_notices)
                    docs.append({
                        "id": member_id,
                        "title": member_title,
                        "url": parent_url,
                        "sha256": member_sha,
                        "status": st,
                        "pageCount": None,
                        "chunks": chunks,
                    })
                else:
                    notices.append({
                        "code": "unsupported_format",
                        "message": f"El archivo «{member_name}» dentro de «{parent_title}» tiene un formato no compatible para lectura automática.",
                        "sourceId": member_id,
                    })
                    docs.append({
                        "id": member_id,
                        "title": member_title,
                        "url": parent_url,
                        "sha256": member_sha,
                        "status": "failed",
                        "pageCount": None,
                        "chunks": [],
                    })
    except Exception:
        notices.append({
            "code": "invalid_archive",
            "message": f"No se pudo abrir el archivo comprimido «{parent_title}».",
            "sourceId": parent_id,
        })
        docs.append({
            "id": parent_id,
            "title": parent_title,
            "url": parent_url,
            "sha256": parent_sha256,
            "status": "failed",
            "pageCount": None,
            "chunks": [],
        })

    return docs, notices


def _discover_ficha_links(
    procedure_id: str,
    fetcher: Callable[..., Any] | None,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    """Query the known SEACE fichaProceso endpoint to discover all published attachments."""
    ficha_url = f"{SEACE_FICHA_API_PREFIX}{procedure_id}"
    discovered: list[dict[str, str]] = []
    notices: list[dict[str, Any]] = []

    try:
        _, _, body = _fetch_bounded(
            ficha_url,
            fetcher=fetcher,
            allow_api_port=True,
            max_bytes=MAX_FICHA_BYTES,
            accept="application/json",
            timeout=timeout,
        )
        data = json.loads(body.decode("utf-8"))
    except SourceFetchError as exc:
        notices.append({
            "code": f"ficha_{exc.code}",
            "message": f"No se pudo consultar la ficha completa de documentos en SEACE: {exc.message}",
            "sourceId": None,
        })
        return discovered, notices
    except Exception:
        notices.append({
            "code": "ficha_invalid_json",
            "message": "La ficha de documentos SEACE devolvió una respuesta inválida; la lista de adjuntos puede estar incompleta.",
            "sourceId": None,
        })
        return discovered, notices

    if not isinstance(data, dict):
        notices.append({
            "code": "ficha_invalid_shape",
            "message": "La ficha de documentos SEACE no devolvió el formato esperado.",
            "sourceId": None,
        })
        return discovered, notices

    raw_list = data.get("listaDocumentos")
    if not isinstance(raw_list, list):
        notices.append({
            "code": "ficha_missing_list",
            "message": "La ficha de SEACE no incluyó la lista de documentos publicados.",
            "sourceId": None,
        })
        return discovered, notices

    for idx, item in enumerate(raw_list):
        if not isinstance(item, dict):
            continue
        title = _clean_text(
            item.get("nombreArchivo") or item.get("tipoDocumento") or item.get("descripcion") or f"Documento {idx + 1}",
            max_len=240,
        )
        doc_type = _clean_text(item.get("tipoDocumento"), max_len=120)
        raw_url = item.get("url")
        alfresco_code = str(item.get("codigoAlfresco") or "").strip()
        if isinstance(raw_url, str) and raw_url.strip():
            url = raw_url.strip()
        elif alfresco_code and re.fullmatch(r"[A-Za-z0-9_-]{8,64}", alfresco_code):
            url = f"{ALFRESCO_DOWNLOAD_PREFIX}{alfresco_code}"
        else:
            notices.append({
                "code": "missing_document_url",
                "message": f"La ficha de SEACE publicó «{title}» sin código de descarga válido.",
                "sourceId": None,
            })
            continue
        entry = {"title": title, "url": url}
        if doc_type:
            entry["doc_type"] = doc_type
        discovered.append(entry)

    return discovered, notices


def _format_alert_document_title(title: str, doc_type: str) -> str:
    """Build a bounded official document title without discarding tipoDocumento."""
    clean_title = _clean_text(title, max_len=MAX_WHATSAPP_DOCUMENT_TITLE)
    clean_type = _clean_text(doc_type, max_len=80)
    if clean_type and clean_title and clean_type.lower() not in clean_title.lower():
        return _clean_text(f"{clean_type} — {clean_title}", max_len=MAX_WHATSAPP_DOCUMENT_TITLE)
    return (clean_title or clean_type)[:MAX_WHATSAPP_DOCUMENT_TITLE]


def _has_verified_seace_source_url(candidate: Any, procedure_id: str) -> bool:
    if not isinstance(candidate, dict):
        return False
    alert = candidate.get("alert") if isinstance(candidate.get("alert"), dict) else {}
    evidence = candidate.get("evidence") if isinstance(candidate.get("evidence"), dict) else {}
    expected = f"https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/{procedure_id}/2"
    return evidence.get("sourceUrl") == expected or alert.get("sourceUrl") == expected


def _alert_document_priority(title: str) -> int:
    """Rank official documents stably: 0=bases integradas, 1=other bases, 2=rest."""
    decomposed = unicodedata.normalize("NFKD", title)
    ascii_lower = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    norm = re.sub(r"[^a-z0-9]+", " ", ascii_lower).strip()
    if re.search(r"\bbases\s+integradas\b", norm) and not re.search(r"\b(pliegos?|absolucion)\b", norm):
        return 0
    if re.search(r"\bbases\b", norm) and not re.search(r"\b(pliegos?|absolucion)\b", norm):
        return 1
    return 2


def discover_alert_documents(
    candidate: Any,
    *,
    fetcher: Callable[..., Any] | None = None,
    timeout: float = ALERT_METADATA_TIMEOUT_SECONDS,
) -> list[dict[str, str]]:
    """Fetch bounded official SEACE document metadata for one alert without downloading PDFs."""
    procedure_id = extract_verified_procedure_id(candidate)
    if not procedure_id or not _has_verified_seace_source_url(candidate, procedure_id):
        return []
    discovered, _ = _discover_ficha_links(procedure_id, fetcher, timeout=timeout)
    documents: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for entry in discovered:
        raw_url = str(entry.get("url") or "").strip()
        if not WHATSAPP_ALFRESCO_URL_RE.fullmatch(raw_url):
            continue
        try:
            clean_url = validate_seace_url(raw_url, allow_api_port=False, resolve_dns=False)
        except SourceFetchError:
            continue
        if clean_url in seen_urls:
            continue
        title = _format_alert_document_title(entry.get("title", ""), entry.get("doc_type", ""))
        if not title:
            continue
        seen_urls.add(clean_url)
        documents.append({"title": title, "url": clean_url})
    return sorted(documents, key=lambda doc: _alert_document_priority(doc["title"]))[:MAX_WHATSAPP_EVIDENCE_DOCUMENTS]


def _process_single_link(
    entry: dict[str, Any],
    fetcher: Callable[..., Any] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_url = str(entry.get("url") or "").strip()
    title = _clean_text(entry.get("title") or "Documento publicado", max_len=240) or "Documento publicado"
    doc_id = _make_source_id(raw_url, int(entry.get("index", 0)))

    try:
        validated_url = validate_seace_url(raw_url, allow_api_port=False, resolve_dns=(fetcher is None))
    except SourceFetchError as exc:
        return (
            [{
                "id": doc_id,
                "title": title,
                "url": "",
                "sha256": None,
                "status": "failed",
                "pageCount": None,
                "chunks": [],
            }],
            [{
                "code": exc.code,
                "message": f"Se rechazó el enlace de «{title}»: {exc.message}",
                "sourceId": doc_id,
            }],
        )

    is_archive_hint = bool(re.search(r"\.(?:zip|rar)$", title, re.IGNORECASE) or re.search(r"\.(?:zip|rar)$", validated_url, re.IGNORECASE))
    max_bytes = MAX_ARCHIVE_BYTES if is_archive_hint else MAX_DOCUMENT_BYTES

    try:
        final_url, headers, body = _fetch_bounded(
            validated_url,
            fetcher=fetcher,
            allow_api_port=False,
            max_bytes=max_bytes,
        )
    except SourceFetchError as exc:
        return (
            [{
                "id": doc_id,
                "title": title,
                "url": validated_url,
                "sha256": None,
                "status": "failed",
                "pageCount": None,
                "chunks": [],
            }],
            [{
                "code": exc.code,
                "message": f"No se pudo descargar «{title}»: {exc.message}",
                "sourceId": doc_id,
            }],
        )

    if not body:
        return (
            [{
                "id": doc_id,
                "title": title,
                "url": final_url,
                "sha256": None,
                "status": "failed",
                "pageCount": None,
                "chunks": [],
            }],
            [{
                "code": "empty_body",
                "message": f"La descarga de «{title}» devolvió un archivo vacío.",
                "sourceId": doc_id,
            }],
        )

    sha256 = hashlib.sha256(body).hexdigest()
    content_type = headers.get("content-type", "")
    kind = _detect_payload_kind(body, title, content_type)

    if kind == "pdf":
        if len(body) > MAX_DOCUMENT_BYTES:
            return (
                [{
                    "id": doc_id,
                    "title": title,
                    "url": final_url,
                    "sha256": sha256,
                    "status": "failed",
                    "pageCount": None,
                    "chunks": [],
                }],
                [{
                    "code": "too_large",
                    "message": f"El documento PDF «{title}» supera el límite permitido.",
                    "sourceId": doc_id,
                }],
            )
        doc_status, page_count, chunks, notices = _extract_pdf_chunks(body, doc_id, title)
        return (
            [{
                "id": doc_id,
                "title": title,
                "url": final_url,
                "sha256": sha256,
                "status": doc_status,
                "pageCount": page_count,
                "chunks": chunks,
            }],
            notices,
        )

    if kind == "docx":
        doc_status, _, chunks, notices = _extract_docx_chunks(body, doc_id)
        return (
            [{
                "id": doc_id,
                "title": title,
                "url": final_url,
                "sha256": sha256,
                "status": doc_status,
                "pageCount": None,
                "chunks": chunks,
            }],
            notices,
        )

    if kind == "zip":
        return _extract_archive_documents(body, title, final_url, sha256)

    if kind == "rar":
        return (
            [{
                "id": doc_id,
                "title": title,
                "url": final_url,
                "sha256": sha256,
                "status": "failed",
                "pageCount": None,
                "chunks": [],
            }],
            [{
                "code": "unsupported_archive",
                "message": f"El archivo «{title}» está comprimido en formato RAR y requiere descompresión manual.",
                "sourceId": doc_id,
            }],
        )

    if kind == "ole_legacy":
        return (
            [{
                "id": doc_id,
                "title": title,
                "url": final_url,
                "sha256": sha256,
                "status": "failed",
                "pageCount": None,
                "chunks": [],
            }],
            [{
                "code": "legacy_office_format",
                "message": f"El archivo «{title}» está en formato binario antiguo (.doc/.xls) y no puede leerse como OOXML.",
                "sourceId": doc_id,
            }],
        )

    return (
        [{
            "id": doc_id,
            "title": title,
            "url": final_url,
            "sha256": sha256,
            "status": "failed",
            "pageCount": None,
            "chunks": [],
        }],
        [{
            "code": "unsupported_format",
            "message": f"El archivo «{title}» no es un documento PDF o Word (.docx) válido.",
            "sourceId": doc_id,
        }],
    )


def collect_sources(candidate: dict[str, Any], *, fetcher: Callable[..., Any] | None = None) -> dict[str, Any]:
    """Collect, validate, download, and extract all published SEACE documents for a candidate."""
    if not isinstance(candidate, dict):
        return {
            "status": "unavailable",
            "documents": [],
            "notices": [{
                "code": "invalid_candidate",
                "message": "El candidato recibido no tiene una estructura válida.",
                "sourceId": None,
            }],
        }

    notices: list[dict[str, Any]] = []
    evidence = candidate.get("evidence") if isinstance(candidate.get("evidence"), dict) else {}
    raw_evidence_docs = evidence.get("documents") if isinstance(evidence.get("documents"), list) else []

    inventory: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    def add_link(title: Any, url: Any) -> None:
        raw_u = str(url or "").strip()
        clean_t = _clean_text(title or "Documento publicado", max_len=240) or "Documento publicado"
        dedup_key = raw_u or f"__missing_url_{len(inventory)}"
        if dedup_key in seen_urls:
            return
        seen_urls.add(dedup_key)
        inventory.append({
            "index": len(inventory),
            "title": clean_t,
            "url": raw_u,
        })

    procedure_id = extract_verified_procedure_id(candidate)
    ficha_complete = False
    if procedure_id:
        ficha_links, ficha_notices = _discover_ficha_links(procedure_id, fetcher)
        notices.extend(ficha_notices)
        if not ficha_notices:
            ficha_complete = True
        for link in ficha_links:
            add_link(link.get("title"), link.get("url"))
    else:
        notices.append({
            "code": "unverified_procedure_id",
            "message": (
                "No se encontró un identificador de ficha SEACE verificable para consultar el expediente completo; "
                "sólo se revisaron los enlaces adjuntos al aviso."
            ),
            "sourceId": None,
        })

    for item in raw_evidence_docs:
        if isinstance(item, dict):
            add_link(item.get("title"), item.get("url"))

    if not inventory:
        if not any(n.get("code") == "no_documents" for n in notices):
            notices.append({
                "code": "no_documents",
                "message": "La convocatoria no tiene documentos publicados disponibles para descargar.",
                "sourceId": None,
            })
        return {
            "status": "unavailable",
            "documents": [],
            "notices": notices,
        }

    results_by_index: dict[int, tuple[list[dict[str, Any]], list[dict[str, Any]]]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as pool:
        future_map = {
            pool.submit(_process_single_link, entry, fetcher): entry["index"]
            for entry in inventory
        }
        for future in concurrent.futures.as_completed(future_map):
            idx = future_map[future]
            try:
                results_by_index[idx] = future.result()
            except Exception:
                entry = inventory[idx]
                fallback_id = _make_source_id(entry.get("url", ""), idx)
                results_by_index[idx] = (
                    [{
                        "id": fallback_id,
                        "title": entry.get("title", "Documento"),
                        "url": "",
                        "sha256": None,
                        "status": "failed",
                        "pageCount": None,
                        "chunks": [],
                    }],
                    [{
                        "code": "processing_failed",
                        "message": f"Ocurrió un error al procesar «{entry.get('title', 'Documento')}».",
                        "sourceId": fallback_id,
                    }],
                )

    documents: list[dict[str, Any]] = []
    for idx in range(len(inventory)):
        docs_part, notices_part = results_by_index[idx]
        documents.extend(docs_part)
        notices.extend(notices_part)

    if not documents:
        overall_status = "unavailable"
    else:
        any_readable = any(
            doc["status"] == "complete" or (doc["status"] == "needs_ocr" and len(doc["chunks"]) > 0)
            for doc in documents
        )
        all_complete = (
            ficha_complete
            and all(doc["status"] == "complete" and len(doc["chunks"]) > 0 for doc in documents)
            and not notices
        )
        if all_complete:
            overall_status = "complete"
        elif any_readable or any(doc["status"] == "needs_ocr" for doc in documents):
            overall_status = "partial"
        else:
            overall_status = "unavailable"

    return {
        "status": overall_status,
        "documents": documents,
        "notices": notices,
    }
