/**
 * Fix Hub Page — Incident Postmortem & Automated Fix Hub
 *
 * Allows engineers to:
 *   1. Select a built-in fixture or paste a custom stack trace
 *   2. Run the 5-phase autonomous fix pipeline
 *   3. Inspect each phase result (parse → locate → test → patch → postmortem)
 *   4. View the generated SRE postmortem with RCA
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { incidentApi } from '@/lib/api';
import {
  Bug, Search, TestTube, Wrench, FileText, ChevronDown, ChevronRight,
  Play, CheckCircle, XCircle, Loader, AlertTriangle, Copy, Check,
} from 'lucide-react';
import clsx from 'clsx';

// ── Types ──────────────────────────────────────────────────────────────────

interface ParsedFrame {
  file: string; fn: string; line: number; raw: string;
}
interface StackTraceResult {
  error_class: string;
  error_message: string;
  frames: ParsedFrame[];
  primary_frame: ParsedFrame | null;
  detected_patterns: string[];
}
interface TestCaseSpec {
  name: string; description: string; code: string; framework: string; expected_state: string;
}
interface PatchSpec {
  target_file: string; target_fn: string; description: string;
  before_snippet: string; after_snippet: string; confidence: string;
}
interface PostmortemReport {
  title: string; severity: string; summary: string; impact: string;
  timeline: Array<{ time: string; event: string; actor: string }>;
  root_cause: string; contributing_factors: string[];
  resolution: string;
  action_items: Array<{ id: string; title: string; owner: string; due_date: string; status: string }>;
  lessons_learned: string;
  error_type: string; affected_files: string[];
  patch_applied: boolean; test_result: string; ai_generated: boolean;
}
interface FixPipelineResult {
  incident_id: string; phase_completed: string;
  started_at: string; completed_at: string | null; error: string | null;
  stack_trace_result: StackTraceResult | null;
  suspect_files: string[];
  test_case: TestCaseSpec | null;
  patch: PatchSpec | null;
  postmortem: PostmortemReport | null;
}
interface Fixture { id: string; fixture_key: string; title: string; severity: string; }

// ── Sub-components ─────────────────────────────────────────────────────────

function PhaseIcon({ phase, current, completed }: { phase: string; current: string; completed: boolean }) {
  const icons: Record<string, React.ReactNode> = {
    parse:         <Bug size={14} />,
    locate:        <Search size={14} />,
    generate_test: <TestTube size={14} />,
    patch:         <Wrench size={14} />,
    postmortem:    <FileText size={14} />,
  };
  const order = ['parse', 'locate', 'generate_test', 'patch', 'postmortem'];
  const currentIdx = order.indexOf(current === 'complete' ? 'postmortem' : current);
  const phaseIdx = order.indexOf(phase);
  const done = current === 'complete' || phaseIdx < currentIdx;
  const active = phase === current;

  return (
    <div className={clsx(
      'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium',
      done  ? 'bg-emerald-900 text-emerald-300'  : '',
      active ? 'bg-indigo-700 text-white animate-pulse' : '',
      !done && !active ? 'bg-slate-800 text-slate-500' : '',
    )}>
      {done ? <CheckCircle size={12} /> : icons[phase]}
      {phase.replace('_', ' ')}
    </div>
  );
}

function CollapsibleSection({ title, icon, defaultOpen = false, children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-white hover:brightness-110 transition-all"
        style={{ background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">{icon}{title}</div>
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 py-3 text-sm" style={{ background: 'var(--color-bg)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ code, lang = 'typescript' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <div className="relative group">
      <pre
        className="text-xs p-3 rounded overflow-x-auto leading-relaxed"
        style={{ background: '#0d1117', color: '#e6edf3', fontFamily: 'monospace' }}
      >
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: 'var(--color-surface)' }}
      >
        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-slate-400" />}
      </button>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: 'bg-red-900 text-red-300',
    high:     'bg-orange-900 text-orange-300',
    medium:   'bg-yellow-900 text-yellow-300',
    low:      'bg-green-900 text-green-300',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[severity] ?? 'bg-slate-700 text-slate-300'}`}>
      {severity}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const map: Record<string, string> = {
    high:         'bg-emerald-900 text-emerald-300',
    medium:       'bg-yellow-900 text-yellow-300',
    low:          'bg-red-900 text-red-300',
    ai_generated: 'bg-indigo-900 text-indigo-300',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[confidence] ?? 'bg-slate-700 text-slate-300'}`}>
      {confidence}
    </span>
  );
}

// ── Phase result panels ────────────────────────────────────────────────────

function ParsePanel({ result }: { result: FixPipelineResult }) {
  const st = result.stack_trace_result;
  if (!st) return <p className="text-slate-500 text-xs">No parse result.</p>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs text-slate-400">Error class:</span>
        <code className="text-xs text-red-300">{st.error_class}</code>
      </div>
      <div>
        <span className="text-xs text-slate-400">Message:</span>
        <p className="text-sm text-white mt-1">{st.error_message}</p>
      </div>
      {st.detected_patterns.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs text-slate-400 self-center">Patterns:</span>
          {st.detected_patterns.map(p => (
            <span key={p} className="text-xs px-2 py-0.5 rounded bg-orange-900 text-orange-300">{p}</span>
          ))}
        </div>
      )}
      {st.primary_frame && (
        <div>
          <p className="text-xs text-slate-400 mb-1">Primary suspect frame:</p>
          <CodeBlock code={`${st.primary_frame.file}:${st.primary_frame.line}\n  in ${st.primary_frame.fn}`} lang="text" />
        </div>
      )}
      {st.frames.length > 0 && (
        <details className="text-xs">
          <summary className="text-slate-400 cursor-pointer hover:text-white">
            All frames ({st.frames.length})
          </summary>
          <div className="mt-2 space-y-0.5">
            {st.frames.map((f, i) => (
              <div key={i} className="text-slate-400 font-mono text-xs">{f.raw}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function LocatePanel({ result }: { result: FixPipelineResult }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-slate-400 mb-2">Suspect files ({result.suspect_files.length}):</p>
        <div className="space-y-1">
          {result.suspect_files.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-600">{i + 1}.</span>
              <code className="text-xs text-indigo-300">{f}</code>
              {i === 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-900 text-indigo-300">primary</span>}
            </div>
          ))}
          {result.suspect_files.length === 0 && (
            <p className="text-slate-500 text-xs">No app-code frames found.</p>
          )}
        </div>
      </div>
      {result.stack_trace_result?.detected_patterns[0] && (
        <div>
          <span className="text-xs text-slate-400">Classified error type: </span>
          <code className="text-xs text-orange-300">{result.stack_trace_result.detected_patterns[0]}</code>
        </div>
      )}
    </div>
  );
}

function TestCasePanel({ result }: { result: FixPipelineResult }) {
  const tc = result.test_case;
  if (!tc) return (
    <div className="text-slate-500 text-xs">
      No automated test case available for this error type. Manual test creation required.
    </div>
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-slate-400 mb-1">Test name:</p>
        <code className="text-xs text-white">{tc.name}</code>
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-1">Description:</p>
        <p className="text-xs text-slate-300">{tc.description}</p>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-slate-400">Generated test skeleton ({tc.framework}):</p>
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-900 text-yellow-300">
            {tc.expected_state.replace(/_/g, ' ')}
          </span>
        </div>
        <CodeBlock code={tc.code} lang="typescript" />
      </div>
    </div>
  );
}

function PatchPanel({ result }: { result: FixPipelineResult }) {
  const p = result.patch;
  if (!p) return (
    <div className="text-slate-500 text-xs">
      No automated patch available. Manual code review required.
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <code className="text-xs text-indigo-300">{p.target_file}</code>
        <span className="text-xs text-slate-500">→</span>
        <code className="text-xs text-slate-400">{p.target_fn}</code>
        <ConfidenceBadge confidence={p.confidence} />
      </div>
      <p className="text-xs text-slate-300">{p.description}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-red-400 mb-1">❌ Before (buggy):</p>
          <CodeBlock code={p.before_snippet} />
        </div>
        <div>
          <p className="text-xs text-emerald-400 mb-1">✅ After (fixed):</p>
          <CodeBlock code={p.after_snippet} />
        </div>
      </div>
    </div>
  );
}

function PostmortemPanel({ result }: { result: FixPipelineResult }) {
  const pm = result.postmortem;
  if (!pm) return <p className="text-slate-500 text-xs">Postmortem not generated.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="font-semibold text-white text-sm">{pm.title}</h3>
        <SeverityBadge severity={pm.severity} />
        {pm.ai_generated && (
          <span className="text-xs px-2 py-0.5 rounded bg-indigo-900 text-indigo-300">AI-generated</span>
        )}
        <span className={clsx(
          'text-xs px-2 py-0.5 rounded',
          pm.test_result === 'passing' ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300',
        )}>
          tests: {pm.test_result}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: 'Summary', value: pm.summary },
          { label: 'Impact', value: pm.impact },
          { label: 'Root Cause', value: pm.root_cause },
          { label: 'Resolution', value: pm.resolution },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg p-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs text-slate-400 mb-1 font-medium">{label}</p>
            <p className="text-xs text-slate-200 leading-relaxed">{value || '—'}</p>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {pm.timeline?.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-2 font-medium">Timeline</p>
          <div className="space-y-1.5">
            {pm.timeline.map((t, i) => (
              <div key={i} className="flex gap-3 text-xs">
                <span className="text-slate-500 w-24 shrink-0 font-mono">{t.time}</span>
                <span className="text-slate-300">{t.event}</span>
                <span className="text-slate-500 ml-auto shrink-0">{t.actor}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contributing factors */}
      {pm.contributing_factors?.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-2 font-medium">Contributing Factors</p>
          <ul className="list-disc list-inside space-y-1">
            {pm.contributing_factors.map((f, i) => (
              <li key={i} className="text-xs text-slate-300">{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action items */}
      {pm.action_items?.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-2 font-medium">Action Items</p>
          <div className="space-y-1.5">
            {pm.action_items.map((ai) => (
              <div key={ai.id} className="flex items-start gap-3 text-xs p-2 rounded" style={{ background: 'var(--color-surface)' }}>
                <code className="text-indigo-400 shrink-0 w-16">{ai.id}</code>
                <span className="text-slate-200 flex-1">{ai.title}</span>
                <span className="text-slate-500 shrink-0">{ai.due_date}</span>
                <span className="text-xs px-1.5 rounded bg-slate-700 text-slate-400">{ai.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pm.lessons_learned && (
        <div className="rounded-lg p-3 border-l-2 border-indigo-500" style={{ background: 'var(--color-surface)' }}>
          <p className="text-xs text-slate-400 mb-1 font-medium">Lessons Learned</p>
          <p className="text-xs text-slate-200 leading-relaxed">{pm.lessons_learned}</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

const PHASES = ['parse', 'locate', 'generate_test', 'patch', 'postmortem'];

export default function FixHubPage() {
  const [mode, setMode] = useState<'fixture' | 'custom'>('fixture');
  const [selectedFixture, setSelectedFixture] = useState<string>('');
  const [customTitle, setCustomTitle] = useState('');
  const [customSeverity, setCustomSeverity] = useState('high');
  const [customStack, setCustomStack] = useState('');
  const [customLogs, setCustomLogs] = useState('');
  const [result, setResult] = useState<FixPipelineResult | null>(null);

  const { data: fixturesData } = useQuery({
    queryKey: ['fix-hub-fixtures'],
    queryFn: () => incidentApi.get('/api/fix-hub/fixtures').then(r => r.data),
  });
  const fixtures: Fixture[] = fixturesData?.data ?? [];

  const runMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'fixture') {
        const res = await incidentApi.post(`/api/fix-hub/analyze/fixture/${selectedFixture}`);
        return res.data.data as FixPipelineResult;
      } else {
        const res = await incidentApi.post('/api/fix-hub/analyze', {
          title: customTitle || 'Custom incident',
          severity: customSeverity,
          stack_trace: customStack,
          log_lines: customLogs.split('\n').filter(Boolean),
          persist_postmortem: true,
        });
        return res.data.data as FixPipelineResult;
      }
    },
    onSuccess: (data) => setResult(data),
  });

  const canRun = mode === 'fixture' ? !!selectedFixture : !!customStack.trim();

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Fix Hub</h1>
        <p className="text-slate-400 text-sm mt-1">
          Autonomous incident resolution — parse stack trace → locate bug → generate test → patch → postmortem
        </p>
      </div>

      {/* Phase pipeline visual */}
      <div
        className="rounded-xl border p-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {PHASES.map((phase, i) => (
            <div key={phase} className="flex items-center gap-2">
              <PhaseIcon
                phase={phase}
                current={result?.phase_completed ?? ''}
                completed={result?.phase_completed === 'complete'}
              />
              {i < PHASES.length - 1 && (
                <ChevronRight size={12} className="text-slate-600" />
              )}
            </div>
          ))}
          {result?.phase_completed === 'complete' && (
            <span className="ml-2 text-xs text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle size={12} /> Pipeline complete
            </span>
          )}
          {result?.phase_completed === 'failed' && (
            <span className="ml-2 text-xs text-red-400 font-medium flex items-center gap-1">
              <XCircle size={12} /> {result.error}
            </span>
          )}
        </div>
      </div>

      {/* Input panel */}
      <div
        className="rounded-xl border p-5 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Mode toggle */}
        <div className="flex gap-2">
          {(['fixture', 'custom'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                mode === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white',
              )}
              style={mode !== m ? { background: 'var(--color-bg)', border: '1px solid var(--color-border)' } : {}}
            >
              {m === 'fixture' ? '📦 Built-in Fixtures' : '✏️ Custom Stack Trace'}
            </button>
          ))}
        </div>

        {mode === 'fixture' ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Select an incident scenario to analyze:</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {fixtures.map((f) => (
                <button
                  key={f.fixture_key}
                  onClick={() => setSelectedFixture(f.fixture_key)}
                  className={clsx(
                    'text-left p-3 rounded-lg border text-xs transition-all',
                    selectedFixture === f.fixture_key
                      ? 'border-indigo-500 bg-indigo-900/30'
                      : 'hover:border-slate-500',
                  )}
                  style={selectedFixture !== f.fixture_key ? { borderColor: 'var(--color-border)', background: 'var(--color-bg)' } : {}}
                >
                  <div className="flex items-center justify-between mb-2">
                    <SeverityBadge severity={f.severity} />
                    {selectedFixture === f.fixture_key && <Check size={12} className="text-indigo-400" />}
                  </div>
                  <p className="font-medium text-white text-xs leading-tight">{f.title}</p>
                  <p className="text-slate-500 mt-1">{f.fixture_key.replace(/_/g, ' ')}</p>
                </button>
              ))}
              {fixtures.length === 0 && (
                <div className="col-span-3 text-slate-500 text-xs py-4 text-center">
                  Loading fixtures… (is incident-manager running?)
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Incident Title</label>
                <input
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-transparent border focus:outline-none focus:border-indigo-500"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                  placeholder="e.g. TypeError in /api/orders"
                  value={customTitle}
                  onChange={e => setCustomTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Severity</label>
                <select
                  className="w-full px-3 py-2 rounded-lg text-sm text-white border focus:outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
                  value={customSeverity}
                  onChange={e => setCustomSeverity(e.target.value)}
                >
                  {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Stack Trace *</label>
              <textarea
                rows={8}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono text-slate-200 border focus:outline-none focus:border-indigo-500 resize-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
                placeholder={"TypeError: Cannot read properties of null (reading 'notify')\n    at /app/src/routes/orders.ts:142\n    at Layer.handle ..."}
                value={customStack}
                onChange={e => setCustomStack(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Log Lines (one per line, optional)</label>
              <textarea
                rows={4}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono text-slate-200 border focus:outline-none focus:border-indigo-500 resize-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
                placeholder={'{"level":"error","msg":"..."}'}
                value={customLogs}
                onChange={e => setCustomLogs(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => runMutation.mutate()}
            disabled={!canRun || runMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {runMutation.isPending ? (
              <><Loader size={14} className="animate-spin" /> Running pipeline…</>
            ) : (
              <><Play size={14} /> Run Fix Pipeline</>
            )}
          </button>
          {result && (
            <button
              onClick={() => setResult(null)}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Clear results
            </button>
          )}
        </div>

        {runMutation.isError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-900/30 border border-red-800 text-xs text-red-300">
            <AlertTriangle size={14} />
            {String((runMutation.error as any)?.response?.data?.detail ?? (runMutation.error as Error)?.message ?? 'Pipeline error')}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white">
            Pipeline Results
            <span className="ml-2 text-xs text-slate-400 font-normal">
              {result.completed_at && `completed in ${Math.round((new Date(result.completed_at).getTime() - new Date(result.started_at).getTime()) / 10) / 100}s`}
            </span>
          </h2>

          <CollapsibleSection
            title="Phase 1 — Parse: Stack Trace Analysis"
            icon={<Bug size={14} className="text-red-400" />}
            defaultOpen={true}
          >
            <ParsePanel result={result} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Phase 2 — Locate: Suspect Files"
            icon={<Search size={14} className="text-yellow-400" />}
            defaultOpen={true}
          >
            <LocatePanel result={result} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Phase 3 — Generate: Failing Test Case"
            icon={<TestTube size={14} className="text-blue-400" />}
            defaultOpen={true}
          >
            <TestCasePanel result={result} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Phase 4 — Patch: Minimal Code Fix"
            icon={<Wrench size={14} className="text-emerald-400" />}
            defaultOpen={true}
          >
            <PatchPanel result={result} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Phase 5 — Postmortem: SRE Report with RCA"
            icon={<FileText size={14} className="text-indigo-400" />}
            defaultOpen={true}
          >
            <PostmortemPanel result={result} />
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
