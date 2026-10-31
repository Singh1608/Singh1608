"""Profit forecasting and price optimisation.

The P&L of a won contract is simulated with Monte Carlo. Cost overrun and
delay penalties are uncertain, so the output is a distribution (P10/P50/P90,
probability of loss) rather than a single number. The price optimiser then
sweeps candidate prices. For each one it combines the win probability at that
price with the expected profit if won, and picks the price with the highest
risk-adjusted expected value.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass

import numpy as np


@dataclass
class PricingInputs:
    direct_cost: float                       # materials + labour + subcontract, base case
    bid_price: float | None = None           # None -> use the recommended price
    overhead_pct: float = 0.08
    contingency_pct: float | None = None     # None -> derived from risk score
    contract_months: float = 12.0
    payment_terms_days: int = 45
    advance_payment_pct: float = 0.0
    retention_pct: float = 0.0
    performance_guarantee_pct: float = 0.0
    bid_security: float = 0.0
    ld_cap_pct: float = 5.0
    cost_of_capital: float = 0.11
    bg_commission: float = 0.015
    bid_preparation_cost: float = 0.0
    tax_rate: float = 0.0
    risk_score: float = 30.0                 # 0-100, drives overrun + delay assumptions
    runs: int = 5000
    seed: int = 42


def _cost_base(p: PricingInputs) -> float:
    contingency = p.contingency_pct if p.contingency_pct is not None else 0.03 + p.risk_score / 1000
    return p.direct_cost * (1 + p.overhead_pct + contingency)


def simulate(p: PricingInputs, price: float) -> dict:
    rng = np.random.default_rng(p.seed)
    n = p.runs
    r = p.risk_score / 100

    # Cost overrun: triangular, the right tail widens with contract risk.
    overrun = rng.triangular(-0.05, 0.02 + 0.05 * r, 0.10 + 0.35 * r, n)
    direct = p.direct_cost * (1 + overrun)
    overhead = p.direct_cost * p.overhead_pct

    # Delay penalties: Bernoulli delay event, severity uniform up to the LD cap.
    p_delay = min(0.05 + 0.5 * r, 0.8)
    delayed = rng.random(n) < p_delay
    ld = delayed * rng.uniform(0.1, 1.0, n) * (p.ld_cap_pct / 100) * price

    years = p.contract_months / 12
    # Working capital: spend runs ahead of cash by the payment term; an advance offsets it.
    wc = direct * (p.payment_terms_days / 365) * (1 - p.advance_payment_pct / 100) * p.cost_of_capital
    # Retention is released after a 12-month defect-liability period.
    retention = price * p.retention_pct / 100 * p.cost_of_capital * (years / 2 + 1)
    guarantees = p.bg_commission * (
        p.bid_security * 0.25 + price * p.performance_guarantee_pct / 100 * (years + 1)
    )

    ebit = price - direct - overhead - ld - wc - retention - guarantees
    net = ebit - np.maximum(ebit, 0) * p.tax_rate

    pct = lambda q: float(np.percentile(net, q))  # noqa: E731
    mean_cost = {
        "direct_cost": float(direct.mean()),
        "overhead": overhead,
        "liquidated_damages": float(ld.mean()),
        "working_capital_financing": float(wc.mean()),
        "retention_financing": retention,
        "guarantee_commissions": guarantees,
        "tax": float((np.maximum(ebit, 0) * p.tax_rate).mean()),
    }
    return {
        "price": round(price, 2),
        "expected_profit": round(float(net.mean()), 2),
        "expected_margin_pct": round(float(net.mean()) / price * 100, 2) if price else 0.0,
        "p10": round(pct(10), 2),
        "p50": round(pct(50), 2),
        "p90": round(pct(90), 2),
        "probability_of_loss": round(float((net < 0).mean()), 4),
        "probability_of_delay": round(p_delay, 3),
        "cost_breakdown": {k: round(v, 2) for k, v in mean_cost.items()},
    }


def optimise_price(
    p: PricingInputs,
    win_prob_at: Callable[[float], float],
    max_loss_probability: float,
    estimated_value: float | None,
) -> dict:
    """Sweep markups on the cost base and pick the best expected value."""
    base = _cost_base(p)
    curve = []
    for markup in np.arange(-0.05, 0.401, 0.01):
        price = float(base * (1 + markup))
        sim = simulate(PricingInputs(**{**asdict(p), "runs": min(p.runs, 1500)}), price)
        pw = win_prob_at(price)
        ev = pw * sim["expected_profit"] - p.bid_preparation_cost
        curve.append({
            "markup_pct": round(float(markup) * 100, 1),
            "price": round(price, 2),
            "price_ratio": round(price / estimated_value, 3) if estimated_value else None,
            "win_probability": round(pw, 4),
            "expected_profit_if_won": sim["expected_profit"],
            "probability_of_loss": sim["probability_of_loss"],
            "expected_value": round(ev, 2),
        })
    admissible = [c for c in curve if c["probability_of_loss"] <= max_loss_probability] or curve
    best = max(admissible, key=lambda c: c["expected_value"])
    unconstrained = max(curve, key=lambda c: c["expected_value"])
    return {"cost_base": round(base, 2), "recommended": best, "curve": curve,
            "constrained_by_loss_limit": bool(unconstrained["price"] != best["price"])}


def forecast(
    p: PricingInputs,
    win_prob_at: Callable[[float], float],
    max_loss_probability: float,
    estimated_value: float | None,
) -> dict:
    opt = optimise_price(p, win_prob_at, max_loss_probability, estimated_value)
    price = p.bid_price or opt["recommended"]["price"]
    sim = simulate(p, price)
    pw = win_prob_at(price)
    return {
        "inputs": asdict(p),
        "evaluated_price": sim,
        "win_probability_at_price": round(pw, 4),
        "risk_adjusted_expected_value": round(pw * sim["expected_profit"] - p.bid_preparation_cost, 2),
        "price_optimisation": opt,
    }
