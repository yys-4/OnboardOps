"""
Fix Hub router.

POST /api/fix-hub/analyze
  → Runs the full 5-phase autonomous fix pipeline on a submitted incident.
  → Returns structured result: parsed trace, suspect files, test case, patch, postmortem.

POST /api/fix-hub/analyze/fixture/{fixture_id}
  → Runs the pipeline on one of 3 built-in incident fixtures (demo mode).

GET /api/fix-hub/fixtures
  → Lists available fixture scenarios.
"""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Incident, Postmortem, IncidentSeverity, IncidentStatus, PostmortemStatus
from app.services.fix_pipeline import (
    run_fix_pipeline,
    FixPipelineResult,
    PipelinePhase,
)
from dataclasses import asdict

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────

class FixHubRequest(BaseModel):
    incident_id: Optional[str] = None       # link to existing incident record
    title: str
    severity: str = "high"
    stack_trace: str
    log_lines: list[str] = []
    detected_at: Optional[str] = None
    persist_postmortem: bool = True          # auto-save postmortem to DB


# ── Built-in fixtures (mirrors TypeScript incident-fixtures.ts) ───────────

FIXTURE_REGISTRY = {
    "race_condition": {
        "id": "inc-race-001",
        "title": "Race condition: stock oversell on concurrent order creation",
        "severity": "critical",
        "stack_trace": """Error: Stock went negative — oversell detected
    at validateStockIntegrity (/app/src/routes/orders.ts:89)
    at stockIntegrityCheck (/app/src/db/client.ts:41)
    at processTicksAndRejections (node:internal/process/task_queues:95)

Additional context:
  product_id: "prod-abc-123"
  expected_min_stock: 0
  actual_stock: -1
  concurrent_requests: 2
  trace_id: "abc123def456"
""",
        "log_lines": [
            '{"level":"info","msg":"POST /api/orders user=u1 product=prod-abc-123 qty=1 stock_before=1"}',
            '{"level":"info","msg":"POST /api/orders user=u2 product=prod-abc-123 qty=1 stock_before=1"}',
            '{"level":"info","msg":"Stock check passed user=u1 stock=1 required=1"}',
            '{"level":"info","msg":"Stock check passed user=u2 stock=1 required=1"}',
            '{"level":"error","msg":"Stock went negative — oversell detected product=prod-abc-123 stock=-1"}',
        ],
    },
    "null_pointer": {
        "id": "inc-null-002",
        "title": "TypeError: Cannot read properties of null (reading 'notify')",
        "severity": "high",
        "stack_trace": """TypeError: Cannot read properties of null (reading 'notify')
    at /app/src/routes/orders.ts:142
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95)
    at next (/app/node_modules/express/lib/router/route.js:137)
    at Route.dispatch (/app/node_modules/express/lib/router/route.js:112)

Frame locals:
  order.id = "ord-xyz-789"
  order.metadata = null
  status = "shipped"
  req.user.role = "developer"
""",
        "log_lines": [
            '{"level":"info","msg":"PATCH /api/orders/ord-xyz-789/status user=dev-user-1 role=developer"}',
            '{"level":"error","msg":"TypeError: Cannot read properties of null (reading \'notify\') path=/api/orders/ord-xyz-789/status"}',
        ],
    },
    "payment_timeout": {
        "id": "inc-pay-003",
        "title": "Payment gateway timeout causing DB pool exhaustion cascade",
        "severity": "critical",
        "stack_trace": """Error: Payment gateway timeout after 30000ms
    at Timeout._onTimeout (/app/src/services/payment.ts:38)
    at listOnTimeout (node:internal/timers:559)
    at processTimers (node:internal/timers:500)

Caused by pool exhaustion:
Error: Knex: Timeout acquiring a connection. The pool is probably full.
    at /app/node_modules/knex/lib/client.js:376

Context:
  payment_method: "bank_transfer"
  timeout_ms: undefined
  pool_used: 10/10
  waiting_requests: 47
""",
        "log_lines": [
            '{"level":"info","msg":"POST /api/orders payment_method=bank_transfer"}',
            '{"level":"warn","msg":"Payment gateway no response after 10000ms"}',
            '{"level":"error","msg":"Payment gateway timeout after 30000ms"}',
            '{"level":"error","msg":"Knex: Timeout acquiring a connection. pool_used=10/10 waiting=47"}',
        ],
    },
}


# ── Helpers ───────────────────────────────────────────────────────────────

def _result_to_dict(result: FixPipelineResult) -> dict:
    """Convert FixPipelineResult dataclass to JSON-serialisable dict."""
    d = asdict(result)
    # Convert enum values to strings
    if "phase_completed" in d:
        d["phase_completed"] = result.phase_completed.value
    return d


async def _persist_postmortem(
    result: FixPipelineResult,
    db: AsyncSession,
    incident_id_str: Optional[str],
) -> Optional[str]:
    """If pipeline produced a postmortem and an incident_id, save to DB."""
    if not result.postmortem or not incident_id_str:
        return None

    import uuid
    try:
        inc_uuid = uuid.UUID(incident_id_str)
    except ValueError:
        return None

    incident = await db.get(Incident, inc_uuid)
    if not incident:
        return None

    pm = Postmortem(
        incident_id=inc_uuid,
        title=result.postmortem.title,
        status=PostmortemStatus.draft,
        summary=result.postmortem.summary,
        impact=result.postmortem.impact,
        timeline=result.postmortem.timeline,
        root_cause=result.postmortem.root_cause,
        contributing_factors=result.postmortem.contributing_factors,
        resolution=result.postmortem.resolution,
        action_items=result.postmortem.action_items,
        lessons_learned=result.postmortem.lessons_learned,
        ai_generated=result.postmortem.ai_generated,
    )
    db.add(pm)
    await db.commit()
    await db.refresh(pm)
    return str(pm.id)


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("/fixtures")
async def list_fixtures():
    """List available built-in incident fixtures for demo mode."""
    return {
        "data": [
            {
                "id": v["id"],
                "fixture_key": k,
                "title": v["title"],
                "severity": v["severity"],
            }
            for k, v in FIXTURE_REGISTRY.items()
        ]
    }


@router.post("/analyze")
async def analyze_incident(
    body: FixHubRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Run full 5-phase autonomous fix pipeline on submitted incident data.

    Phases:
      1. parse       — parse stack trace into structured frames
      2. locate      — identify suspect files and error type
      3. generate_test — produce failing test case specification
      4. patch       — propose minimal correct code patch
      5. postmortem  — generate structured SRE postmortem with RCA
    """
    result = await run_fix_pipeline(
        incident_id=body.incident_id or "adhoc",
        title=body.title,
        severity=body.severity,
        stack_trace_raw=body.stack_trace,
        log_lines=body.log_lines,
        detected_at=body.detected_at,
    )

    postmortem_id: Optional[str] = None
    if body.persist_postmortem and result.phase_completed == PipelinePhase.complete:
        postmortem_id = await _persist_postmortem(result, db, body.incident_id)

    return {
        "data": _result_to_dict(result),
        "postmortem_id": postmortem_id,
    }


@router.post("/analyze/fixture/{fixture_key}")
async def analyze_fixture(
    fixture_key: str,
    db: AsyncSession = Depends(get_db),
    persist: bool = True,
):
    """
    Run the fix pipeline on a built-in incident fixture.
    fixture_key: race_condition | null_pointer | payment_timeout
    """
    fixture = FIXTURE_REGISTRY.get(fixture_key)
    if not fixture:
        raise HTTPException(
            404,
            f"Fixture '{fixture_key}' not found. "
            f"Available: {list(FIXTURE_REGISTRY.keys())}",
        )

    # Create a real Incident record for this fixture so postmortem can be linked
    sev_map = {
        "critical": IncidentSeverity.critical,
        "high": IncidentSeverity.high,
        "medium": IncidentSeverity.medium,
        "low": IncidentSeverity.low,
    }
    incident = Incident(
        title=fixture["title"],
        severity=sev_map.get(fixture["severity"], IncidentSeverity.high),
        status=IncidentStatus.investigating,
        affected_services=["backend"],
        raw_logs="\n".join(fixture["log_lines"]),
    )
    db.add(incident)
    await db.flush()

    result = await run_fix_pipeline(
        incident_id=str(incident.id),
        title=fixture["title"],
        severity=fixture["severity"],
        stack_trace_raw=fixture["stack_trace"],
        log_lines=fixture["log_lines"],
    )

    # Update incident with AI triage data
    if result.stack_trace_result:
        incident.error_patterns = result.stack_trace_result.detected_patterns
        if result.postmortem:
            incident.ai_triage_summary = result.postmortem.summary

    postmortem_id: Optional[str] = None
    if persist and result.phase_completed == PipelinePhase.complete:
        postmortem_id = await _persist_postmortem(result, db, str(incident.id))

    await db.commit()

    return {
        "data": _result_to_dict(result),
        "incident_id": str(incident.id),
        "postmortem_id": postmortem_id,
    }
