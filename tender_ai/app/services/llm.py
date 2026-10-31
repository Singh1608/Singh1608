"""Claude-backed tender extraction and summarisation.

Claude is used when credentials are available. If they are missing, or a call
fails or is refused, the caller falls back to the offline heuristic extractor.
A failed AI call therefore never blocks the procurement workflow.
"""

from __future__ import annotations

import logging
import os

from ..config import get_settings
from ..domain.tender import RISK_CATALOGUE, TenderExtraction

log = logging.getLogger(__name__)

SYSTEM_PROMPT = f"""You are a senior bid manager and contracts analyst. You read public and
private tender documents (RFPs, RFQs, ITTs, NITs) and extract the facts a bid/no-bid
committee needs.

Rules:
- Extract only what the document states. Leave a field null when the document is silent;
  never estimate or invent values.
- Money amounts are plain numbers in the tender's currency (expand "2.5 million" to 2500000,
  "3 crore" to 30000000). Put the ISO-4217 code in `currency`.
- Percentages are numbers such as 10 for 10%.
- Dates are ISO-8601 (YYYY-MM-DD).
- `evaluation_method`: LOWEST_PRICE for L1 / lowest-price award, QCBS for any weighted
  quality-and-cost scheme (set `technical_weight_pct`), QUALITY_ONLY for quality-based selection.
- `summary`: 120-200 words for an executive. Cover what is being bought, by whom, value,
  timeline, how it is evaluated, and the commercial terms that matter most.
- `risk_flags`: use these codes where they apply, and quote a short evidence snippet from the text:
{chr(10).join(f"  {code}: {desc}" for code, (desc, _) in RISK_CATALOGUE.items())}
"""


class LLMUnavailable(RuntimeError):
    pass


def _has_credentials() -> bool:
    return any(
        os.environ.get(k)
        for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE")
    )


def is_enabled() -> bool:
    return get_settings().llm_enabled and _has_credentials()


def extract_with_claude(text: str) -> TenderExtraction:
    """Return a structured extraction, or raise ``LLMUnavailable``."""
    if not is_enabled():
        raise LLMUnavailable("LLM disabled or no Anthropic credentials configured")

    import anthropic

    settings = get_settings()
    if len(text) > settings.llm_max_input_chars:
        # Do not silently truncate a contract: missing a penalty clause on
        # page 180 is worse than using the offline extractor on the full text.
        raise LLMUnavailable(
            f"Tender text is {len(text):,} chars, above TENDER_LLM_MAX_CHARS "
            f"({settings.llm_max_input_chars:,})"
        )

    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.parse(
            model=settings.anthropic_model,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{
                "role": "user",
                "content": f"<tender_document>\n{text}\n</tender_document>\n\n"
                           "Extract the tender facts.",
            }],
            output_format=TenderExtraction,
        )
    except anthropic.APIConnectionError as e:
        raise LLMUnavailable(f"Network error calling Claude: {e}") from e
    except anthropic.RateLimitError as e:
        raise LLMUnavailable("Claude rate limit reached") from e
    except anthropic.APIStatusError as e:
        raise LLMUnavailable(f"Claude API error {e.status_code}: {e.message}") from e

    if response.stop_reason == "refusal":
        raise LLMUnavailable("Claude declined the request")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise LLMUnavailable(f"Claude returned no usable output (stop_reason={response.stop_reason})")
    log.info("claude extraction ok request_id=%s model=%s", response._request_id, response.model)
    return response.parsed_output
