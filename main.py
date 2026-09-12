from __future__ import annotations

import base64
import hmac
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from server.week2_router import router as week2_router

ROOT = Path(__file__).resolve().parent
APP_USERNAME = os.getenv("APP_USERNAME", "esg")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")

app = FastAPI(
    title="ESG College Football Week 2 Command Center",
    version="2026.09.12",
)

@app.middleware("http")
async def basic_auth(request: Request, call_next):
    # Render must be able to reach this without credentials.
    if request.url.path == "/health":
        return await call_next(request)

    if not APP_PASSWORD:
        return JSONResponse(
            {"detail": "APP_PASSWORD is not configured on the server."},
            status_code=503,
        )

    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("basic "):
        return JSONResponse(
            {"detail": "Authentication required."},
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="ESG Football"'},
        )

    try:
        token = auth.split(" ", 1)[1].strip()
        decoded = base64.b64decode(token).decode("utf-8")
        username, password = decoded.split(":", 1)
    except Exception:
        return JSONResponse(
            {"detail": "Invalid authentication header."},
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="ESG Football"'},
        )

    if not (
        hmac.compare_digest(username, APP_USERNAME)
        and hmac.compare_digest(password, APP_PASSWORD)
    ):
        return JSONResponse(
            {"detail": "Invalid credentials."},
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="ESG Football"'},
        )

    return await call_next(request)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ESG College Week 2 Command Center",
        "version": "2026.09.12",
    }

app.include_router(week2_router)

# Static mount is deliberately last so health/API routes keep precedence.
app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="week2-static")
