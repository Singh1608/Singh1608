import os
import sys
from pathlib import Path

os.environ["TENDER_LLM_ENABLED"] = "off"
os.environ["TENDER_MC_RUNS"] = "1500"
os.environ.setdefault("TENDER_DATABASE_URL", "sqlite://")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402


@pytest.fixture
def client(tmp_path):
    from sqlalchemy import create_engine

    from app import db
    from app.cli import seed_demo
    from app.main import create_app

    db.engine = create_engine(f"sqlite:///{tmp_path}/t.db", connect_args={"check_same_thread": False},
                              poolclass=StaticPool)
    db.SessionLocal.configure(bind=db.engine)
    seed_demo()
    with TestClient(create_app()) as c:
        yield c


def hdr(role: str) -> dict[str, str]:
    return {"X-API-Key": f"demo-{role}-key"}
