"""Operational commands.

    python -m app.cli init-db
    python -m app.cli seed-demo      # demo org, one user per role, profile, sample tender
    python -m app.cli analyze FILE   # one-off analysis of a text file, prints JSON
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select

from . import db as dbmod
from .models import CompanyProfile, Organization, Tender, User
from .schemas import AnalyzeRequest, PricingIn
from .security import hash_key
from .services import pipeline

SAMPLE = Path(__file__).resolve().parent.parent / "sample_data" / "smart_city_rfp.txt"
DEMO_ROLES = ("admin", "analyst", "bid_manager", "finance", "legal", "executive", "viewer")


def sample_text(today: date | None = None) -> str:
    today = today or date.today()
    return SAMPLE.read_text().format(
        PREBID=(today + timedelta(days=7)).strftime("%d %B %Y"),
        DEADLINE=(today + timedelta(days=30)).strftime("%d %B %Y"),
        OPENING=(today + timedelta(days=31)).isoformat(),
    )


def seed_demo() -> dict[str, str]:
    dbmod.init_db()
    keys: dict[str, str] = {}
    with dbmod.SessionLocal() as s:
        if s.scalar(select(Organization).where(Organization.name == "Demo Infra Ltd")):
            print("Demo data already present", file=sys.stderr)
            return {}
        org = Organization(name="Demo Infra Ltd", base_currency="USD")
        s.add(org)
        s.flush()
        for role in DEMO_ROLES:
            # Deterministic demo keys: never use these outside a sandbox.
            key = f"demo-{role}-key"
            keys[role] = key
            s.add(User(org_id=org.id, name=role.replace("_", " ").title(),
                       email=f"{role}@demo.local", role=role, api_key_hash=hash_key(key)))
        s.add(CompanyProfile(
            org_id=org.id, annual_turnover=45_000_000, net_worth=12_000_000, years_in_business=11,
            largest_similar_project=9_000_000,
            certifications=["ISO 9001", "ISO 27001", "CMMI L3"],
            sectors=["Smart City", "Transport Technology", "Telecom"],
            regions=["Northern Region", "Central Region"],
            max_concurrent_bids=8, available_bank_guarantee_limit=3_000_000,
        ))
        s.flush()
        analyst = s.scalar(select(User).where(User.email == "analyst@demo.local"))
        t = Tender(org_id=org.id, created_by=analyst.id, source_text=sample_text(), title="")
        s.add(t)
        s.flush()
        pipeline.run(s, t, analyst, AnalyzeRequest(
            use_llm=False, pricing=PricingIn(direct_cost=8_900_000, bid_preparation_cost=60_000)))
        s.commit()
    return keys


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="tender-ai")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    sub.add_parser("seed-demo")
    a = sub.add_parser("analyze")
    a.add_argument("file")
    args = ap.parse_args(argv)

    if args.cmd == "init-db":
        dbmod.init_db()
        print("Database initialised")
    elif args.cmd == "seed-demo":
        for role, key in seed_demo().items():
            print(f"{role:12s} X-API-Key: {key}")
    elif args.cmd == "analyze":
        text = Path(args.file).read_text()
        ex, engine, _, reason = pipeline.extract(text, use_llm=True)
        print(json.dumps({"engine": engine, "fallback_reason": reason, **ex.model_dump()}, indent=2))


if __name__ == "__main__":
    main()
