"""
ESG College Week 2 ESPN proxy/cache.
Drop-in router for the existing FastAPI service.
No PFF calls are made here.
"""
from __future__ import annotations

import asyncio
import re
import time
from datetime import date as date_type
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/v1/college/week2", tags=["college-week2"])

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
_TIMEOUT = httpx.Timeout(12.0, connect=5.0)
_cache: dict[str, tuple[float, Any]] = {}
_lock = asyncio.Lock()

def _get(key: str) -> Any | None:
    item = _cache.get(key)
    if not item:
        return None
    expires, value = item
    if expires <= time.monotonic():
        _cache.pop(key, None)
        return None
    return value

def _put(key: str, value: Any, ttl: int) -> None:
    _cache[key] = (time.monotonic() + ttl, value)

async def _espn_json(url: str, *, ttl: int, key: str) -> Any:
    cached = _get(key)
    if cached is not None:
        return cached
    async with _lock:
        cached = _get(key)
        if cached is not None:
            return cached
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
                response = await client.get(url, headers={"User-Agent": "ESG-Football-Intelligence/2026"})
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=502, detail=f"ESPN upstream error: {type(exc).__name__}") from exc
        _put(key, payload, ttl)
        return payload

@router.get("/scoreboard")
async def scoreboard(date: str = Query(..., description="YYYY-MM-DD")) -> Any:
    try:
        parsed = date_type.fromisoformat(date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from exc
    ymd = parsed.strftime("%Y%m%d")
    url = f"{ESPN_BASE}/scoreboard?dates={ymd}&limit=1000"
    return await _espn_json(url, ttl=30, key=f"scoreboard:{ymd}")

@router.get("/summary/{event_id}")
async def summary(event_id: str) -> Any:
    if not re.fullmatch(r"\d{6,12}", event_id):
        raise HTTPException(status_code=400, detail="invalid ESPN event id")
    url = f"{ESPN_BASE}/summary?event={event_id}"
    # Short enough for live polling; final games are still cheap to recheck manually.
    return await _espn_json(url, ttl=45, key=f"summary:{event_id}")
