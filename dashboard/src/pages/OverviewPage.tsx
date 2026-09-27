import { useQuery } from '@tanstack/react-query';
import { incidentApi, backendApi } from '@/lib/api';
import { AlertTriangle, CheckCircle, Activity, TrendingUp } from 'lucide-react';

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon: React.FC<any>; color: string;
}) {
  return (
    <div
      className="rounded-xl border p-5 flex items-center gap-4"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-slate-400">{label}</p>
      </div>
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

export default function OverviewPage() {
  const { data: stats } = useQuery({
    queryKey: ['incident-stats'],
    queryFn: () => incidentApi.get('/api/incidents/stats/summary').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const { data: incidents } = useQuery({
    queryKey: ['incidents-recent'],
    queryFn: () => incidentApi.get('/api/incidents/?limit=5').then(r => r.data),
    refetchInterval: 30_000,
  });

  const { data: health } = useQuery({
    queryKey: ['backend-health'],
    queryFn: () => backendApi.get('/health').then(r => r.data),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-slate-400 text-sm mt-1">Platform health at a glance</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open Incidents" value={stats?.open ?? '—'} icon={AlertTriangle} color="bg-red-600" />
        <StatCard label="Resolved (all time)" value={stats?.resolved ?? '—'} icon={CheckCircle} color="bg-emerald-600" />
        <StatCard label="Critical" value={stats?.critical ?? '—'} icon={Activity} color="bg-orange-600" />
        <StatCard label="Total Incidents" value={stats?.total ?? '—'} icon={TrendingUp} color="bg-indigo-600" />
      </div>

      {/* Service health */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <h2 className="font-semibold text-white mb-3">Service Health</h2>
        <div className="flex gap-3 flex-wrap">
          {['backend', 'incident-manager', 'postgres', 'redis'].map(svc => (
            <div
              key={svc}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: health?.status === 'healthy' ? '#22c55e' : '#ef4444' }}
              />
              <span className="text-slate-300">{svc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent incidents */}
      <div
        className="rounded-xl border"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="font-semibold text-white">Recent Incidents</h2>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {incidents?.data?.length
            ? incidents.data.map((inc: any) => (
                <div key={inc.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{inc.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {inc.affected_services?.join(', ')} · {new Date(inc.detected_at).toLocaleString()}
                    </p>
                  </div>
                  <SeverityBadge severity={inc.severity} />
                </div>
              ))
            : <p className="px-5 py-6 text-slate-500 text-sm text-center">No incidents found</p>
          }
        </div>
      </div>
    </div>
  );
}
