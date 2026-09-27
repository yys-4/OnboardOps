import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { incidentApi } from '@/lib/api';
import {
  Play, RefreshCw, Plus, CheckCircle, XCircle, Loader, ChevronRight,
  AlertTriangle, FileCode, TestTube, Wrench, BookOpen,
} from 'lucide-react';
import clsx from 'clsx';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedFrame { file: string; fn: string; line: number; raw: string }
interface StackTraceResult {
  error_class: string; error_message: string;
  frames: ParsedFrame[]; primary_frame: ParsedFrame | null;
  detected_patterns: string[];
}
interface TestCaseSpec { name: string; description: string; code: string; framework: string; expected_state: string }
interface PatchSpec { target_file: string; target_fn: string; description: string; before_snippet: string; after_snippet: string; confidence: string }
interface PostmortemReport { title: string; severity: string; summary: string; root_cause: string; resolution: string; lessons_learned: string }
interface FixResult {
  incident_id: string; phase_completed: string;
  started_at: string; completed_at: string | null; error: string | null;
  stack_trace_result: StackTraceResult | null;
  suspect_files: string[];
  test_case: TestCaseSpec | null;
  patch: PatchSpec | null;
  postmortem: PostmortemReport | null;
}

interface Incident {
  id: string; title: string; severity: string; status: string;
  affected_services: string[]; detected_at: string; ai_triage_summary?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASES = [
  { key: 'parse',         label: 'Parse Trace', icon: AlertTriangle },
  { key: 'locate',        label: 'Locate Bug',  icon: FileCode },
  { key: 'generate_test', label: 'Gen Test',    icon: TestTube },
  { key: 'patch',         label: 'Patch',       icon: Wrench },
  { key: 'postmortem',    label: 'Postmortem',  icon: BookOpen },
] as const;

const PHASE_ORDER: string[] = PHASES.map(p => p.key);
const completedPhaseIndex = (phase: string) => {
  if (phase === 'complete') return PHASE_ORDER.length;
  if (phase === 'failed') return -1;
  return PHASE_ORDER.indexOf(phase);
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-green-400',
};
const STATUS_BADGE: Record<string, string> = {
  open:          'bg-red-900 text-red-300',
  investigating: 'bg-orange-900 text-orange-300',
  mitigated:     'bg-yellow-900 text-yellow-300',
  resolved:      'bg-green-900 text-green-300',
  closed:        'bg-slate-700 text-slate-400',
};
const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-emerald-400', medium: 'text-yellow-400', low: 'text-red-400',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function PhasePipeline({ result, loading }: { result: FixResult | null; loading: boolean }) {
  const currentIdx = result ? completedPhaseIndex(result.phase_completed) : -1;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASES.map(({ key, label, icon: Icon }, i) => {
        const done = currentIdx >= i + 1;
        const active = loading && currentIdx === i - 1;
        const isCurrent = !loading && currentIdx === i;
        return (
          <div key={key} className="flex items-center gap-1">
            <div
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                done      ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800' :
                active    ? 'bg-indigo-900/60 text-indigo-300 border border-indigo-600 animate-pulse' :
                isCurrent ? 'bg-indigo-900/40 text-indigo-300 border border-indigo-700' :
                            'text-slate-600 border border-transparent',
              )}
            >
              {done ? <CheckCircle size={11} /> : active ? <Loader size={11} className="animate-spin" /> : <Icon size={11} />}
              {label}
            </div>
            {i < PHASES.length - 1 && (
              <ChevronRight size={10} className={done ? 'text-emerald-700' : 'text-slate-700'} />
            )}
          </div>
        );
      })}
      {result?.phase_completed === 'complete' && (
        <span className="ml-2 text-xs text-emerald-400 font-semibold flex items-center gap-1">
          <CheckCircle size={12} /> Fixed
        </span>
      )}
      {result?.phase_completed === 'failed' && (
        <span className="ml-2 text-xs text-red-400 font-semibold flex items-center gap-1">
          <XCircle size={12} /> {result.error ?? 'Failed'}
        </span>
      )}
    </div>
  );
}

function FixResultPanel({ result }: { result: FixResult }) {
  const [tab, setTab] = useState<'trace' | 'test' | 'patch' | 'postmortem'>('trace');

  const tabs = [
    { key: 'trace' as const,     label: 'Stack Trace',  available: !!result.stack_trace_result },
    { key: 'test' as const,      label: 'Test Case',    available: !!result.test_case },
    { key: 'patch' as const,     label: 'Patch',        available: !!result.patch },
    { key: 'postmortem' as const, label: 'Postmortem',  available: !!result.postmortem },
  ];

  return (
    <div
      className="mt-4 rounded-xl border overflow-hidden"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      {/* Tab strip */}
      <div className="flex border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {tabs.filter(t => t.available).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2.5 text-xs font-medium transition-colors border-b-2',
              tab === t.key
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-500 hover:text-slate-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 text-xs space-y-3">
        {tab === 'trace' && result.stack_trace_result && (
          <>
            <div className="flex gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-300 font-mono">
                {result.stack_trace_result.error_class}
              </span>
              {result.stack_trace_result.detected_patterns.map(p => (
                <span key={p} className="px-2 py-0.5 rounded bg-orange-900/30 text-orange-300 font-mono">{p}</span>
              ))}
            </div>
            <p className="text-slate-400 font-mono">{result.stack_trace_result.error_message}</p>
            {result.stack_trace_result.primary_frame && (
              <p className="text-slate-500">
                Primary: <span className="text-indigo-300 font-mono">{result.stack_trace_result.primary_frame.file}</span>
                {' '}line <span className="text-white">{result.stack_trace_result.primary_frame.line}</span>
              </p>
            )}
            <div className="space-y-1">
              {result.suspect_files.map((f, i) => (
                <div key={f} className="flex items-center gap-2 font-mono text-slate-400">
                  <span className="text-slate-600">#{i + 1}</span>
                  <FileCode size={11} className="text-indigo-400" />
                  {f}
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'test' && result.test_case && (
          <>
            <p className="text-slate-300 font-semibold">{result.test_case.name}</p>
            <p className="text-slate-500">{result.test_case.description}</p>
            <pre
              className="rounded-lg p-3 overflow-x-auto text-emerald-300 font-mono leading-relaxed text-xs"
              style={{ background: 'var(--color-surface)' }}
            >
              {result.test_case.code}
            </pre>
            <p className="text-slate-500">Framework: <span className="text-white">{result.test_case.framework}</span>
            {' '}· Expected state: <span className="text-yellow-300">{result.test_case.expected_state}</span></p>
          </>
        )}

        {tab === 'patch' && result.patch && (
          <>
            <div className="flex items-center gap-3">
              <p className="text-slate-300 font-semibold">{result.patch.description}</p>
              <span className={`font-medium ${CONFIDENCE_COLORS[result.patch.confidence] ?? 'text-slate-400'}`}>
                {result.patch.confidence} confidence
              </span>
            </div>
            <p className="text-slate-500 font-mono">{result.patch.target_file} → {result.patch.target_fn}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-red-400 mb-1 font-medium">Before</p>
                <pre className="rounded-lg p-3 overflow-x-auto text-red-300 font-mono leading-relaxed text-xs bg-red-900/10 border border-red-900/40">
                  {result.patch.before_snippet}
                </pre>
              </div>
              <div>
                <p className="text-emerald-400 mb-1 font-medium">After</p>
                <pre className="rounded-lg p-3 overflow-x-auto text-emerald-300 font-mono leading-relaxed text-xs bg-emerald-900/10 border border-emerald-900/40">
                  {result.patch.after_snippet}
                </pre>
              </div>
            </div>
          </>
        )}

        {tab === 'postmortem' && result.postmortem && (
          <>
            <p className="text-white font-semibold text-sm">{result.postmortem.title}</p>
            <div className="space-y-2 text-slate-400 leading-relaxed">
              <div><span className="text-slate-300 font-medium">Summary: </span>{result.postmortem.summary}</div>
              <div><span className="text-slate-300 font-medium">Root Cause: </span>{result.postmortem.root_cause}</div>
              <div><span className="text-slate-300 font-medium">Resolution: </span>{result.postmortem.resolution}</div>
              <div><span className="text-slate-300 font-medium">Lessons: </span>{result.postmortem.lessons_learned}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Incident row with expand + fix ────────────────────────────────────────────
function IncidentRow({ inc }: { inc: Incident }) {
  const [expanded, setExpanded] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);

  const fixMutation = useMutation({
    mutationFn: () =>
      incidentApi.post('/api/fix-hub/analyze', {
        incident_id: inc.id,
        title: inc.title,
        severity: inc.severity,
        stack_trace: `Incident: ${inc.title}\nAffected: ${inc.affected_services?.join(', ')}\nDetected: ${inc.detected_at}`,
        log_lines: inc.ai_triage_summary ? [inc.ai_triage_summary] : [],
        persist_postmortem: true,
      }).then(r => r.data.data as FixResult),
    onSuccess: (data) => { setFixResult(data); setExpanded(true); },
  });

  const fixtureMap: Record<string, string> = {
    'Race condition': 'race_condition',
    'TypeError': 'null_pointer',
    'Payment': 'payment_timeout',
  };

  const fixtureKey = Object.entries(fixtureMap).find(([k]) => inc.title.includes(k))?.[1];

  const fixtureRunMutation = useMutation({
    mutationFn: () =>
      fixtureKey
        ? incidentApi.post(`/api/fix-hub/analyze/fixture/${fixtureKey}`).then(r => r.data.data as FixResult)
        : incidentApi.post('/api/fix-hub/analyze', {
            incident_id: inc.id,
            title: inc.title,
            severity: inc.severity,
            stack_trace: `Incident: ${inc.title}\nAffected: ${inc.affected_services?.join(', ')}`,
            log_lines: [],
            persist_postmortem: true,
          }).then(r => r.data.data as FixResult),
    onSuccess: (data) => { setFixResult(data); setExpanded(true); },
  });

  const isLoading = fixMutation.isPending || fixtureRunMutation.isPending;
  const run = fixtureKey ? fixtureRunMutation : fixMutation;

  return (
    <>
      <tr
        className="hover:brightness-110 transition-all cursor-pointer"
        style={{ background: expanded ? 'var(--color-surface)' : 'var(--color-bg)' }}
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <p className="font-medium text-white text-sm">{inc.title}</p>
          {inc.ai_triage_summary && (
            <p className="text-xs text-slate-500 mt-0.5 max-w-sm truncate">{inc.ai_triage_summary}</p>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={`font-medium capitalize text-xs ${SEVERITY_COLORS[inc.severity]}`}>{inc.severity}</span>
        </td>
        <td className="px-4 py-3">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[inc.status]}`}>{inc.status}</span>
        </td>
        <td className="px-4 py-3 text-slate-400 text-xs">{inc.affected_services?.join(', ')}</td>
        <td className="px-4 py-3 text-slate-500 text-xs">{new Date(inc.detected_at).toLocaleString()}</td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => { run.mutate(); setExpanded(true); }}
            disabled={isLoading}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              fixResult?.phase_completed === 'complete'
                ? 'bg-emerald-800 text-emerald-300 cursor-default'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50',
            )}
          >
            {isLoading
              ? <><Loader size={12} className="animate-spin" /> Running…</>
              : fixResult?.phase_completed === 'complete'
              ? <><CheckCircle size={12} /> Fixed</>
              : <><Play size={12} /> Reproduce & Auto-Fix</>}
          </button>
        </td>
      </tr>

      {/* Expanded: pipeline + result */}
      {expanded && (
        <tr style={{ background: 'var(--color-bg)' }}>
          <td colSpan={6} className="px-4 pb-4">
            <div
              className="rounded-xl border p-4 space-y-3"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <PhasePipeline result={fixResult} loading={isLoading} />
              {isLoading && (
                <p className="text-xs text-indigo-400 animate-pulse">
                  Bob subagent running fix pipeline… phase updates will appear on completion.
                </p>
              )}
              {fixResult && <FixResultPanel result={fixResult} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IncidentResponseHubPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hub-incidents', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '20');
      return incidentApi.get(`/api/incidents/?${params}`).then(r => r.data);
    },
    refetchInterval: 30_000,
  });

  const createDemoMutation = useMutation({
    mutationFn: () =>
      incidentApi.post('/api/ingest/logs', {
        source: 'manual',
        create_incident: true,
        incident_title: 'Demo: High error rate on backend service',
        logs: [
          { service: 'backend', level: 'error', message: 'ERROR: Unhandled exception in /api/orders', timestamp: new Date().toISOString() },
          { service: 'backend', level: 'error', message: 'ERROR: Database timeout after 5000ms', timestamp: new Date().toISOString() },
          { service: 'postgres', level: 'warn', message: 'WARN: Connection pool exhausted (15/15)', timestamp: new Date().toISOString() },
        ],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hub-incidents'] }),
  });

  const incidents: Incident[] = data?.data ?? [];
  const openCount = incidents.filter(i => i.status === 'open').length;

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Incident Response Hub</h1>
          <p className="text-slate-400 text-sm mt-1">
            Click <span className="text-indigo-400 font-medium">Reproduce &amp; Auto-Fix</span> on any incident — Bob's subagent parses the trace, writes a test, patches the bug, and generates a postmortem.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg border text-slate-400 hover:text-white transition-colors"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => createDemoMutation.mutate()}
            disabled={createDemoMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Plus size={16} />
            {createDemoMutation.isPending ? 'Creating…' : 'Create Demo Incident'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 text-sm">
        <div className="px-3 py-1.5 rounded-lg text-slate-400" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <span className="text-white font-semibold">{data?.pagination?.total ?? 0}</span> total
        </div>
        <div className="px-3 py-1.5 rounded-lg text-slate-400" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <span className="text-red-400 font-semibold">{openCount}</span> open
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {(['', 'open', 'investigating', 'mitigated', 'resolved', 'closed'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              statusFilter === s ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white',
            )}
            style={statusFilter !== s ? { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } : {}}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-surface)' }}>
            <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3">Incident</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Services</th>
              <th className="px-4 py-3">Detected</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading incidents…</td></tr>
            )}
            {!isLoading && !incidents.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  <p>No incidents found.</p>
                  <button
                    onClick={() => createDemoMutation.mutate()}
                    className="mt-2 text-indigo-400 hover:text-indigo-300 text-xs underline"
                  >
                    Create a demo incident to get started.
                  </button>
                </td>
              </tr>
            )}
            {incidents.map(inc => (
              <IncidentRow key={inc.id} inc={inc} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div
        className="rounded-xl border p-4 text-xs text-slate-500 space-y-1"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <p className="text-slate-400 font-medium mb-2">How it works</p>
        <p>1. <span className="text-indigo-300">Parse</span> — stack trace → structured frames + detected error patterns</p>
        <p>2. <span className="text-indigo-300">Locate</span> — suspect files ranked by likelihood</p>
        <p>3. <span className="text-indigo-300">Generate Test</span> — AI writes a failing Vitest spec that reproduces the bug</p>
        <p>4. <span className="text-indigo-300">Patch</span> — minimal before/after code snippet with confidence rating</p>
        <p>5. <span className="text-indigo-300">Postmortem</span> — SRE-style RCA with root cause, resolution, and lessons learned</p>
      </div>
    </div>
  );
}
