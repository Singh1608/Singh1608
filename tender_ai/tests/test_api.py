from app.cli import sample_text

from .conftest import hdr

SHORT_DEADLINE_TENDER = """Title: Emergency network refresh
Issued by: City Water Board
Estimated contract value: USD 400,000
Last date for submission: 2020-01-01
The board seeks a contractor to refresh its SCADA network. Bidders must hold ISO 27001.
Average annual turnover of at least USD 90 million is required.
"""


def _first_tender(client):
    return client.get("/api/v1/tenders", headers=hdr("viewer")).json()[0]["id"]


def test_auth_and_rbac(client):
    assert client.get("/api/v1/tenders").status_code == 401
    assert client.get("/api/v1/tenders", headers={"X-API-Key": "nope"}).status_code == 401
    r = client.post("/api/v1/tenders", json={"text": sample_text()}, headers=hdr("viewer"))
    assert r.status_code == 403


def test_seeded_tender_has_full_analysis(client):
    t = client.get(f"/api/v1/tenders/{_first_tender(client)}", headers=hdr("bid_manager")).json()
    a = t["latest_analysis"]
    assert t["status"] == "ANALYZED"
    assert a["engine"] == "heuristic"
    assert a["compliance"]["eligible"] is True
    assert 0 < a["win"]["probability"] < 1
    assert a["forecast"]["evaluated_price"]["price"] > 0
    assert "decide" in t["allowed_actions"]


def test_end_to_end_bid_workflow(client):
    tid = _first_tender(client)
    act = lambda role, action, **body: client.post(  # noqa: E731
        f"/api/v1/tenders/{tid}/actions/{action}", json=body, headers=hdr(role))

    assert act("analyst", "decide", decision="bid").status_code == 403
    assert act("bid_manager", "decide", decision="bid").json()["status"] == "PRICING"

    r = act("bid_manager", "submit_for_approval", bid_price=13_000_000)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "PENDING_APPROVAL"
    assert {a["role_required"] for a in body["approvals"]} == {"finance", "executive"}

    assert act("finance", "reject").status_code == 422  # rejection needs a reason
    assert act("finance", "approve", comment="Margin OK").json()["status"] == "PENDING_APPROVAL"
    assert act("finance", "approve").status_code == 403  # already signed
    assert act("executive", "approve").json()["status"] == "APPROVED"
    assert act("bid_manager", "mark_submitted").json()["status"] == "SUBMITTED"
    assert act("bid_manager", "record_outcome", outcome="won").json()["status"] == "WON"

    audit = client.get(f"/api/v1/tenders/{tid}/audit", headers=hdr("viewer")).json()
    assert [e["action"] for e in audit][-6:] == [
        "decide", "submit_for_approval", "approve", "approve", "mark_submitted", "record_outcome"]
    assert client.get("/api/v1/dashboard", headers=hdr("viewer")).json()["historical_bids_on_file"] == 1


def test_segregation_of_duties(client):
    tid = _first_tender(client)
    # Below the finance threshold the sign-off is a bid manager, but not the pricer.
    client.post(f"/api/v1/tenders/{tid}/actions/decide", json={"decision": "bid"}, headers=hdr("bid_manager"))
    r = client.post(f"/api/v1/tenders/{tid}/actions/submit_for_approval", json={"bid_price": 500_000},
                    headers=hdr("bid_manager"))
    assert [a["role_required"] for a in r.json()["approvals"]] == ["bid_manager"]
    r = client.post(f"/api/v1/tenders/{tid}/actions/approve", json={}, headers=hdr("bid_manager"))
    assert r.status_code == 403 and "Segregation" in r.json()["detail"]


def test_hard_stop_needs_executive_override(client):
    r = client.post("/api/v1/tenders", json={"text": SHORT_DEADLINE_TENDER}, headers=hdr("analyst"))
    t = r.json()
    rec = t["latest_analysis"]["recommendation"]
    assert rec["decision"] == "NO_BID"
    assert any("deadline" in h.lower() for h in rec["hard_stops"])
    assert any("eligibility" in h.lower() for h in rec["hard_stops"])

    url = f"/api/v1/tenders/{t['id']}/actions/decide"
    assert client.post(url, json={"decision": "bid"}, headers=hdr("bid_manager")).status_code == 403
    assert client.post(url, json={"decision": "bid", "comment": "short"},
                       headers=hdr("executive")).status_code == 422
    ok = client.post(url, json={"decision": "bid", "comment": "Strategic account; partner covers turnover"},
                     headers=hdr("executive"))
    assert ok.json()["status"] == "PRICING"


def test_reanalysis_is_append_only_and_reuses_extraction(client):
    tid = _first_tender(client)
    r = client.post(f"/api/v1/tenders/{tid}/analyze", headers=hdr("analyst"), json={
        "reuse_extraction": True, "bid_context": {"technical_score": 0.9, "competitors": 2, "incumbent": True},
        "pricing": {"direct_cost": 8_900_000, "bid_price": 12_000_000}})
    assert r.status_code == 200, r.text
    analyses = client.get(f"/api/v1/tenders/{tid}/analyses", headers=hdr("viewer")).json()
    assert len(analyses) == 2
    assert analyses[1]["forecast"]["evaluated_price"]["price"] == 12_000_000
    assert analyses[1]["win"]["probability"] > analyses[0]["win"]["probability"]


def test_org_isolation(client):
    r = client.post("/api/v1/users", headers=hdr("admin"),
                    json={"name": "Other", "email": "o@x.test", "role": "viewer"})
    assert r.status_code == 201
    from app import db
    from app.models import Organization, User

    with db.SessionLocal() as s:
        other = Organization(name="Other Co")
        s.add(other)
        s.flush()
        s.get(User, r.json()["user"]["id"]).org_id = other.id
        s.commit()
    key = {"X-API-Key": r.json()["api_key"]}
    assert client.get("/api/v1/tenders", headers=key).json() == []
    assert client.get(f"/api/v1/tenders/{_first_tender(client)}", headers=key).status_code == 404


def test_upload_text_file(client):
    files = {"file": ("rfp.txt", sample_text().encode(), "text/plain")}
    r = client.post("/api/v1/tenders/upload", files=files, headers=hdr("analyst"))
    assert r.status_code == 201, r.text
    assert r.json()["reference"] == "MTA/ITMS/2026/042"
    bad = client.post("/api/v1/tenders/upload", files={"file": ("x.docx", b"123", "application/octet-stream")},
                      headers=hdr("analyst"))
    assert bad.status_code == 415


def test_health_and_dashboard_page(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").json()["llm_enabled"] is False
    assert "Tender AI" in client.get("/").text


def test_demo_mode_seeds_on_startup(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine

    from app import config, db
    from app.main import create_app

    monkeypatch.setenv("TENDER_DEMO_MODE", "1")
    config.get_settings.cache_clear()
    db.engine = create_engine(f"sqlite:///{tmp_path}/demo.db", connect_args={"check_same_thread": False})
    db.SessionLocal.configure(bind=db.engine)
    try:
        with TestClient(create_app()) as c:
            assert c.get("/ready").json()["demo_mode"] is True
            assert len(c.get("/api/v1/tenders", headers=hdr("viewer")).json()) == 1
        with TestClient(create_app()) as c:  # a warm restart must not duplicate data
            assert len(c.get("/api/v1/tenders", headers=hdr("viewer")).json()) == 1
    finally:
        monkeypatch.delenv("TENDER_DEMO_MODE")
        config.get_settings.cache_clear()
