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
} from 'lucide-react';
import { useSettings } from '../hooks/useSettings';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/devices', label: 'Devices', icon: Server },
  { path: '/tunnel-map', label: 'Tunnel Map', icon: Network },
  { path: '/routing', label: 'Routing', icon: Router },
  { path: '/bulk-cli', label: 'Bulk CLI', icon: Terminal },
  { path: '/compliance', label: 'Compliance', icon: ShieldCheck },
  { path: '/backups', label: 'Backups', icon: DatabaseBackup },
  { path: '/monitoring', label: 'Monitoring', icon: Activity },
  { path: '/policies', label: 'Policies', icon: Shield },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  alertCount?: number;
  deviceCount?: number;
}

export default function Sidebar({ collapsed, onToggle, alertCount = 0, deviceCount = 0 }: SidebarProps) {
  const { settings } = useSettings();

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-screen bg-dark-900 border-r border-dark-700/50 flex flex-col z-40 transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div className={clsx('flex items-center h-16 border-b border-dark-700/50 px-4', collapsed ? 'justify-center' : 'gap-3')}>
        <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-base font-bold text-gradient whitespace-nowrap">FMPro</h1>
            <p className="text-[10px] text-slate-500 -mt-0.5">{settings.appName}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg transition-all duration-200 group relative',
                collapsed ? 'justify-center p-2.5 mx-auto w-11' : 'px-3 py-2.5',
                isActive
                  ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-dark-800 border border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={clsx('w-5 h-5 shrink-0', isActive && 'drop-shadow-[0_0_6px_rgba(6,182,212,0.4)]')} />
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                {!collapsed && item.label === 'Devices' && deviceCount > 0 && (
                  <span className="ml-auto text-[10px] bg-dark-700 text-slate-400 px-1.5 py-0.5 rounded-full">{deviceCount}</span>
                )}
                {!collapsed && item.label === 'Alerts' && alertCount > 0 && (
                  <span className="ml-auto text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">{alertCount}</span>
                )}
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-dark-700 text-slate-200 text-xs rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity shadow-lg z-50">
                    {item.label}
                  </div>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-dark-700/50 p-2">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 py-2 text-slate-500 hover:text-slate-300 hover:bg-dark-800 rounded-lg transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
        {!collapsed && (
          <p className="text-[10px] text-slate-600 text-center mt-1">v1.0.0</p>
        )}
      </div>
    </aside>
  );
}
