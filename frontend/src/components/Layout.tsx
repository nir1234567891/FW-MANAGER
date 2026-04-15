import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, User, X, Settings, LogOut } from 'lucide-react';
import { clsx } from 'clsx';
import Sidebar from './Sidebar';
import { useSettings } from '../hooks/useSettings';
import { useScope } from '../hooks/useScope';
import { monitoringService, deviceService } from '../services/api';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/devices': 'Devices',
  '/tunnel-map': 'Tunnel Map',
  '/routing': 'Network',
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
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [deviceCount, setDeviceCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const pageTitle = pageTitles[location.pathname] || settings.appName;

  useEffect(() => {
    monitoringService.getAlerts({ acknowledged: false })
      .then((res) => {
        if (Array.isArray(res.data)) setAlertCount(res.data.length);
      })
      .catch(() => {});
    deviceService.getAll()
      .then((res) => {
        if (Array.isArray(res.data)) setDeviceCount(res.data.length);
      })
      .catch(() => {});
  }, [location.pathname]);

  // Search functionality
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const results: any[] = [];
    const lowerQuery = query.toLowerCase();

    // Search in devices
    devices.forEach((device) => {
      if (device.name.toLowerCase().includes(lowerQuery) ||
          device.ip_address?.includes(query) ||
          device.model?.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'Device',
          name: device.name,
          subtitle: `${device.ip_address} - ${device.model}`,
          action: () => navigate('/devices'),
        });
      }
    });

    // Mock search for other items (you can extend with API calls)
    if ('tunnel'.includes(lowerQuery) || 'vpn'.includes(lowerQuery)) {
      results.push({
        type: 'VPN',
        name: 'VPN Tunnels',
        subtitle: 'View tunnel topology map',
        action: () => navigate('/tunnel-map'),
      });
    }

    if ('policy'.includes(lowerQuery) || 'firewall'.includes(lowerQuery)) {
      results.push({
        type: 'Policy',
        name: 'Firewall Policies',
        subtitle: 'Manage firewall rules',
        action: () => navigate('/policies'),
      });
    }

    if ('backup'.includes(lowerQuery)) {
      results.push({
        type: 'Backup',
        name: 'Configuration Backups',
        subtitle: 'View and manage backups',
        action: () => navigate('/backups'),
      });
    }

    if ('monitor'.includes(lowerQuery) || 'dashboard'.includes(lowerQuery)) {
      results.push({
        type: 'Monitor',
        name: 'Monitoring Dashboard',
        subtitle: 'Real-time metrics and charts',
        action: () => navigate('/monitoring'),
      });
    }

    setSearchResults(results.slice(0, 8));
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Keyboard shortcut: Ctrl+K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-dark-950">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        alertCount={alertCount}
        deviceCount={deviceCount}
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
              <div className="relative flex items-center gap-2 animate-fade-in">
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') closeSearch();
                    if (e.key === 'Enter' && searchResults[0]) {
                      searchResults[0].action();
                      closeSearch();
                    }
                  }}
                  placeholder="Search devices, tunnels, policies..."
                  className="w-72 px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-primary-500"
                />
                <button
                  onClick={closeSearch}
                  className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-dark-800"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Search Results Dropdown */}
                {searchResults.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={closeSearch} />
                    <div className="absolute top-full right-0 mt-2 w-96 bg-dark-800 border border-dark-700 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
                      <div className="px-3 py-2 border-b border-dark-700">
                        <p className="text-xs text-slate-400">
                          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
                        </p>
                      </div>
                      {searchResults.map((result, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            result.action();
                            closeSearch();
                          }}
                          className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-dark-700 transition-colors text-left"
                        >
                          <div className="mt-0.5 px-2 py-0.5 bg-primary-500/20 text-primary-400 text-xs rounded font-medium">
                            {result.type}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-200 truncate">{result.name}</p>
                            <p className="text-xs text-slate-400 truncate">{result.subtitle}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-dark-800 rounded-lg transition-colors"
                title="Search (Ctrl+K)"
              >
                <Search className="w-5 h-5" />
              </button>
            )}

            <button
              onClick={() => navigate('/alerts')}
              className="relative p-2 text-slate-400 hover:text-slate-200 hover:bg-dark-800 rounded-lg transition-colors"
              title="View Alerts"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>

            <div className="w-px h-8 bg-dark-700" />

            <div className="relative">
              <button
                onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                className="flex items-center gap-2 p-1.5 hover:bg-dark-800 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm text-slate-300 hidden lg:block">Admin</span>
              </button>

              {adminMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAdminMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-dark-800 border border-dark-700 rounded-lg shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-dark-700">
                      <p className="text-sm font-medium text-slate-200">Admin User</p>
                      <p className="text-xs text-slate-400">admin@fortimanager.local</p>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={() => {
                          navigate('/settings');
                          setAdminMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:bg-dark-700 transition-colors"
                      >
                        <Settings className="w-4 h-4" />
                        Settings
                      </button>
                      <button
                        onClick={() => {
                          setAdminMenuOpen(false);
                          alert('Logout functionality would go here');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-dark-700 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
