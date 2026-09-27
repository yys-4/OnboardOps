import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { incidentApi } from '@/lib/api';
import { Plus, RefreshCw, ChevronDown } from 'lucide-react';
import clsx from 'clsx';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high:     'text-orange-400',
  medium:   'text-yellow-400',
  low:      'text-green-400',
};
const STATUS_COLORS: Record<string, string> = {
  open:          'bg-red-900 text-red-300',
  investigating: 'bg-orange-900 text-orange-300',
  mitigated:     'bg-yellow-900 text-yellow-300',
  resolved:      'bg-green-900 text-green-300',
  closed:        'bg-slate-700 text-slate-400',
};

export default function IncidentsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['incidents', statusFilter, severityFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (severityFilter) params.set('severity', severityFilter);
      return incidentApi.get(`/api/incidents/?${params}`).then(r => r.data);
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      incidentApi.patch(`/api/incidents/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
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
          { service: 'postgres', level: 'warn',  message: 'WARN: Connection pool exhausted (15/15)', timestamp: new Date().toISOString() },
        ],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Incidents</h1>
          <p className="text-slate-400 text-sm mt-1">
            {data?.pagination?.total ?? 0} total · {data?.data?.filter((i: any) => i.status === 'open').length ?? 0} open
          </p>
        </div>
        <div className="flex gap-2">
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

      {/* Filters */}
      <div className="flex gap-3">
        {(['', 'open', 'investigating', 'resolved', 'closed'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              statusFilter === s
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white',
            )}
            style={statusFilter !== s ? { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } : {}}
          >
            {s || 'All statuses'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-surface)' }}>
            <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Services</th>
              <th className="px-4 py-3">Detected</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            )}
            {!isLoading && !data?.data?.length && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No incidents found</td></tr>
            )}
            {data?.data?.map((inc: any) => (
              <tr
                key={inc.id}
                style={{ background: 'var(--color-bg)' }}
                className="hover:brightness-110 transition-all"
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{inc.title}</p>
                  {inc.ai_triage_summary && (
                    <p className="text-xs text-slate-500 mt-0.5 max-w-xs truncate">{inc.ai_triage_summary}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`font-medium capitalize ${SEVERITY_COLORS[inc.severity]}`}>{inc.severity}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[inc.status]}`}>
                    {inc.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{inc.affected_services?.join(', ')}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(inc.detected_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <select
                    className="text-xs rounded px-2 py-1 text-slate-300"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                    value={inc.status}
                    onChange={(e) => patchMutation.mutate({ id: inc.id, status: e.target.value })}
                  >
                    {['open', 'investigating', 'mitigated', 'resolved', 'closed'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
