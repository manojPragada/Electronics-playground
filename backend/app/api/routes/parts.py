"""Part library endpoint: parts defined at runtime (see services/part_library.py)."""

from __future__ import annotations

from fastapi import APIRouter

from app.services import part_library

router = APIRouter()


@router.get("/")
async def list_parts() -> dict[str, list[dict]]:
    """Every part in the library, validated. Read-only: parts are created by
    the MCP server (define_part), not by browsers."""
    return {"parts": part_library.list_parts()}
