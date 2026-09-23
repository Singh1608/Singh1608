"""API-key authentication and role checks.

Keys are stored only as SHA-256 hashes. In production this layer would sit
behind the corporate IdP (OIDC/SAML via an API gateway); the ``User`` +
``role`` model is deliberately the same shape an IdP group mapping produces.
"""

from __future__ import annotations

import hashlib
import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import User


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_api_key() -> str:
    return "tai_" + secrets.token_urlsafe(32)


def current_user(
    x_api_key: str | None = Header(default=None), db: Session = Depends(get_db)
) -> User:
    if not x_api_key:
        raise HTTPException(401, "Missing X-API-Key header")
    user = db.scalar(select(User).where(User.api_key_hash == hash_key(x_api_key)))
    if not user or not user.active:
        raise HTTPException(401, "Invalid API key")
    return user


def require_roles(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"Requires role: {', '.join(roles)}")
        return user

    return dep
