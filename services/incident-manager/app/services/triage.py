"""
AI-powered incident triage.
Classifies severity, extracts error patterns, generates summary.
Falls back gracefully if OpenAI key not set.
"""
import re
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Incident


ERROR_PATTERNS = {
    "oom":            r"out of memory|OOMKilled|killed process|Cannot allocate memory",
    "n_plus_one":     r"N\+1|n\+1 query|executed \d{2,} queries",
    "timeout":        r"timeout|timed out|ETIMEDOUT|context deadline exceeded",
    "deadlock":       r"deadlock|lock timeout|lock wait timeout",
    "connection_pool":r"connection pool|too many connections|ECONNREFUSED|ECONNRESET",
    "unhandled_exception": r"UnhandledPromiseRejection|Unhandled exception|panic:|FATAL",
    "slow_query":     r"slow query|query took \d+ ms|pg_sleep|long running",
    "memory_leak":    r"memory leak|heap size growing|V8 heap|RSS growing",
    "rate_limit":     r"rate limit|429|too many requests",
    "auth_failure":   r"401|403|unauthorized|forbidden|invalid token|JWT",
}


def detect_patterns(text: str) -> List[str]:
    found = []
    for name, pattern in ERROR_PATTERNS.items():
        if re.search(pattern, text, re.IGNORECASE):
            found.append(name)
    return found


async def auto_triage(incident: Incident, logs, db: AsyncSession):
    """Run pattern detection + optional AI summary on incident."""
    log_text = "\n".join(l.message for l in logs)

    # Pattern detection (always runs, no API key needed)
    patterns = detect_patterns(log_text)
    incident.error_patterns = patterns

    # AI summary (only if key configured)
    if settings.FIREWORKS_API_KEY or settings.OPENAI_API_KEY:
        try:
            incident.ai_triage_summary = await _ai_summary(log_text, patterns, incident)
        except Exception as e:
            incident.ai_triage_summary = f"[AI triage failed: {e}]"
    else:
        # Rule-based fallback summary
        svc_list = ", ".join(incident.affected_services or ["unknown"])
        pattern_list = ", ".join(patterns) if patterns else "no specific patterns detected"
        incident.ai_triage_summary = (
            f"Incident affects: {svc_list}. "
            f"Detected patterns: {pattern_list}. "
            f"Severity: {incident.severity.value}. "
            f"Log lines ingested: {len(logs)}."
        )


async def _ai_summary(log_text: str, patterns: List[str], incident: Incident) -> str:
    from openai import AsyncOpenAI

    if settings.FIREWORKS_API_KEY:
        client = AsyncOpenAI(
            api_key=settings.FIREWORKS_API_KEY,
            base_url=settings.FIREWORKS_BASE_URL,
        )
        model = settings.FIREWORKS_MODEL
    else:
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        model = settings.OPENAI_MODEL

    prompt = f"""You are an SRE triaging a production incident.

Incident title: {incident.title}
Severity: {incident.severity.value}
Affected services: {", ".join(incident.affected_services or [])}
Detected error patterns: {", ".join(patterns) if patterns else "none"}

Recent logs (last 50 lines):
{log_text[:3000]}

Provide a concise triage summary (3-5 sentences) covering:
1. What is likely broken
2. Probable root cause
3. Immediate recommended action
"""

    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=400,
        temperature=0.2,
    )
    return response.choices[0].message.content or ""
