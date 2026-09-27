"""
AI postmortem generator.
Produces structured postmortem draft from incident data.
Graceful fallback when OpenAI key absent.
"""
from app.config import settings
from app.models import Postmortem, Incident


async def generate_postmortem(pm: Postmortem, incident: Incident):
    """Populate postmortem fields from incident. Uses AI if key set."""

    if settings.OPENAI_API_KEY:
        await _ai_generate(pm, incident)
    else:
        _template_generate(pm, incident)


def _template_generate(pm: Postmortem, incident: Incident):
    """Rule-based template postmortem — no AI needed."""
    svc = ", ".join(incident.affected_services or ["unknown service"])
    patterns = ", ".join(incident.error_patterns or ["unknown"])

    pm.summary = (
        f"On {incident.detected_at.strftime('%Y-%m-%d') if incident.detected_at else 'unknown date'}, "
        f"an incident of {incident.severity.value} severity was detected affecting {svc}. "
        f"Detected error patterns: {patterns}."
    )
    pm.impact = f"Service(s) affected: {svc}. Users may have experienced degraded or unavailable service."
    pm.timeline = [
        {"time": incident.detected_at.isoformat() if incident.detected_at else "T+0", "event": "Incident detected via log ingestion", "actor": "OnboardOps"},
        {"time": "T+N", "event": "Investigation started", "actor": "On-call engineer"},
        {"time": "T+N", "event": "Root cause identified", "actor": "On-call engineer"},
        {"time": incident.resolved_at.isoformat() if incident.resolved_at else "T+N", "event": "Incident resolved", "actor": "On-call engineer"},
    ]
    pm.root_cause = f"[To be filled] Likely related to: {patterns}"
    pm.contributing_factors = ["[To be filled]"]
    pm.resolution = "[To be filled] Describe the fix applied."
    pm.action_items = [
        {"id": "AI-001", "title": "Add alerting for this error pattern", "owner": "TBD", "due_date": "TBD", "status": "open"},
        {"id": "AI-002", "title": "Write runbook for this incident type", "owner": "TBD", "due_date": "TBD", "status": "open"},
        {"id": "AI-003", "title": "Add test coverage for failure scenario", "owner": "TBD", "due_date": "TBD", "status": "open"},
    ]
    pm.lessons_learned = "[To be filled] What did we learn? What would have caught this sooner?"


async def _ai_generate(pm: Postmortem, incident: Incident):
    from openai import AsyncOpenAI
    import json

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    context = f"""
Incident: {incident.title}
Severity: {incident.severity.value}
Affected services: {", ".join(incident.affected_services or [])}
Error patterns: {", ".join(incident.error_patterns or [])}
AI triage summary: {incident.ai_triage_summary or "N/A"}
Raw logs (excerpt):
{(incident.raw_logs or "")[:2000]}
"""

    prompt = f"""You are a senior SRE writing a blameless postmortem.
Generate a JSON postmortem with these exact keys:
- summary (string)
- impact (string)
- timeline (array of {{time, event, actor}})
- root_cause (string)
- contributing_factors (array of strings)
- resolution (string)
- action_items (array of {{id, title, owner, due_date, status}})
- lessons_learned (string)

Context:
{context}

Return ONLY valid JSON.
"""

    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1500,
        temperature=0.3,
        response_format={"type": "json_object"},
    )

    data = json.loads(response.choices[0].message.content or "{}")

    pm.summary = data.get("summary", "")
    pm.impact = data.get("impact", "")
    pm.timeline = data.get("timeline", [])
    pm.root_cause = data.get("root_cause", "")
    pm.contributing_factors = data.get("contributing_factors", [])
    pm.resolution = data.get("resolution", "")
    pm.action_items = data.get("action_items", [])
    pm.lessons_learned = data.get("lessons_learned", "")
