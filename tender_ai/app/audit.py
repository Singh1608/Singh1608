from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLog, User


def record(
    db: Session, actor: User | None, entity: str, entity_id: int | None, action: str,
    detail: dict[str, Any] | None = None, org_id: int | None = None,
) -> None:
    db.add(AuditLog(
        org_id=org_id if org_id is not None else actor.org_id,
        actor_id=actor.id if actor else None,
        entity=entity, entity_id=entity_id, action=action, detail=detail or {},
    ))
