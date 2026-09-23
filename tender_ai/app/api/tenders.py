from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from starlette.concurrency import run_in_threadpool

from .. import audit
from ..db import get_db
from ..domain.workflow import WorkflowError, allowed_actions, check
from ..models import AuditLog, Tender, User
from ..schemas import (
    ActionRequest, AnalysisOut, AnalyzeRequest, TenderCreate, TenderDetail, TenderOut,
)
from ..security import current_user, require_roles
from ..services import pipeline, workflow_service

router = APIRouter(prefix="/api/v1/tenders", tags=["tenders"])
WRITERS = ("analyst", "bid_manager", "admin")
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _get(db: Session, user: User, tender_id: int) -> Tender:
    t = db.get(Tender, tender_id)
    if not t or t.org_id != user.org_id:  # never reveal other orgs' tenders exist
        raise HTTPException(404, "Tender not found")
    return t


def _detail(t: Tender, user: User) -> TenderDetail:
    out = TenderDetail.model_validate(t, from_attributes=True)
    out.latest_analysis = AnalysisOut.model_validate(t.analyses[-1]) if t.analyses else None
    out.allowed_actions = allowed_actions(t.status, user.role)
    return out


def _commit(db: Session) -> None:
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(409, "Tender was modified concurrently; reload and retry")


def _create(db: Session, user: User, body: TenderCreate) -> Tender:
    t = Tender(org_id=user.org_id, created_by=user.id, source_text=body.text,
               title=body.title or "", reference=body.reference, buyer=body.buyer,
               sector=body.sector, region=body.region)
    db.add(t)
    db.flush()
    audit.record(db, user, "tender", t.id, "create", {"chars": len(body.text)})
    return t


@router.post("", response_model=TenderDetail, status_code=201)
def create_tender(body: TenderCreate, analyze: bool = True, db: Session = Depends(get_db),
                  user: User = Depends(require_roles(*WRITERS))):
    t = _create(db, user, body)
    if analyze:
        pipeline.run(db, t, user, AnalyzeRequest())
    _commit(db)
    return _detail(t, user)


@router.post("/upload", response_model=TenderDetail, status_code=201)
async def upload_tender(file: UploadFile = File(...), title: str | None = Form(None),
                        db: Session = Depends(get_db),
                        user: User = Depends(require_roles(*WRITERS))):
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds 25 MB")
    name = (file.filename or "").lower()
    if name.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            raise HTTPException(415, "PDF support needs the optional 'pypdf' package")
        text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(raw)).pages)
    elif name.endswith((".txt", ".md", ".text")):
        text = raw.decode("utf-8", errors="replace")
    else:
        raise HTTPException(415, "Supported formats: .pdf, .txt, .md")
    if len(text.strip()) < 50:
        raise HTTPException(422, "Could not read enough text from the document (scanned PDF?)")

    def work() -> TenderDetail:  # the AI call blocks, so keep it off the event loop
        t = _create(db, user, TenderCreate(text=text, title=title))
        pipeline.run(db, t, user, AnalyzeRequest())
        _commit(db)
        return _detail(t, user)

    return await run_in_threadpool(work)


@router.get("", response_model=list[TenderOut])
def list_tenders(status: str | None = None, limit: int = 100, offset: int = 0,
                 db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(Tender).where(Tender.org_id == user.org_id)
    if status:
        q = q.where(Tender.status == status.upper())
    q = q.order_by(Tender.submission_deadline.is_(None), Tender.submission_deadline, Tender.id.desc())
    return db.scalars(q.limit(min(limit, 500)).offset(offset)).all()


@router.get("/{tender_id}", response_model=TenderDetail)
def get_tender(tender_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _detail(_get(db, user, tender_id), user)


@router.get("/{tender_id}/analyses", response_model=list[AnalysisOut])
def list_analyses(tender_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _get(db, user, tender_id).analyses


@router.post("/{tender_id}/analyze", response_model=TenderDetail)
def analyze(tender_id: int, body: AnalyzeRequest, db: Session = Depends(get_db),
            user: User = Depends(current_user)):
    t = _get(db, user, tender_id)
    try:
        check("analyze", t.status, user.role)
    except WorkflowError as e:
        raise HTTPException(e.status_code, str(e))
    pipeline.run(db, t, user, body)
    _commit(db)
    return _detail(t, user)


@router.post("/{tender_id}/actions/{action}", response_model=TenderDetail)
def act(tender_id: int, action: str, body: ActionRequest, db: Session = Depends(get_db),
        user: User = Depends(current_user)):
    t = _get(db, user, tender_id)
    try:
        workflow_service.perform(db, t, user, action, body)
    except WorkflowError as e:
        db.rollback()
        raise HTTPException(e.status_code, str(e))
    _commit(db)
    return _detail(t, user)


@router.get("/{tender_id}/audit")
def tender_audit(tender_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _get(db, user, tender_id)
    rows = db.scalars(select(AuditLog).where(
        AuditLog.org_id == user.org_id, AuditLog.entity == "tender", AuditLog.entity_id == tender_id,
    ).order_by(AuditLog.id)).all()
    return [{"at": r.at, "actor_id": r.actor_id, "action": r.action, "detail": r.detail} for r in rows]
