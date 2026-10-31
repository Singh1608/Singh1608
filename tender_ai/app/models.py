"""Persistence model.

Every business row carries ``org_id`` so one deployment can serve several
business units or customers without data crossing between them. Queries in
the API layer always filter on the caller's org.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    base_currency: Mapped[str] = mapped_column(String(3), default="USD")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    role: Mapped[str] = mapped_column(String(32))
    api_key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class CompanyProfile(Base):
    """What the bidding company can prove: drives eligibility checks."""

    __tablename__ = "company_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), unique=True)
    annual_turnover: Mapped[float] = mapped_column(Float, default=0)
    net_worth: Mapped[float] = mapped_column(Float, default=0)
    years_in_business: Mapped[int] = mapped_column(Integer, default=0)
    largest_similar_project: Mapped[float] = mapped_column(Float, default=0)
    certifications: Mapped[list[str]] = mapped_column(JSON, default=list)
    sectors: Mapped[list[str]] = mapped_column(JSON, default=list)
    regions: Mapped[list[str]] = mapped_column(JSON, default=list)
    max_concurrent_bids: Mapped[int] = mapped_column(Integer, default=10)
    available_bank_guarantee_limit: Mapped[float] = mapped_column(Float, default=0)


class Tender(Base):
    __tablename__ = "tenders"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    reference: Mapped[str | None] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(500))
    buyer: Mapped[str | None] = mapped_column(String(300))
    sector: Mapped[str | None] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(100))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    estimated_value: Mapped[float | None] = mapped_column(Float)
    submission_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="INTAKE", index=True)
    bid_price: Mapped[float | None] = mapped_column(Float)
    priced_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    # Optimistic locking: concurrent edits to the same tender fail loudly.
    version: Mapped[int] = mapped_column(Integer, default=1)

    analyses: Mapped[list[TenderAnalysis]] = relationship(
        back_populates="tender", order_by="TenderAnalysis.id", cascade="all, delete-orphan"
    )
    approvals: Mapped[list[Approval]] = relationship(
        back_populates="tender", order_by="Approval.id", cascade="all, delete-orphan"
    )

    __mapper_args__ = {"version_id_col": version}


class TenderAnalysis(Base):
    """One immutable analysis run. Re-analysing appends, never overwrites."""

    __tablename__ = "tender_analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    tender_id: Mapped[int] = mapped_column(ForeignKey("tenders.id"), index=True)
    engine: Mapped[str] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(Text)
    extraction: Mapped[dict[str, Any]] = mapped_column(JSON)
    compliance: Mapped[dict[str, Any]] = mapped_column(JSON)
    risk: Mapped[dict[str, Any]] = mapped_column(JSON)
    win: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    forecast: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    recommendation: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    tender: Mapped[Tender] = relationship(back_populates="analyses")


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(primary_key=True)
    tender_id: Mapped[int] = mapped_column(ForeignKey("tenders.id"), index=True)
    role_required: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(String(300))
    decision: Mapped[str] = mapped_column(String(16), default="PENDING")
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    comment: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    tender: Mapped[Tender] = relationship(back_populates="approvals")


class HistoricalBid(Base):
    """Past bid outcomes: the training set for win-probability."""

    __tablename__ = "historical_bids"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    tender_id: Mapped[int | None] = mapped_column(ForeignKey("tenders.id"))
    features: Mapped[dict[str, float]] = mapped_column(JSON)
    won: Mapped[bool] = mapped_column(Boolean)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    """Append-only trail of every state-changing action."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    entity: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
