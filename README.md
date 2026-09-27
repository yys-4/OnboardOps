# OnboardOps Copilot

> AI-native developer onboarding & incident resolution platform.

## What It Does

| Capability | Details |
|---|---|
| **Architecture Explorer** | Interactive graph of services, deps, data flows |
| **Incident Ingestion** | Ingest logs/alerts → auto-triage → postmortem draft |
| **Error Reproduction** | Trigger realistic failure scenarios in sandbox |
| **Automated Fixes** | AI suggests + applies remediations with approval gate |
| **Onboarding Copilot** | New devs get guided context from real incidents |

## Monorepo Structure

```
onboardops/
├── services/
│   ├── backend/          # Core business service (Node/Express + OpenTelemetry)
│   ├── incident-manager/ # Log ingestion, postmortem engine (Python/FastAPI)
│   └── ai-copilot/       # LLM orchestration layer (Python/LangChain)
├── dashboard/            # React + TypeScript UI
├── infra/
│   ├── docker/           # Service Dockerfiles
│   └── k8s/              # Kubernetes manifests (optional)
├── shared/
│   ├── types/            # Shared TypeScript types
│   └── schemas/          # JSON schemas for incidents/postmortems
├── docs/
│   ├── architecture.md
│   └── runbooks/
├── docker-compose.yml
├── .env.example
└── Makefile
```

## Quick Start

### Option A: Local Development
```bash
# 1. Clone & configure
cp .env.example .env
# Edit .env with your FIREWORKS_API_KEY (GLM 5.3 Flash) or OPENAI_API_KEY

# 2. Start all services
make up

# 3. Access
# Dashboard:         http://localhost:3000
# Backend API:       http://localhost:4000
# Incident Manager:  http://localhost:5001
# Jaeger (traces):   http://localhost:16686
# Grafana:           http://localhost:3001
```

Compose uses host port 5001 for the Incident Manager because macOS may already use port 5000. Override it with `INCIDENT_MANAGER_PORT` in `.env`; rebuild the dashboard with `docker compose up -d --build dashboard` after changing this port.

### Option B: Zero-Infra Deployment (Netlify)
Deploy the platform directly to Netlify with serverless functions and Fireworks AI:
1. Import this repository into Netlify.
2. The included `netlify.toml` automatically configures the build (`dashboard/` with publish `dist/`) and functions (`netlify/functions/`).
3. Add Environment Variables in Netlify:
   - `FIREWORKS_API_KEY` = your Fireworks key
   - `FIREWORKS_MODEL` = `accounts/fireworks/models/glm-5p3-flash`
4. Click **Deploy Site** — your live dashboard & serverless fix hub are online!

## Prerequisites

- Docker 24+ & Docker Compose v2
- Node 20+ (for local dev without Docker)
- Python 3.11+ (for local dev without Docker)

## Service Overview

### Backend (`services/backend`)
Production-realistic Express service:
- **Order management** with DB (PostgreSQL)
- **Auth** (JWT + refresh tokens)
- **OpenTelemetry** traces, metrics, logs
- **Error endpoints** for reproducing real incident patterns:
  - Memory leak, N+1 query, deadlock, timeout cascade, unhandled rejection

### Incident Manager (`services/incident-manager`)
FastAPI service:
- Ingest logs from backend, alertmanager, or manual upload
- Auto-classify severity + affected services
- Generate postmortem drafts via AI
- Timeline reconstruction from distributed traces

### Dashboard (`dashboard`)
React 18 + TypeScript + Vite:
- Service graph (D3.js)
- Live incident feed
- Postmortem editor
- Error reproduction controls
- AI chat for onboarding questions

## Development

```bash
# Backend only
cd services/backend && npm install && npm run dev

# Incident manager only
cd services/incident-manager && pip install -e ".[dev]" && uvicorn app.main:app --reload

# Dashboard only
cd dashboard && npm install && npm run dev
```

## Environment Variables

See [`.env.example`](.env.example) for full list.

Key vars:
- `OPENAI_API_KEY` — AI features
- `DATABASE_URL` — PostgreSQL connection
- `REDIS_URL` — Cache + pubsub
- `JAEGER_ENDPOINT` — Trace export

## Architecture Decision Records

See [`docs/architecture.md`](docs/architecture.md).

## License

MIT
