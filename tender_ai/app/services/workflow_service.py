"""Executes workflow actions against the database with policy enforcement."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..domain import rules
from ..domain.workflow import HARD_STOP_OVERRIDE_ROLES, WorkflowError, check
from ..models import Approval, HistoricalBid, Tender, User, utcnow
from ..schemas import ActionRequest


def _latest(tender: Tender):
    if not tender.analyses:
        raise WorkflowError("Tender has not been analysed yet")
    return tender.analyses[-1]


def perform(db: Session, tender: Tender, user: User, action: str, req: ActionRequest) -> Tender:
    if action == "analyze":
        raise WorkflowError("Use POST /tenders/{id}/analyze", 400)
    check(action, tender.status, user.role)
    before = tender.status
    detail: dict = {"comment": req.comment}

    if action == "decide":
        if req.decision is None:
            raise WorkflowError("'decision' is required (bid | no_bid)", 422)
        rec = _latest(tender).recommendation or {}
        if req.decision == "bid" and rec.get("hard_stops"):
            if user.role not in HARD_STOP_OVERRIDE_ROLES:
                raise WorkflowError(
                    "Recommendation has hard stops; only an executive can override", 403)
            if not req.comment or len(req.comment) < 20:
                raise WorkflowError("Overriding a hard stop needs a written justification (≥20 chars)", 422)
            detail["override_of"] = rec["hard_stops"]
        tender.status = "PRICING" if req.decision == "bid" else "NO_BID"
        detail["decision"] = req.decision

    elif action == "submit_for_approval":
        analysis = _latest(tender)
        price = req.bid_price or (analysis.forecast or {}).get("evaluated_price", {}).get("price")
        if not price:
            raise WorkflowError("Provide bid_price or run a forecast before submitting for approval", 422)
        tender.bid_price = price
        tender.priced_by = user.id
        for a in tender.approvals:
            if a.decision == "PENDING":
                a.decision = "SUPERSEDED"
        for role, reason in rules.required_approvals(price, analysis.risk, get_settings()):
            tender.approvals.append(Approval(role_required=role, reason=reason))
        tender.status = "PENDING_APPROVAL"
        detail["bid_price"] = price

    elif action in ("approve", "reject"):
        # Segregation of duties: whoever set the price cannot sign it off.
        if tender.priced_by == user.id:
            raise WorkflowError("Segregation of duties: the pricer cannot approve their own bid", 403)
        pending = [a for a in tender.approvals if a.decision == "PENDING" and a.role_required == user.role]
        if not pending:
            raise WorkflowError(f"No pending approval for role '{user.role}'", 403)
        if action == "reject" and not req.comment:
            raise WorkflowError("A rejection needs a comment", 422)
        step = pending[0]
        step.decision = "APPROVED" if action == "approve" else "REJECTED"
        step.decided_by, step.comment, step.decided_at = user.id, req.comment, utcnow()
        detail["approval_id"] = step.id
        if action == "reject":
            tender.status = "PRICING"
            for a in tender.approvals:
                if a.decision == "PENDING":
                    a.decision = "SUPERSEDED"
        elif all(a.decision != "PENDING" for a in tender.approvals):
            tender.status = "APPROVED"

    elif action == "mark_submitted":
        deadline = tender.submission_deadline
        if deadline is not None:
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=utcnow().tzinfo)
            if utcnow() > deadline:
                raise WorkflowError("Submission deadline has passed")
        tender.status = "SUBMITTED"

    elif action == "record_outcome":
        if req.outcome is None:
            raise WorkflowError("'outcome' is required (won | lost)", 422)
        tender.status = "WON" if req.outcome == "won" else "LOST"
        # Feed the result back into the org's win-probability training data.
        win = _latest(tender).win or {}
        feats = {k: float(v) for k, v in (win.get("assumptions") or {}).items()}
        if feats:
            feats["price_x_lowest"] = feats["price_ratio"] if feats.pop("lowest_price_award", 0) else 1.0
            for b in ("incumbent", "sector_match"):
                feats[b] = float(feats.get(b, 0))
            db.add(HistoricalBid(org_id=tender.org_id, tender_id=tender.id,
                                 features=feats, won=req.outcome == "won"))
        detail.update(outcome=req.outcome, winning_price=req.winning_price)

    elif action == "withdraw":
        tender.status = "WITHDRAWN"

    audit.record(db, user, "tender", tender.id, action,
                 {**detail, "from": before, "to": tender.status})
    return tender
