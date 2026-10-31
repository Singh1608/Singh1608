from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..domain.workflow import ACTIVE
from ..models import CompanyProfile, HistoricalBid, Tender, User, utcnow
from ..schemas import CompanyProfileIO, HistoricalBidIn, UserCreate, UserOut
from ..security import current_user, hash_key, new_api_key, require_roles
from ..services.pipeline import org_history
from ..services.win_probability import FEATURES, LABELS, model_for

router = APIRouter(prefix="/api/v1", tags=["administration & analytics"])


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.post("/users", status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db),
                admin: User = Depends(require_roles("admin"))):
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "Email already registered")
    key = new_api_key()
    u = User(org_id=admin.org_id, name=body.name, email=body.email, role=body.role,
             api_key_hash=hash_key(key))
    db.add(u)
    db.flush()
    audit.record(db, admin, "user", u.id, "create", {"role": body.role})
    db.commit()
    # The key is shown exactly once; only its hash is stored.
    return {"user": UserOut.model_validate(u), "api_key": key}


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_roles("admin"))):
    return db.scalars(select(User).where(User.org_id == admin.org_id)).all()


@router.get("/company-profile", response_model=CompanyProfileIO)
def get_profile(db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = db.scalar(select(CompanyProfile).where(CompanyProfile.org_id == user.org_id))
    return p or CompanyProfileIO()


@router.put("/company-profile", response_model=CompanyProfileIO)
def put_profile(body: CompanyProfileIO, db: Session = Depends(get_db),
                user: User = Depends(require_roles("admin", "bid_manager"))):
    p = db.scalar(select(CompanyProfile).where(CompanyProfile.org_id == user.org_id))
    if not p:
        p = CompanyProfile(org_id=user.org_id)
        db.add(p)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    audit.record(db, user, "company_profile", None, "update", body.model_dump())
    db.commit()
    return p


@router.post("/historical-bids", status_code=201)
def import_history(rows: list[HistoricalBidIn], db: Session = Depends(get_db),
                   user: User = Depends(require_roles("admin", "bid_manager"))):
    bad = [i for i, r in enumerate(rows) if set(r.features) != set(FEATURES)]
    if bad:
        raise HTTPException(422, f"Rows {bad[:10]} must have exactly these features: {FEATURES}")
    db.add_all(HistoricalBid(org_id=user.org_id, features=r.features, won=r.won) for r in rows)
    audit.record(db, user, "historical_bid", None, "import", {"rows": len(rows)})
    db.commit()
    return {"imported": len(rows)}


@router.get("/models/win-probability")
def model_info(db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = model_for(org_history(db, user.org_id))
    return {
        "version": m.version, "source": m.source, "training_samples": m.n_samples,
        "base_rate": round(m.base_rate, 3),
        "coefficients": [{"feature": f, "label": LABELS[f], "weight": round(float(c), 3)}
                         for f, c in zip(FEATURES, m.clf.coef_[0])],
    }


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    tenders = db.scalars(select(Tender).where(Tender.org_id == user.org_id)).all()
    by_status: dict[str, int] = {}
    for t in tenders:
        by_status[t.status] = by_status.get(t.status, 0) + 1

    pipeline_value = weighted = 0.0
    upcoming = []
    now = utcnow()
    for t in tenders:
        if t.status not in ACTIVE:
            continue
        value = t.bid_price or t.estimated_value or 0
        pw = (t.analyses[-1].win or {}).get("probability", 0) if t.analyses else 0
        pipeline_value += value
        weighted += value * pw
        if t.submission_deadline:
            dl = t.submission_deadline if t.submission_deadline.tzinfo else t.submission_deadline.replace(tzinfo=now.tzinfo)
            if now <= dl <= now + timedelta(days=21):
                pending = sum(a.decision == "PENDING" for a in t.approvals)
                upcoming.append({
                    "id": t.id, "title": t.title, "status": t.status, "deadline": dl,
                    "days_left": (dl - now).days,
                    # SLA: approvals still open inside the last three days.
                    "at_risk": pending > 0 and (dl - now).days <= 3,
                })

    won = by_status.get("WON", 0)
    decided = won + by_status.get("LOST", 0)
    hist = db.scalar(select(func.count()).select_from(HistoricalBid)
                     .where(HistoricalBid.org_id == user.org_id)) or 0
    return {
        "counts_by_status": by_status,
        "active_pipeline_value": round(pipeline_value, 2),
        "probability_weighted_pipeline": round(weighted, 2),
        "win_rate": round(won / decided, 3) if decided else None,
        "decided_bids": decided,
        "historical_bids_on_file": hist,
        "upcoming_deadlines": sorted(upcoming, key=lambda u: u["deadline"]),
    }
