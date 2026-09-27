import re
import json
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models import Incident, LogEntry, IncidentSeverity, IncidentStatus
from app.services.triage import auto_triage

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────

class LogLineIn(BaseModel):
    service: str
    level: str
    message: str
    timestamp: datetime
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    attributes: dict = {}
    raw_line: Optional[str] = None


class BulkLogIngestionRequest(BaseModel):
    logs: List[LogLineIn]
    source: str = "manual"           # manual | alertmanager | fluentd | vector
    create_incident: bool = True
    incident_title: Optional[str] = None


class AlertmanagerWebhookPayload(BaseModel):
    """Prometheus Alertmanager webhook format."""
    version: str = "4"
    groupKey: str = ""
    status: str                       # firing | resolved
    alerts: List[dict]
    commonLabels: dict = {}
    commonAnnotations: dict = {}


# ── Helpers ───────────────────────────────────────────────────────────────

SEVERITY_PATTERNS = {
    IncidentSeverity.critical: [r"CRITICAL", r"FATAL", r"panic", r"OOM", r"killed"],
    IncidentSeverity.high:     [r"ERROR", r"exception", r"timeout", r"deadlock"],
    IncidentSeverity.medium:   [r"WARN", r"warning", r"deprecated", r"retry"],
    IncidentSeverity.low:      [r"INFO", r"notice"],
}

def infer_severity(logs: List[LogLineIn]) -> IncidentSeverity:
    text = " ".join(l.message for l in logs)
    for sev, patterns in SEVERITY_PATTERNS.items():
        if any(re.search(p, text, re.IGNORECASE) for p in patterns):
            return sev
    return IncidentSeverity.low


def extract_affected_services(logs: List[LogLineIn]) -> List[str]:
    return list({l.service for l in logs})


# ── POST /api/ingest/logs ─────────────────────────────────────────────────

@router.post("/logs", status_code=202)
async def ingest_logs(
    payload: BulkLogIngestionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Ingest log lines and optionally create an incident."""
    severity = infer_severity(payload.logs)
    affected = extract_affected_services(payload.logs)

    incident = None
    if payload.create_incident:
        title = payload.incident_title or f"Incident from {payload.source} — {severity.value} severity"
        incident = Incident(
            title=title,
            severity=severity,
            affected_services=affected,
            raw_logs="\n".join(l.raw_line or l.message for l in payload.logs),
        )
        db.add(incident)
        await db.flush()  # get ID before inserting entries

    entries = []
    for log in payload.logs:
        entry = LogEntry(
            incident_id=incident.id if incident else None,
            service=log.service,
            level=log.level,
            message=log.message,
            timestamp=log.timestamp,
            trace_id=log.trace_id,
            span_id=log.span_id,
            attributes=log.attributes,
            raw_line=log.raw_line,
        )
        db.add(entry)
        entries.append(entry)

    # AI triage (async, non-blocking for speed)
    if incident:
        await auto_triage(incident, payload.logs, db)

    await db.commit()

    return {
        "incident_id": str(incident.id) if incident else None,
        "entries_ingested": len(entries),
        "severity": severity,
        "affected_services": affected,
    }


# ── POST /api/ingest/alertmanager ─────────────────────────────────────────

@router.post("/alertmanager", status_code=202)
async def ingest_alertmanager(
    payload: AlertmanagerWebhookPayload,
    db: AsyncSession = Depends(get_db),
):
    """Receive Prometheus Alertmanager webhooks."""
    for alert in payload.alerts:
        if payload.status == "resolved":
            continue  # Could auto-close here

        title = alert.get("annotations", {}).get("summary", alert.get("labels", {}).get("alertname", "Alert"))
        description = alert.get("annotations", {}).get("description")
        labels = alert.get("labels", {})

        # Map alert severity label -> our severity
        alert_sev = labels.get("severity", "medium").lower()
        sev_map = {"critical": IncidentSeverity.critical, "warning": IncidentSeverity.high, "info": IncidentSeverity.low}
        severity = sev_map.get(alert_sev, IncidentSeverity.medium)

        incident = Incident(
            title=f"[Alert] {title}",
            description=description,
            severity=severity,
            affected_services=[labels.get("service", "unknown")],
            tags=list(labels.keys()),
        )
        db.add(incident)

    await db.commit()
    return {"status": "accepted", "alert_count": len(payload.alerts)}
