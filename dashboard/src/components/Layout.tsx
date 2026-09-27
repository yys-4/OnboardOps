import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, AlertTriangle, FileText, Network, FlaskConical, Zap, Wrench,
  Compass, Radio,
} from 'lucide-react';
import clsx from 'clsx';

const NAV_PRIMARY = [
  { to: '/onboarding',   icon: Compass,         label: 'Onboarding Explorer', highlight: true },
  { to: '/incident-hub', icon: Radio,           label: 'Incident Response Hub', highlight: true },
];

const NAV_SECONDARY = [
  { to: '/overview',      icon: LayoutDashboard, label: 'Overview' },
  { to: '/incidents',     icon: AlertTriangle,   label: 'Incidents' },
  { to: '/postmortems',   icon: FileText,        label: 'Postmortems' },
  { to: '/architecture',  icon: Network,         label: 'Architecture' },
  { to: '/error-lab',     icon: FlaskConical,    label: 'Error Lab' },
  { to: '/fix-hub',       icon: Wrench,          label: 'Fix Hub' },
];

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <nav
        className="flex flex-col w-58 shrink-0 border-r py-6 px-3 gap-1"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: 224 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-3 mb-5">
          <Zap size={20} className="text-indigo-400" />
          <span className="font-bold text-sm tracking-wide text-white">OnboardOps</span>
        </div>

        {/* Primary nav — new tabs */}
        <div className="space-y-1 mb-3">
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">New</p>
          {NAV_PRIMARY.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'bg-indigo-900/20 text-indigo-300 hover:bg-indigo-900/40 hover:text-white border border-indigo-900/40',
                )
              }
            >
              <Icon size={16} />
              <span className="leading-tight text-xs">{label}</span>
            </NavLink>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t mb-3" style={{ borderColor: 'var(--color-border)' }} />

        {/* Secondary nav */}
        {NAV_SECONDARY.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-700 hover:text-white',
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}

        {/* Bottom status dot */}
        <div className="mt-auto px-3 flex items-center gap-2 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          All systems nominal
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
