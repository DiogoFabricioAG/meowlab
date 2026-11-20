"""Fail-closed server-to-server authentication for MeowLab -> tender-service."""
from __future__ import annotations

import hmac
import os
from pathlib import Path

from fastapi import Header, HTTPException


def read_secret(name: str) -> str:
    """Read a secret from `<NAME>_FILE` (Docker Secrets) or `<NAME>` env var."""
    file_path = os.getenv(f"{name}_FILE", "").strip()
    if file_path:
        try:
            value = Path(file_path).read_text(encoding="utf-8").strip()
            if value:
                return value
        except OSError:
            return ""
    return os.getenv(name, "").strip()


def require_meowlab_service(
    authorization: str | None = Header(default=None),
    x_meowlab_company: str | None = Header(default=None, alias="X-MeowLab-Company"),
) -> str:
    """Authenticate MeowLab server calls and resolve the linked RADAR_WEB_ACCOUNT (fail closed)."""
    expected_token = read_secret("TENDER_SERVICE_TOKEN")
    expected_company = os.getenv("RADAR_PORTAL_COMPANY_ID", "").strip()
    owner = os.getenv("RADAR_WEB_ACCOUNT", "").strip()

    if not expected_token or not expected_company or not owner or len(owner) > 100:
        raise HTTPException(503, "El servicio nativo de Tender Cat no está configurado.")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Autenticación de servicio requerida.")
    presented_token = authorization[7:].strip()
    if not presented_token or not hmac.compare_digest(presented_token, expected_token):
        raise HTTPException(401, "Token de servicio inválido.")

    company = (x_meowlab_company or "").strip()
    if not company or not hmac.compare_digest(company, expected_company):
        raise HTTPException(403, "Esta cuenta de Tender Cat no pertenece a la empresa indicada.")

    return owner
