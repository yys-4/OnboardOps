from fastapi import APIRouter
from sqlalchemy import text
from app.db.session import engine

router = APIRouter()


@router.get("/")
async def health():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "fail"

    healthy = db_status == "ok"
    return {"status": "healthy" if healthy else "degraded", "checks": {"db": db_status}}


@router.get("/ready")
async def ready():
    return {"ready": True}
