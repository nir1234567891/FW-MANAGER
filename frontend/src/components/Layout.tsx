import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Search, Bell, User, X } from 'lucide-react';
import { clsx } from 'clsx';
import Sidebar from './Sidebar';
import { useSettings } from '../hooks/useSettings';
import { useScope } from '../hooks/useScope';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/devices': 'Devices',
  '/tunnel-map': 'Tunnel Map',
  '/routing': 'Routing & Interfaces',
  '/bulk-cli': 'Bulk CLI Commander',
  '/compliance': 'Compliance & Health',
  '/backups': 'Backups',
  '/monitoring': 'Monitoring',
  '/policies': 'Policies',
  '/alerts': 'Alerts',
  '/settings': 'Settings',
};

export default function Layout() {
  const { settings } = useSettings();
  const { scope, setDeviceId, setVdom, devices, availableVdoms } = useScope();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const location = useLocation();
  const pageTitle = pageTitles[location.pathname] || settings.appName;

  return (
    <div className="min-h-screen bg-dark-950">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        alertCount={5}
        deviceCount={6}
      />

      <div className={clsx('transition-all duration-300', sidebarCollapsed ? 'ml-16' : 'ml-60')}>
        <header className="sticky top-0 z-30 h-16 border-b border-dark-700/50 bg-dark-900/80 backdrop-blur-md flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-slate-100">{pageTitle}</h2>
            <div className="hidden xl:flex items-center gap-2">
              <select
                value={scope.deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="input-dark !py-1.5 !px-2.5 !text-xs w-auto min-w-[160px]"
                title="Global firewall scope"
              >
                <option value="all">All Firewalls</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                value={scope.vdom}
                onChange={(e) => setVdom(e.target.value)}
                className="input-dark !py-1.5 !px-2.5 !text-xs w-auto min-w-[120px]"
                title="Global VDOM scope"
              >
                {availableVdoms.map((v) => (
                  <option key={v} value={v}>{v === 'all' ? 'All VDOMs' : v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {searchOpen ? (
              <div className="flex items-center gap-2 animate-fade-in">
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search devices, tunnels, policies..."
                  className="w-72 px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500"
                />
                <button
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                  className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-dark-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-dark-800 rounded-lg transition-colors"
              >
                <Search className="w-5 h-5" />
              </button>
            )}

            <button className="relative p-2 text-slate-400 hover:text-slate-200 hover:bg-dark-800 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>

            <div className="w-px h-8 bg-dark-700" />

            <button className="flex items-center gap-2 p-1.5 hover:bg-dark-800 rounded-lg transition-colors">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm text-slate-300 hidden lg:block">Admin</span>
            </button>
          </div>
        </header>

        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
