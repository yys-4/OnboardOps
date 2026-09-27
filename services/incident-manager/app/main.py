from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.session import engine, Base
from app.telemetry import setup_telemetry
from app.routers import incidents, postmortems, ingestion, health
from app.routers import fix_hub
from app.middleware.logging import LoggingMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    setup_telemetry()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="OnboardOps Incident Manager",
    description="Log ingestion, incident triage, and postmortem generation",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(LoggingMiddleware)

app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(ingestion.router, prefix="/api/ingest", tags=["ingestion"])
app.include_router(incidents.router, prefix="/api/incidents", tags=["incidents"])
app.include_router(postmortems.router, prefix="/api/postmortems", tags=["postmortems"])
app.include_router(fix_hub.router, prefix="/api/fix-hub", tags=["fix-hub"])
