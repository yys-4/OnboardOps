from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import uuid

from app.db.session import get_db
from app.models import Incident, IncidentSeverity, IncidentStatus

router = APIRouter()


class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[IncidentStatus] = None
    severity: Optional[IncidentSeverity] = None
    assigned_to: Optional[str] = None
    tags: Optional[List[str]] = None


# ── GET /api/incidents ────────────────────────────────────────────────────

@router.get("/")
async def list_incidents(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[IncidentStatus] = None,
    severity: Optional[IncidentSeverity] = None,
    db: AsyncSession = Depends(get_db),
):
    offset = (page - 1) * limit
    query = select(Incident).order_by(Incident.detected_at.desc())

    if status:
        query = query.where(Incident.status == status)
    if severity:
        query = query.where(Incident.severity == severity)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()
    result = (await db.execute(query.offset(offset).limit(limit))).scalars().all()

    return {
        "data": [_incident_dict(i) for i in result],
        "pagination": {"page": page, "limit": limit, "total": total, "total_pages": -(-total // limit)},
    }


# ── GET /api/incidents/:id ────────────────────────────────────────────────

@router.get("/{incident_id}")
async def get_incident(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    return {"data": _incident_dict(incident)}


# ── PATCH /api/incidents/:id ──────────────────────────────────────────────

@router.patch("/{incident_id}")
async def update_incident(
    incident_id: uuid.UUID,
    body: IncidentUpdate,
    db: AsyncSession = Depends(get_db),
):
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(incident, field, value)

    if body.status == IncidentStatus.resolved and not incident.resolved_at:
        from datetime import datetime
        incident.resolved_at = datetime.utcnow()

    await db.commit()
    await db.refresh(incident)
    return {"data": _incident_dict(incident)}


# ── DELETE /api/incidents/:id ─────────────────────────────────────────────

@router.delete("/{incident_id}", status_code=204)
async def delete_incident(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    await db.delete(incident)
    await db.commit()


# ── GET /api/incidents/stats ──────────────────────────────────────────────

@router.get("/stats/summary")
async def incident_stats(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import case
    result = await db.execute(
        select(
            func.count().label("total"),
            func.count(case((Incident.status == IncidentStatus.open, 1))).label("open"),
            func.count(case((Incident.status == IncidentStatus.resolved, 1))).label("resolved"),
            func.count(case((Incident.severity == IncidentSeverity.critical, 1))).label("critical"),
        )
    )
    row = result.one()
    return {"data": {"total": row.total, "open": row.open, "resolved": row.resolved, "critical": row.critical}}


def _incident_dict(i: Incident) -> dict:
    return {
        "id": str(i.id),
        "title": i.title,
        "description": i.description,
        "severity": i.severity,
        "status": i.status,
        "affected_services": i.affected_services,
        "error_patterns": i.error_patterns,
        "trace_id": i.trace_id,
        "assigned_to": i.assigned_to,
        "tags": i.tags,
        "ai_triage_summary": i.ai_triage_summary,
        "detected_at": i.detected_at.isoformat() if i.detected_at else None,
        "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }
