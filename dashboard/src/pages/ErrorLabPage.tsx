import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { backendApi } from '@/lib/api';
import clsx from 'clsx';
import { Play, CheckCircle, XCircle, Loader2 } from 'lucide-react';

const SCENARIOS = [
  {
    id: 'memory_leak',
    label: 'Memory Leak',
    description: 'Allocate 50 MB into a leak bucket — watch heap grow',
    method: 'POST',
    path: '/api/debug/memory-leak?mb=50',
    severity: 'high',
    tags: ['memory', 'oom'],
  },
  {
    id: 'n_plus_one',
    label: 'N+1 Query',
    description: 'Fetch 20 orders with individual per-row queries',
    method: 'GET',
    path: '/api/debug/n-plus-one',
    severity: 'medium',
    tags: ['db', 'performance'],
  },
  {
    id: 'n_plus_one_fixed',
    label: 'N+1 Fixed (JOIN)',
    description: 'Same data via single JOIN — compare duration',
    method: 'GET',
    path: '/api/debug/n-plus-one/fixed',
    severity: 'low',
    tags: ['db', 'fix'],
  },
  {
    id: 'timeout',
    label: 'Timeout Cascade',
    description: 'Downstream delays 5 s, caller times out at 3 s',
    method: 'GET',
    path: '/api/debug/timeout?delay_ms=5000&timeout_ms=3000',
    severity: 'high',
    tags: ['timeout', 'cascade'],
  },
  {
    id: 'cpu_spike',
    label: 'CPU Spike',
    description: 'Block event loop for 2 s — watch latency spike',
    method: 'POST',
    path: '/api/debug/cpu-spike?duration_ms=2000',
    severity: 'medium',
    tags: ['cpu', 'blocking'],
  },
  {
    id: 'pool_exhaustion',
    label: 'DB Pool Exhaustion',
    description: 'Hold 15 DB connections for 3 s',
    method: 'POST',
    path: '/api/debug/pool-exhaustion?connections=15&hold_ms=3000',
    severity: 'critical',
    tags: ['db', 'pool', 'connection'],
  },
  {
    id: 'slow_query',
    label: 'Slow Query',
    description: 'Run pg_sleep(3) — shows in Jaeger traces',
    method: 'GET',
    path: '/api/debug/slow-query?sleep_s=3',
    severity: 'medium',
    tags: ['db', 'slow'],
  },
  {
    id: 'memory_free',
    label: 'Free Leak Memory',
    description: 'Release all memory allocated by memory leak runs',
    method: 'DELETE',
    path: '/api/debug/memory-leak',
    severity: 'low',
    tags: ['memory', 'fix'],
  },
];

const SEV_COLORS: Record<string, string> = {
  critical: 'border-red-700 bg-red-950',
  high:     'border-orange-700 bg-orange-950',
  medium:   'border-yellow-700 bg-yellow-950',
  low:      'border-green-800 bg-green-950',
};

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-900 text-red-300',
  high:     'bg-orange-900 text-orange-300',
  medium:   'bg-yellow-900 text-yellow-300',
  low:      'bg-green-900 text-green-300',
};

function ScenarioCard({ scenario }: { scenario: typeof SCENARIOS[0] }) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = useMutation({
    mutationFn: () => {
      const method = scenario.method.toLowerCase() as 'get' | 'post' | 'delete';
      return backendApi[method](scenario.path).then(r => r.data);
    },
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (err: any) => { setError(err.response?.data?.error ?? err.message); setResult(null); },
  });

  return (
    <div
      className={clsx('rounded-xl border p-4 space-y-3 transition-all', SEV_COLORS[scenario.severity])}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-white text-sm">{scenario.label}</span>
            <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', SEV_BADGE[scenario.severity])}>
              {scenario.severity}
            </span>
          </div>
          <p className="text-xs text-slate-400">{scenario.description}</p>
          <div className="flex gap-1 mt-2 flex-wrap">
            {scenario.tags.map(t => (
              <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{t}</span>
            ))}
          </div>
        </div>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
        >
          {trigger.isPending
            ? <Loader2 size={12} className="animate-spin" />
            : <Play size={12} />
          }
          Run
        </button>
      </div>

      {/* Code path */}
      <code className="block text-xs text-slate-500">
        {scenario.method} {scenario.path}
      </code>

      {/* Result */}
      {result && (
        <div className="flex items-start gap-2">
          <CheckCircle size={14} className="text-green-400 mt-0.5 shrink-0" />
          <pre className="text-xs text-green-300 overflow-auto max-h-32">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2">
          <XCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}

export default function ErrorLabPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Error Lab</h1>
        <p className="text-slate-400 text-sm mt-1">
          Trigger realistic failure scenarios. Watch traces in{' '}
          <a href="http://localhost:16686" target="_blank" rel="noreferrer" className="text-indigo-400 underline">
            Jaeger
          </a>
          {' '}and metrics in{' '}
          <a href="http://localhost:3001" target="_blank" rel="noreferrer" className="text-indigo-400 underline">
            Grafana
          </a>.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SCENARIOS.map(s => <ScenarioCard key={s.id} scenario={s} />)}
      </div>
    </div>
  );
}
