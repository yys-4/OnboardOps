import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { CheckCircle, Circle, ChevronDown, BookOpen, GitBranch, Layers } from 'lucide-react';
import clsx from 'clsx';

// ── Mermaid init ──────────────────────────────────────────────────────────────
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    background: '#0f1117',
    primaryColor: '#6366f1',
    primaryTextColor: '#e2e8f0',
    primaryBorderColor: '#334155',
    lineColor: '#475569',
    secondaryColor: '#1e2433',
    tertiaryColor: '#1e293b',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '13px',
  },
});

// ── Diagram definitions ───────────────────────────────────────────────────────
const DIAGRAMS = [
  {
    id: 'system-overview',
    label: 'System Overview',
    icon: Layers,
    definition: `graph TB
    subgraph Frontend
      DB[Dashboard<br/>React + Vite]
    end
    subgraph Backend["Backend Services"]
      BE[Node/Express<br/>:4000]
      IM[Incident Manager<br/>FastAPI :5000]
    end
    subgraph Data["Data Layer"]
      PG[(PostgreSQL)]
      RD[(Redis)]
    end
    subgraph Observability
      OT[OTel Collector]
      JA[Jaeger]
      PR[Prometheus]
      GR[Grafana]
    end
    EXT[OpenAI API]

    DB -->|REST| BE
    DB -->|REST| IM
    BE -->|SQL| PG
    BE -->|cache| RD
    BE -->|OTLP| OT
    IM -->|SQL| PG
    IM -->|cache| RD
    IM -->|AI| EXT
    IM -->|OTLP| OT
    OT -->|traces| JA
    OT -->|metrics| PR
    PR -->|query| GR`,
  },
  {
    id: 'fix-pipeline',
    label: 'Auto-Fix Pipeline',
    icon: GitBranch,
    definition: `sequenceDiagram
    participant Dev as Developer
    participant Hub as Incident Hub
    participant IM as Incident Manager
    participant AI as OpenAI
    participant BE as Backend

    Dev->>Hub: Click "Reproduce & Auto-Fix"
    Hub->>IM: POST /api/fix-hub/analyze
    IM->>IM: Phase 1 — Parse stack trace
    IM->>AI: Analyse error patterns
    AI-->>IM: Error class + suspect files
    IM->>IM: Phase 2 — Locate bug in source
    IM->>AI: Generate failing test case
    AI-->>IM: Test spec (vitest)
    IM->>BE: Run test suite (fail expected)
    BE-->>IM: Test result
    IM->>AI: Generate patch
    AI-->>IM: Before/after snippet
    IM->>AI: Generate postmortem
    AI-->>IM: Postmortem report
    IM-->>Hub: FixPipelineResult (SSE stream)
    Hub-->>Dev: Live phase updates`,
  },
  {
    id: 'incident-flow',
    label: 'Incident Lifecycle',
    icon: BookOpen,
    definition: `stateDiagram-v2
    [*] --> open : Log ingest / manual create
    open --> investigating : Triage triggered
    investigating --> mitigated : Workaround applied
    mitigated --> resolved : Root cause fixed
    investigating --> resolved : Direct fix
    resolved --> closed : Post-mortem complete
    closed --> [*]
    open --> closed : False positive`,
  },
];

// ── Starter tasks ─────────────────────────────────────────────────────────────
interface Task {
  id: string;
  category: string;
  title: string;
  detail: string;
  doc?: string;
}

const STARTER_TASKS: Task[] = [
  {
    id: 't1',
    category: 'Setup',
    title: 'Clone & configure .env',
    detail: 'Copy .env.example → .env and fill in DATABASE_URL, REDIS_URL, JWT_SECRET, OPENAI_API_KEY.',
    doc: 'README.md',
  },
  {
    id: 't2',
    category: 'Setup',
    title: 'docker compose up',
    detail: 'Run `docker compose up --build` — spins up Postgres, Redis, OTel, Prometheus, Grafana.',
    doc: 'docker-compose.yml',
  },
  {
    id: 't3',
    category: 'Backend',
    title: 'Run DB migrations',
    detail: 'cd services/backend && npm run migrate — creates all tables via Knex.',
    doc: 'services/backend/src/db/migrations/',
  },
  {
    id: 't4',
    category: 'Backend',
    title: 'Seed demo data',
    detail: 'npm run seed — populates products, users, and sample orders.',
  },
  {
    id: 't5',
    category: 'Tests',
    title: 'Run the test suite',
    detail: 'cd services/backend && npm test — 23 tests across 3 bug fixtures must all pass.',
  },
  {
    id: 't6',
    category: 'Dashboard',
    title: 'Start the dev server',
    detail: 'cd dashboard && npm run dev — Vite serves the React dashboard on :3000.',
  },
  {
    id: 't7',
    category: 'Incident Hub',
    title: 'Create a demo incident',
    detail: 'Open Incident Response Hub → click "Create Demo Incident" to ingest sample logs.',
  },
  {
    id: 't8',
    category: 'Incident Hub',
    title: 'Trigger Auto-Fix on an incident',
    detail: 'Select an incident → click "Reproduce & Auto-Fix" → watch the 5-phase pipeline run live.',
  },
  {
    id: 't9',
    category: 'Observability',
    title: 'Open Grafana dashboards',
    detail: 'Navigate to http://localhost:3001 — default creds admin/admin. Pre-built dashboards await.',
  },
  {
    id: 't10',
    category: 'Observability',
    title: 'Inspect traces in Jaeger',
    detail: 'Navigate to http://localhost:16686 — trace every request end-to-end across services.',
  },
];

const CATEGORIES = [...new Set(STARTER_TASKS.map(t => t.category))];
const CATEGORY_COLORS: Record<string, string> = {
  Setup: 'text-indigo-400 bg-indigo-900/30',
  Backend: 'text-sky-400 bg-sky-900/30',
  Tests: 'text-emerald-400 bg-emerald-900/30',
  Dashboard: 'text-violet-400 bg-violet-900/30',
  'Incident Hub': 'text-orange-400 bg-orange-900/30',
  Observability: 'text-amber-400 bg-amber-900/30',
};

// ── MermaidDiagram component ──────────────────────────────────────────────────
function MermaidDiagram({ id, definition }: { id: string; definition: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;

    mermaid.render(`mermaid-${id}-${Date.now()}`, definition)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          // Make SVG responsive
          const svgEl = ref.current.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });

    return () => { cancelled = true; };
  }, [id, definition]);

  if (error) {
    return (
      <div className="p-4 text-red-400 text-xs font-mono rounded bg-red-900/20 border border-red-800">
        Diagram error: {error}
      </div>
    );
  }

  return <div ref={ref} className="w-full overflow-x-auto flex justify-center py-4" />;
}

// ── TaskList component ────────────────────────────────────────────────────────
function TaskList() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCompleted(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const pct = Math.round((completed.size / STARTER_TASKS.length) * 100);

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 shrink-0">{completed.size}/{STARTER_TASKS.length} done</span>
      </div>

      {CATEGORIES.map(cat => (
        <div key={cat}>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{cat}</p>
          <div className="space-y-1">
            {STARTER_TASKS.filter(t => t.category === cat).map(task => {
              const done = completed.has(task.id);
              return (
                <button
                  key={task.id}
                  onClick={() => toggle(task.id)}
                  className="w-full text-left flex items-start gap-3 p-3 rounded-lg transition-colors hover:brightness-110"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                >
                  {done
                    ? <CheckCircle size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                    : <Circle size={16} className="text-slate-600 shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <p className={clsx('text-sm font-medium', done ? 'line-through text-slate-500' : 'text-white')}>
                      {task.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{task.detail}</p>
                    {task.doc && (
                      <span className={`text-xs mt-1 inline-block px-2 py-0.5 rounded font-mono ${CATEGORY_COLORS[cat] ?? ''}`}>
                        {task.doc}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function OnboardingExplorerPage() {
  const [activeDiagram, setActiveDiagram] = useState(DIAGRAMS[0].id);
  const diagram = DIAGRAMS.find(d => d.id === activeDiagram) ?? DIAGRAMS[0];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Onboarding Explorer</h1>
        <p className="text-slate-400 text-sm mt-1">
          Live architecture diagrams + guided starter tasks to get you shipping fast
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left: Diagrams ─────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tab strip */}
          <div className="flex gap-2 flex-wrap">
            {DIAGRAMS.map(d => {
              const Icon = d.icon;
              return (
                <button
                  key={d.id}
                  onClick={() => setActiveDiagram(d.id)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    activeDiagram === d.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white',
                  )}
                  style={activeDiagram !== d.id ? { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } : {}}
                >
                  <Icon size={13} />
                  {d.label}
                </button>
              );
            })}
          </div>

          {/* Diagram canvas */}
          <div
            className="rounded-xl border overflow-hidden min-h-64"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-slate-400 font-mono">{diagram.id}.mmd</span>
            </div>
            <div className="p-4">
              <MermaidDiagram key={diagram.id} id={diagram.id} definition={diagram.definition} />
            </div>
          </div>

          {/* Mermaid source (collapsible) */}
          <details className="group rounded-xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <summary className="px-4 py-3 flex items-center justify-between cursor-pointer text-xs text-slate-400 hover:text-white select-none">
              <span>View diagram source</span>
              <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            </summary>
            <pre
              className="px-4 pb-4 text-xs font-mono overflow-x-auto"
              style={{ color: '#a5b4fc' }}
            >
              {diagram.definition.trim()}
            </pre>
          </details>
        </div>

        {/* ── Right: Starter tasks ───────────────────── */}
        <div
          className="lg:col-span-2 rounded-xl border p-5 overflow-y-auto"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: 720 }}
        >
          <h2 className="font-semibold text-white mb-4 text-sm">Starter Checklist</h2>
          <TaskList />
        </div>
      </div>
    </div>
  );
}
