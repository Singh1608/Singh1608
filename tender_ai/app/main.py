from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select, text

from . import db as dbmod
from .config import get_settings
from .models import Organization, User
from .security import hash_key
from .services import llm

log = logging.getLogger("tender_ai")
STATIC = Path(__file__).parent / "static"


def _bootstrap_admin() -> None:
    key = get_settings().bootstrap_admin_key
    if not key:
        return
    with dbmod.SessionLocal() as s:
        if s.scalar(select(func.count()).select_from(User)):
            return
        org = Organization(name="Default")
        s.add(org)
        s.flush()
        s.add(User(org_id=org.id, name="Administrator", email="admin@localhost", role="admin",
                   api_key_hash=hash_key(key)))
        s.commit()
        log.warning("Bootstrapped admin user from TENDER_BOOTSTRAP_ADMIN_KEY")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    dbmod.init_db()
    _bootstrap_admin()
    if get_settings().demo_mode:
        from .cli import seed_demo

        seed_demo()  # idempotent; offline extractor, so cold starts cost nothing
    yield


def create_app() -> FastAPI:
    from .api import admin, tenders

    app = FastAPI(
        title="Tender AI — Tender Analysis & Procurement Automation",
        version="1.0.0",
        lifespan=lifespan,
        description="AI tender summarisation, eligibility & risk analysis, win-probability, "
                    "profit forecasting and governed bid workflow.",
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        log.info("%s %s %s %.0fms rid=%s", request.method, request.url.path,
                 response.status_code, (time.perf_counter() - start) * 1000, rid)
        return response

    app.include_router(tenders.router)
    app.include_router(admin.router)

    @app.get("/health", tags=["ops"])
    def health():
        return {"status": "ok"}

    @app.get("/ready", tags=["ops"])
    def ready():
        with dbmod.SessionLocal() as s:
            s.execute(text("SELECT 1"))
        return {"status": "ready", "llm_enabled": llm.is_enabled(),
                "environment": get_settings().environment,
                "demo_mode": get_settings().demo_mode}

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html")

    return app


app = create_app()
