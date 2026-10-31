"""Win-probability model.

A regularised logistic regression over bid features. Organisations with
enough recorded outcomes get a model trained on their own history. Until they
have that, the model is trained on a seeded synthetic "industry prior" whose
data-generating process is written out in ``_prior_logit``. That keeps
cold-start predictions sensible and fully reproducible.

Every prediction returns per-feature contributions (coefficient x
standardised value) so a bid committee can see *why* a number is high or low.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from threading import Lock

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

FEATURES = [
    "price_ratio",          # our bid price / buyer's estimated value
    "price_x_lowest",       # price_ratio when award is lowest-price, else 1.0
    "technical_score",      # expected technical score, 0-1
    "competitors",          # expected number of competing bidders
    "incumbent",            # 1 if we hold the current contract
    "buyer_relationship",   # share of past bids with this buyer we won, 0-1
    "sector_match",         # 1 if tender sector is a core sector
    "eligibility_margin",   # weakest headroom over qualification thresholds
    "risk_score",           # contractual risk, 0-1
]
LABELS = {
    "price_ratio": "Price vs. estimate",
    "price_x_lowest": "Price under lowest-price award",
    "technical_score": "Technical score",
    "competitors": "Competition intensity",
    "incumbent": "Incumbency",
    "buyer_relationship": "Buyer relationship",
    "sector_match": "Sector fit",
    "eligibility_margin": "Qualification headroom",
    "risk_score": "Contract risk",
}
MIN_ORG_SAMPLES = 40


@dataclass
class BidContext:
    price_ratio: float = 1.0
    lowest_price_award: bool = False
    technical_score: float = 0.7
    competitors: int = 5
    incumbent: bool = False
    buyer_relationship: float = 0.0
    sector_match: bool = True
    eligibility_margin: float = 1.5
    risk_score: float = 0.3

    def vector(self) -> dict[str, float]:
        return {
            "price_ratio": self.price_ratio,
            "price_x_lowest": self.price_ratio if self.lowest_price_award else 1.0,
            "technical_score": self.technical_score,
            "competitors": float(self.competitors),
            "incumbent": 1.0 if self.incumbent else 0.0,
            "buyer_relationship": self.buyer_relationship,
            "sector_match": 1.0 if self.sector_match else 0.0,
            "eligibility_margin": self.eligibility_margin,
            "risk_score": self.risk_score,
        }


def _prior_logit(f: dict[str, float]) -> float:
    return (
        1.2
        - 9.0 * (f["price_ratio"] - 1.0)
        - 12.0 * (f["price_x_lowest"] - 1.0)
        + 3.0 * (f["technical_score"] - 0.7)
        - 1.6 * math.log(max(f["competitors"], 1.0))
        + 1.1 * f["incumbent"]
        + 1.4 * f["buyer_relationship"]
        + 0.5 * f["sector_match"]
        + 0.35 * min(f["eligibility_margin"], 3.0)
        - 0.8 * f["risk_score"]
    )


def synthetic_history(n: int = 1500, seed: int = 7) -> list[tuple[dict[str, float], bool]]:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        lowest = rng.random() < 0.45
        ctx = BidContext(
            price_ratio=float(rng.normal(0.97, 0.08)),
            lowest_price_award=bool(lowest),
            technical_score=float(np.clip(rng.normal(0.72, 0.12), 0.3, 1.0)),
            competitors=int(rng.integers(1, 13)),
            incumbent=bool(rng.random() < 0.15),
            buyer_relationship=float(np.clip(rng.beta(1.5, 4), 0, 1)),
            sector_match=bool(rng.random() < 0.8),
            eligibility_margin=float(np.clip(rng.lognormal(0.3, 0.4), 0.8, 3.0)),
            risk_score=float(np.clip(rng.beta(2, 4), 0, 1)),
        )
        f = ctx.vector()
        p = 1 / (1 + math.exp(-_prior_logit(f)))
        rows.append((f, bool(rng.random() < p)))
    return rows


@dataclass
class TrainedModel:
    version: str
    source: str
    n_samples: int
    base_rate: float
    scaler: StandardScaler
    clf: LogisticRegression

    def predict(self, ctx: BidContext) -> dict:
        f = ctx.vector()
        x = np.array([[f[k] for k in FEATURES]])
        xs = self.scaler.transform(x)
        p = float(self.clf.predict_proba(xs)[0, 1])
        contrib = self.clf.coef_[0] * xs[0]
        drivers = sorted(
            ({"feature": k, "label": LABELS[k], "value": round(f[k], 3),
              "impact": round(float(c), 3)} for k, c in zip(FEATURES, contrib)),
            key=lambda d: -abs(d["impact"]),
        )
        return {
            "probability": round(p, 4),
            "band": "HIGH" if p >= 0.5 else "MEDIUM" if p >= 0.25 else "LOW",
            "model_version": self.version,
            "model_source": self.source,
            "training_samples": self.n_samples,
            "base_rate": round(self.base_rate, 3),
            "drivers": drivers,
        }


def train(rows: list[tuple[dict[str, float], bool]], source: str) -> TrainedModel:
    x = np.array([[r[0].get(k, 0.0) for k in FEATURES] for r in rows])
    y = np.array([1 if r[1] else 0 for r in rows])
    scaler = StandardScaler().fit(x)
    clf = LogisticRegression(C=1.0, max_iter=1000).fit(scaler.transform(x), y)
    digest = hashlib.sha256(json.dumps([[sorted(r[0].items()), r[1]] for r in rows]).encode()).hexdigest()[:10]
    return TrainedModel(
        version=f"{source}-{len(rows)}-{digest}", source=source, n_samples=len(rows),
        base_rate=float(y.mean()), scaler=scaler, clf=clf,
    )


_cache: dict[str, TrainedModel] = {}
_lock = Lock()


def model_for(org_history: list[tuple[dict[str, float], bool]]) -> TrainedModel:
    """Org-specific model when history is sufficient and has both outcomes."""
    usable = len(org_history) >= MIN_ORG_SAMPLES and len({won for _, won in org_history}) == 2
    key = "prior" if not usable else hashlib.sha256(
        json.dumps([[sorted(f.items()), w] for f, w in org_history]).encode()
    ).hexdigest()
    with _lock:
        if key not in _cache:
            if len(_cache) >= 32:  # each new outcome yields a new model; drop the oldest
                _cache.pop(next(k for k in _cache if k != "prior"), None)
            _cache[key] = (
                train(org_history, "org_history") if usable
                else train(synthetic_history(), "industry_prior")
            )
        return _cache[key]
