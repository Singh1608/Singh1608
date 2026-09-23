"""Runtime configuration, read once from environment variables.

Every business threshold that a bid committee might want to tune lives here
rather than in code, so changing policy is a config change and not a release.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass(frozen=True)
class Settings:
    app_name: str = "Tender AI"
    environment: str = field(default_factory=lambda: _env("TENDER_ENV", "dev"))
    database_url: str = field(
        default_factory=lambda: _env("TENDER_DATABASE_URL", "sqlite:///./tender_ai.db")
    )

    # AI engine. With no key the platform runs fully on the offline extractor.
    anthropic_model: str = field(default_factory=lambda: _env("TENDER_LLM_MODEL", "claude-opus-5"))
    llm_enabled: bool = field(
        default_factory=lambda: _env("TENDER_LLM_ENABLED", "auto") != "off"
    )
    llm_max_input_chars: int = field(default_factory=lambda: _int("TENDER_LLM_MAX_CHARS", 400_000))

    # Bootstrap admin key; only honoured when the users table is empty.
    bootstrap_admin_key: str = field(
        default_factory=lambda: _env("TENDER_BOOTSTRAP_ADMIN_KEY", "")
    )

    # --- Finance defaults (overridable per tender in the pricing request) ---
    cost_of_capital: float = field(default_factory=lambda: _float("TENDER_COST_OF_CAPITAL", 0.11))
    bank_guarantee_commission: float = field(
        default_factory=lambda: _float("TENDER_BG_COMMISSION", 0.015)
    )
    corporate_overhead_pct: float = field(default_factory=lambda: _float("TENDER_OVERHEAD_PCT", 0.08))
    monte_carlo_runs: int = field(default_factory=lambda: _int("TENDER_MC_RUNS", 5000))

    # --- Bid / no-bid policy ---
    min_win_probability: float = field(default_factory=lambda: _float("TENDER_MIN_WIN_PROB", 0.20))
    min_expected_margin: float = field(default_factory=lambda: _float("TENDER_MIN_MARGIN", 0.06))
    max_risk_score: float = field(default_factory=lambda: _float("TENDER_MAX_RISK", 70.0))
    max_loss_probability: float = field(default_factory=lambda: _float("TENDER_MAX_LOSS_PROB", 0.25))
    min_days_to_prepare: int = field(default_factory=lambda: _int("TENDER_MIN_PREP_DAYS", 7))

    # --- Delegation of authority (contract value in base currency) ---
    doa_finance_threshold: float = field(
        default_factory=lambda: _float("TENDER_DOA_FINANCE", 1_000_000)
    )
    doa_executive_threshold: float = field(
        default_factory=lambda: _float("TENDER_DOA_EXECUTIVE", 10_000_000)
    )
    legal_review_risk_threshold: float = field(
        default_factory=lambda: _float("TENDER_LEGAL_RISK", 50.0)
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
