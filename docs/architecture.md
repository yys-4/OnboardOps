# OnboardOps Architecture

## System Overview

```
┌─────────────────┐     REST      ┌──────────────────────┐
│  Dashboard      │ ──────────▶  │  Backend Service      │
│  (React + Vite) │              │  (Node/Express/OTel)  │
│  :3000          │ ──────────▶  │  :4000                │
└─────────────────┘     REST      └──────────┬───────────┘
                                             │
                         REST               │ SQL / Redis
                         ┌──────────────────┘
                         ▼
              ┌──────────────────────┐
              │  Incident Manager    │
              │  (FastAPI/SQLAlchemy)│
              │  :5000               │
              └──────────┬───────────┘
                         │ AI
                         ▼
                    OpenAI API
```

## Design Decisions

### ADR-001: Monorepo Structure
**Status:** Accepted  
**Context:** Need to co-develop backend + incident manager + frontend together.  
**Decision:** Single monorepo with `services/` and `dashboard/` directories, shared Docker Compose.  
**Consequences:** Easier local dev; CI must build each service independently.

### ADR-002: OpenTelemetry from Day 1
**Status:** Accepted  
**Context:** Incidents need distributed traces to reconstruct timelines.  
**Decision:** Instrument both services with OTel SDK → OTel Collector → Jaeger/Prometheus.  
**Consequences:** Slightly more complex startup; payoff in trace-linked incident creation.

### ADR-003: AI with graceful fallback
**Status:** Accepted  
**Context:** OpenAI key not always available in dev/CI.  
**Decision:** All AI features (triage, postmortem) fall back to rule-based logic when `OPENAI_API_KEY` absent.  
**Consequences:** Platform fully functional without AI key; richer with one.

### ADR-004: Error reproduction endpoints gated by feature flag
**Status:** Accepted  
**Context:** Endpoints that deliberately trigger failures must never reach production.  
**Decision:** `ENABLE_ERROR_ENDPOINTS=true` env flag. Warn loudly in logs if enabled.  
**Consequences:** Safe for prod; devs get full incident simulation in dev.

### ADR-005: FastAPI for incident manager (not Node)
**Status:** Accepted  
**Context:** AI/ML libs, async SQLAlchemy, and Pydantic v2 are first-class in Python.  
**Decision:** Python/FastAPI for incident-manager; Node for business logic backend.  
**Consequences:** Two languages in monorepo — justified by ecosystem fit.

## Data Flow: Incident Ingestion

```
Service logs / Alertmanager webhook
         │
         ▼
POST /api/ingest/logs
         │
   ┌─────┴──────────────────────────────────────┐
   │ 1. Parse log lines                          │
   │ 2. Infer severity via regex patterns        │
   │ 3. Create Incident record                   │
   │ 4. Insert LogEntry records                  │
   │ 5. auto_triage() — pattern detect + AI      │
   └─────────────────────────────────────────────┘
         │
         ▼
   Incident stored → Dashboard live feed
         │
         ▼ (optional)
POST /api/postmortems/ { incident_id, auto_generate: true }
         │
   generate_postmortem() → AI draft → Postmortem record
```

## Service Ports

| Service | Port | Notes |
|---|---|---|
| Dashboard | 3000 | React SPA |
| Backend | 4000 | Express API |
| Incident Manager | 5000 | FastAPI |
| PostgreSQL | 5432 | Shared DB |
| Redis | 6379 | Cache + pub |
| OTel Collector | 4317/4318 | gRPC/HTTP |
| Jaeger UI | 16686 | Trace viewer |
| Prometheus | 9090 | Metrics |
| Grafana | 3001 | Dashboards |
