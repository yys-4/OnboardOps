import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, DateTime, Enum, Integer, Boolean,
    ForeignKey, JSON, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, DeclarativeBase


class Base(DeclarativeBase):
    pass


class IncidentSeverity(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class IncidentStatus(str, enum.Enum):
    open = "open"
    investigating = "investigating"
    mitigated = "mitigated"
    resolved = "resolved"
    closed = "closed"


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(500), nullable=False)
    description = Column(Text)
    severity = Column(Enum(IncidentSeverity), nullable=False, default=IncidentSeverity.medium)
    status = Column(Enum(IncidentStatus), nullable=False, default=IncidentStatus.open)
    affected_services = Column(JSON, default=list)   # ["backend", "db"]
    error_patterns = Column(JSON, default=list)       # detected error patterns
    raw_logs = Column(Text)                           # ingested log blob
    trace_id = Column(String(64))                     # linked OTEL trace
    assigned_to = Column(String(255))
    tags = Column(JSON, default=list)
    ai_triage_summary = Column(Text)                  # AI-generated summary
    detected_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    postmortems = relationship("Postmortem", back_populates="incident", cascade="all, delete-orphan")
    log_entries = relationship("LogEntry", back_populates="incident", cascade="all, delete-orphan")


class LogEntry(Base):
    """Individual log line ingested from a service."""
    __tablename__ = "log_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id = Column(UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"))
    service = Column(String(100), nullable=False)
    level = Column(String(20), nullable=False)          # error/warn/info
    message = Column(Text, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    trace_id = Column(String(64))
    span_id = Column(String(32))
    attributes = Column(JSON, default=dict)
    raw_line = Column(Text)

    incident = relationship("Incident", back_populates="log_entries")


class PostmortemStatus(str, enum.Enum):
    draft = "draft"
    review = "review"
    approved = "approved"
    published = "published"


class Postmortem(Base):
    __tablename__ = "postmortems"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id = Column(UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"))
    title = Column(String(500), nullable=False)
    status = Column(Enum(PostmortemStatus), default=PostmortemStatus.draft)

    # Structured postmortem sections
    summary = Column(Text)
    impact = Column(Text)
    timeline = Column(JSON, default=list)              # [{time, event, actor}]
    root_cause = Column(Text)
    contributing_factors = Column(JSON, default=list)
    resolution = Column(Text)
    action_items = Column(JSON, default=list)          # [{id, title, owner, due_date, status}]
    lessons_learned = Column(Text)

    # Metadata
    ai_generated = Column(Boolean, default=False)
    reviewed_by = Column(String(255))
    published_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    incident = relationship("Incident", back_populates="postmortems")
