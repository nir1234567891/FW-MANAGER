import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Server,
  Network,
  DatabaseBackup,
  Activity,
  Shield,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Router,
  Terminal,
  ShieldCheck,
  ScrollText,
} from 'lucide-react';
import { useSettings } from '../hooks/useSettings';

interface NavSection {
  label: string;
  items: { path: string; label: string; icon: React.ElementType }[];
}

const navSections: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { path: '/',           label: 'Dashboard',   icon: LayoutDashboard },
      { path: '/devices',    label: 'Devices',     icon: Server },
    ],
  },
  {
    label: 'Network',
    items: [
      { path: '/tunnel-map', label: 'Tunnel Map',  icon: Network },
      { path: '/routing',    label: 'Routing',     icon: Router },
      { path: '/policies',   label: 'Policies',    icon: Shield },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/bulk-cli',   label: 'Bulk CLI',    icon: Terminal },
      { path: '/backups',    label: 'Backups',     icon: DatabaseBackup },
      { path: '/logs',       label: 'Logs',        icon: ScrollText },
    ],
  },
  {
    label: 'Security',
    items: [
      { path: '/compliance', label: 'Compliance',  icon: ShieldCheck },
      { path: '/monitoring', label: 'Monitoring',  icon: Activity },
      { path: '/alerts',     label: 'Alerts',      icon: Bell },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/settings',   label: 'Settings',    icon: Settings },
    ],
  },
];

// Flat list for backward compat (badge lookups)
const allItems = navSections.flatMap((s) => s.items);

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  alertCount?: number;
  deviceCount?: number;
}

export default function Sidebar({ collapsed, onToggle, alertCount = 0, deviceCount = 0 }: SidebarProps) {
  const { settings } = useSettings();
  void allItems; // suppress unused warning

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-screen flex flex-col z-40 transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{
        background: 'linear-gradient(180deg, #0d1526 0%, #0a1020 50%, #060d1a 100%)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '2px 0 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* Brand */}
      <div className={clsx(
        'flex items-center h-16 px-4 shrink-0',
        collapsed ? 'justify-center' : 'gap-3',
      )}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Logo mark with animated ring */}
        <div className="relative shrink-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, var(--accent-light), var(--accent-dark))',
              boxShadow: '0 0 18px var(--accent-glow), 0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            <Shield className="w-5 h-5 text-white" />
          </div>
          {/* Status dot */}
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-dark-950"
            style={{ boxShadow: '0 0 6px #34d399' }}
          />
        </div>

        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-[15px] font-bold text-gradient tracking-wide whitespace-nowrap leading-tight">
              FortiManager Pro
            </h1>
            <p className="text-[10px] text-slate-500 truncate leading-tight">{settings.appName}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5">
        {navSections.map((section, si) => (
          <div key={section.label} className={clsx(si > 0 && 'mt-3')}>
            {/* Section label — hidden when collapsed */}
            {!collapsed && (
              <p className="px-3 mb-1 text-[9px] font-semibold tracking-widest uppercase text-slate-600">
                {section.label}
              </p>
            )}
            {collapsed && si > 0 && (
              <div className="mx-auto mb-1 w-5 h-px bg-dark-700/60" />
            )}

            {section.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center gap-3 rounded-lg transition-all duration-200',
                    collapsed ? 'justify-center p-2.5 mx-auto w-11' : 'px-3 py-2',
                    isActive
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-100'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Active background */}
                    {isActive && (
                      <span
                        className="absolute inset-0 rounded-lg"
                        style={{
                          background: 'linear-gradient(90deg, rgba(var(--accent-rgb)/0.18) 0%, rgba(var(--accent-rgb)/0.06) 100%)',
                          borderLeft: '2px solid var(--accent)',
                          boxShadow: 'inset 0 0 12px rgba(var(--accent-rgb)/0.08)',
                        }}
                      />
                    )}
                    {/* Hover background */}
                    {!isActive && (
                      <span className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/[0.04]" />
                    )}

                    <item.icon
                      className={clsx(
                        'w-4.5 h-4.5 shrink-0 relative z-10 transition-all duration-200',
                        isActive
                          ? 'text-primary-400'
                          : 'text-slate-500 group-hover:text-slate-300'
                      )}
                      style={isActive ? { filter: 'drop-shadow(0 0 6px var(--accent-glow))' } : undefined}
                    />

                    {!collapsed && (
                      <span className="text-[13px] font-medium relative z-10 flex-1">{item.label}</span>
                    )}

                    {/* Badges */}
                    {!collapsed && item.label === 'Devices' && deviceCount > 0 && (
                      <span className="relative z-10 text-[10px] bg-dark-700/80 text-slate-400 px-1.5 py-0.5 rounded-full border border-dark-600/60">
                        {deviceCount}
                      </span>
                    )}
                    {!collapsed && item.label === 'Alerts' && alertCount > 0 && (
                      <span
                        className="relative z-10 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                        style={{
                          background: 'rgba(239,68,68,0.15)',
                          color: '#f87171',
                          border: '1px solid rgba(239,68,68,0.3)',
                          boxShadow: '0 0 8px rgba(239,68,68,0.2)',
                        }}
                      >
                        {alertCount}
                      </span>
                    )}

                    {/* Collapsed tooltip */}
                    {collapsed && (
                      <div
                        className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap
                          opacity-0 pointer-events-none group-hover:opacity-100 transition-all duration-150 z-50
                          translate-x-1 group-hover:translate-x-0"
                        style={{
                          background: '#1e293b',
                          border: '1px solid rgba(255,255,255,0.1)',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                          color: '#e2e8f0',
                        }}
                      >
                        {item.label}
                        {/* Arrow */}
                        <span
                          className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent"
                          style={{ borderRightColor: '#1e293b' }}
                        />
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 p-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={onToggle}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-2 rounded-lg transition-all duration-200 text-slate-600 hover:text-slate-300',
            'hover:bg-white/[0.04]'
          )}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {!collapsed && <span className="text-xs font-medium">Collapse</span>}
        </button>
        {!collapsed && (
          <p className="text-[9px] text-slate-700 text-center mt-1 font-mono tracking-wider">v1.0.0 · FMPro</p>
        )}
      </div>
    </aside>
  );
}
