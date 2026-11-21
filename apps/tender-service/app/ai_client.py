"""Minimal OpenAI Responses API helper and tool schema builder (no chat/license routes)."""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

from .security import read_secret


def tool(name: str, description: str, properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "strict": True,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        },
    }


def provider_events(payload: dict[str, Any]):
    # Fixed host, verified TLS and no redirects. Never accepts keys or base URLs from callers.
    api_key = read_secret("RADAR_OPENAI_API_KEY")
    if not api_key:
        raise KeyError("RADAR_OPENAI_API_KEY")
    with httpx.Client(timeout=httpx.Timeout(45, connect=10), follow_redirects=False) as client:
        with client.stream(
            "POST",
            "https://api.openai.com/v1/responses",
            headers={"Authorization": "Bearer " + api_key},
            json=payload,
        ) as response:
            response.raise_for_status()
            total = 0
            for line in response.iter_lines():
                total += len(line)
                if total > 2_000_000 or len(line) > 300_000:
                    raise ValueError("provider_stream_too_large")
                if line.startswith("data:"):
                    value = line[5:].strip()
                    if value and value != "[DONE]":
                        yield json.loads(value)
