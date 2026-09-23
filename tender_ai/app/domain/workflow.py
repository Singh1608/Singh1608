"""Procurement workflow state machine.

    INTAKE ─analyze─▶ ANALYZED ─decide(bid)─▶ PRICING ─submit_for_approval─▶ PENDING_APPROVAL
                         │                        ▲                              │
                         └─decide(no_bid)─▶ NO_BID └──────── any reject ─────────┤
                                                                                 ▼ all approved
                          WON / LOST ◀─record_outcome─ SUBMITTED ◀─mark_submitted─ APPROVED

``withdraw`` is allowed from any non-terminal state.
"""

from __future__ import annotations

ROLES = ("viewer", "analyst", "bid_manager", "finance", "legal", "executive", "admin")

TERMINAL = {"NO_BID", "WON", "LOST", "WITHDRAWN"}
ACTIVE = {"INTAKE", "ANALYZED", "PRICING", "PENDING_APPROVAL", "APPROVED", "SUBMITTED"}

# action -> (allowed from-states, roles allowed to perform it)
TRANSITIONS: dict[str, tuple[set[str], set[str]]] = {
    "analyze": ({"INTAKE", "ANALYZED", "PRICING"}, {"analyst", "bid_manager", "admin"}),
    "decide": ({"ANALYZED"}, {"bid_manager", "executive", "admin"}),
    "submit_for_approval": ({"PRICING"}, {"bid_manager", "admin"}),
    "approve": ({"PENDING_APPROVAL"}, {"bid_manager", "finance", "legal", "executive"}),
    "reject": ({"PENDING_APPROVAL"}, {"bid_manager", "finance", "legal", "executive"}),
    "mark_submitted": ({"APPROVED"}, {"bid_manager", "admin"}),
    "record_outcome": ({"SUBMITTED"}, {"bid_manager", "admin"}),
    "withdraw": (ACTIVE, {"bid_manager", "executive", "admin"}),
}

# Who may bid against a NO_BID hard stop, with a written justification.
HARD_STOP_OVERRIDE_ROLES = {"executive"}


class WorkflowError(Exception):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def check(action: str, state: str, role: str) -> None:
    if action not in TRANSITIONS:
        raise WorkflowError(f"Unknown action '{action}'", 400)
    states, roles = TRANSITIONS[action]
    if state not in states:
        raise WorkflowError(f"Cannot '{action}' a tender in state {state}")
    if role not in roles:
        raise WorkflowError(f"Role '{role}' may not perform '{action}'", 403)


def allowed_actions(state: str, role: str) -> list[str]:
    return [a for a, (states, roles) in TRANSITIONS.items() if state in states and role in roles]
