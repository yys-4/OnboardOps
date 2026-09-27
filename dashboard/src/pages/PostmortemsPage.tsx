import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { incidentApi } from '@/lib/api';
import { FileText, Wand2, RefreshCw } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-slate-700 text-slate-300',
  review:    'bg-blue-900 text-blue-300',
  approved:  'bg-indigo-900 text-indigo-300',
  published: 'bg-green-900 text-green-300',
};

export default function PostmortemsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: list } = useQuery({
    queryKey: ['postmortems'],
    queryFn: () => incidentApi.get('/api/postmortems/').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const { data: incidents } = useQuery({
    queryKey: ['incidents-all'],
    queryFn: () => incidentApi.get('/api/incidents/?limit=100').then(r => r.data.data),
  });

  const selectedPm = list?.find((p: any) => p.id === selected);

  const createMutation = useMutation({
    mutationFn: (incident_id: string) =>
      incidentApi.post('/api/postmortems/', { incident_id, auto_generate: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['postmortems'] }),
  });

  const regenMutation = useMutation({
    mutationFn: (id: string) => incidentApi.post(`/api/postmortems/${id}/regenerate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['postmortems'] }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      incidentApi.patch(`/api/postmortems/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['postmortems'] }),
  });

  return (
    <div className="flex gap-5 h-full max-w-6xl" style={{ maxHeight: 'calc(100vh - 80px)' }}>
      {/* List pane */}
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Postmortems</h1>
          <p className="text-slate-400 text-xs mt-1">{list?.length ?? 0} documents</p>
        </div>

        {/* Generate from incident */}
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <p className="text-xs text-slate-400 font-medium">Generate from incident</p>
          <select
            className="w-full text-xs rounded px-2 py-1.5 text-slate-300"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            onChange={(e) => { if (e.target.value) createMutation.mutate(e.target.value); e.target.value = ''; }}
          >
            <option value="">— select incident —</option>
            {incidents?.map((inc: any) => (
              <option key={inc.id} value={inc.id}>{inc.title.slice(0, 40)}</option>
            ))}
          </select>
        </div>

        {/* PM list */}
        <div className="overflow-auto flex flex-col gap-1.5">
          {list?.map((pm: any) => (
            <button
              key={pm.id}
              onClick={() => setSelected(pm.id)}
              className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                selected === pm.id ? 'border-indigo-500 bg-indigo-950' : 'hover:border-slate-600'
              }`}
              style={selected !== pm.id ? { background: 'var(--color-surface)', borderColor: 'var(--color-border)' } : {}}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-white truncate max-w-[150px]">{pm.title}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[pm.status]}`}>{pm.status}</span>
              </div>
              <p className="text-xs text-slate-500">{new Date(pm.created_at).toLocaleDateString()}</p>
            </button>
          ))}
          {!list?.length && (
            <p className="text-slate-500 text-xs text-center py-4">No postmortems yet</p>
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div
        className="flex-1 rounded-xl border overflow-auto p-5 space-y-5"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {!selectedPm && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <FileText size={40} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Select a postmortem to view</p>
            </div>
          </div>
        )}

        {selectedPm && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedPm.title}</h2>
                {selectedPm.ai_generated && (
                  <span className="inline-flex items-center gap-1 text-xs text-indigo-400 mt-1">
                    <Wand2 size={12} /> AI Generated
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => regenMutation.mutate(selectedPm.id)}
                  disabled={regenMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white disabled:opacity-50 transition-colors"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                >
                  <RefreshCw size={12} className={regenMutation.isPending ? 'animate-spin' : ''} />
                  Regenerate
                </button>
                <select
                  className="text-xs rounded px-2 py-1.5 text-slate-300"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                  value={selectedPm.status}
                  onChange={(e) => patchMutation.mutate({ id: selectedPm.id, status: e.target.value })}
                >
                  {['draft', 'review', 'approved', 'published'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {(['summary', 'impact', 'root_cause', 'resolution', 'lessons_learned'] as const).map(field => (
              selectedPm[field] && (
                <Section key={field} title={field.replace(/_/g, ' ')} content={selectedPm[field]} />
              )
            ))}

            {selectedPm.timeline?.length > 0 && (
              <div>
                <SectionTitle title="Timeline" />
                <div className="space-y-2 mt-2">
                  {selectedPm.timeline.map((t: any, i: number) => (
                    <div key={i} className="flex gap-3 text-sm">
                      <span className="text-slate-500 shrink-0 font-mono text-xs">{t.time}</span>
                      <span className="text-slate-300">{t.event}</span>
                      {t.actor && <span className="text-slate-500 text-xs">— {t.actor}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedPm.action_items?.length > 0 && (
              <div>
                <SectionTitle title="Action Items" />
                <div className="space-y-1.5 mt-2">
                  {selectedPm.action_items.map((ai: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${ai.status === 'open' ? 'bg-yellow-400' : 'bg-green-400'}`} />
                      <span className="text-slate-300">{ai.title}</span>
                      <span className="text-slate-500 text-xs">— {ai.owner}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider capitalize">{title}</h3>;
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <div className="space-y-1.5">
      <SectionTitle title={title} />
      <p className="text-sm text-slate-300 leading-relaxed">{content}</p>
    </div>
  );
}
