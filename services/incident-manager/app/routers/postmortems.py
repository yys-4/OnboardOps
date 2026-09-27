from typing import Optional, List
from datetime import datetime
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models import Postmortem, PostmortemStatus, Incident
from app.services.postmortem_generator import generate_postmortem

router = APIRouter()


class PostmortemCreate(BaseModel):
    incident_id: uuid.UUID
    auto_generate: bool = True


class PostmortemUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    impact: Optional[str] = None
    timeline: Optional[List[dict]] = None
    root_cause: Optional[str] = None
    contributing_factors: Optional[List[str]] = None
    resolution: Optional[str] = None
    action_items: Optional[List[dict]] = None
    lessons_learned: Optional[str] = None
    status: Optional[PostmortemStatus] = None


# ── POST /api/postmortems ─────────────────────────────────────────────────

@router.post("/", status_code=201)
async def create_postmortem(body: PostmortemCreate, db: AsyncSession = Depends(get_db)):
    incident = await db.get(Incident, body.incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")

    pm = Postmortem(
        incident_id=body.incident_id,
        title=f"Postmortem: {incident.title}",
        status=PostmortemStatus.draft,
    )

    if body.auto_generate:
        await generate_postmortem(pm, incident)
        pm.ai_generated = True

    db.add(pm)
    await db.commit()
    await db.refresh(pm)
    return {"data": _pm_dict(pm)}


# ── GET /api/postmortems ──────────────────────────────────────────────────

@router.get("/")
async def list_postmortems(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Postmortem).order_by(Postmortem.created_at.desc()))
    pms = result.scalars().all()
    return {"data": [_pm_dict(pm) for pm in pms]}


# ── GET /api/postmortems/:id ──────────────────────────────────────────────

@router.get("/{pm_id}")
async def get_postmortem(pm_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    pm = await db.get(Postmortem, pm_id)
    if not pm:
        raise HTTPException(404, "Postmortem not found")
    return {"data": _pm_dict(pm)}


# ── PATCH /api/postmortems/:id ────────────────────────────────────────────

@router.patch("/{pm_id}")
async def update_postmortem(pm_id: uuid.UUID, body: PostmortemUpdate, db: AsyncSession = Depends(get_db)):
    pm = await db.get(Postmortem, pm_id)
    if not pm:
        raise HTTPException(404, "Postmortem not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(pm, field, value)

    if body.status == PostmortemStatus.published and not pm.published_at:
        pm.published_at = datetime.utcnow()

    await db.commit()
    await db.refresh(pm)
    return {"data": _pm_dict(pm)}


# ── POST /api/postmortems/:id/regenerate ─────────────────────────────────

@router.post("/{pm_id}/regenerate")
async def regenerate_postmortem(pm_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    pm = await db.get(Postmortem, pm_id)
    if not pm:
        raise HTTPException(404, "Postmortem not found")

    incident = await db.get(Incident, pm.incident_id)
    await generate_postmortem(pm, incident)
    pm.ai_generated = True
    await db.commit()
    await db.refresh(pm)
    return {"data": _pm_dict(pm)}


def _pm_dict(pm: Postmortem) -> dict:
    return {
        "id": str(pm.id),
        "incident_id": str(pm.incident_id),
        "title": pm.title,
        "status": pm.status,
        "summary": pm.summary,
        "impact": pm.impact,
        "timeline": pm.timeline,
        "root_cause": pm.root_cause,
        "contributing_factors": pm.contributing_factors,
        "resolution": pm.resolution,
        "action_items": pm.action_items,
        "lessons_learned": pm.lessons_learned,
        "ai_generated": pm.ai_generated,
        "created_at": pm.created_at.isoformat() if pm.created_at else None,
        "updated_at": pm.updated_at.isoformat() if pm.updated_at else None,
    }
