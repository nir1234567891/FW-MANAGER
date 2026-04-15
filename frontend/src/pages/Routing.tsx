import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Network, Search, CheckCircle2, XCircle, ArrowRightLeft, Router,
  Info, ChevronDown, ChevronRight, Monitor, RefreshCw, Globe, Loader2,
  Wifi, WifiOff, Cable, Cpu,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useScope } from '@/hooks/useScope';
import { deviceService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';
import { useToast } from '@/components/Toast';

type SubTab = 'interfaces' | 'routes' | 'bgp-ospf';
type ProtocolType = 'bgp' | 'ospf';
type NeighborState = 'established' | 'active' | 'idle' | 'connect' | 'opensent' | 'openconfirm' | 'full' | 'loading' | '2-way' | 'down';

interface BGPNeighbor {
  id: string;
  device_id: string;
  device_name: string;
  vdom: string;
  neighbor_ip: string;
  remote_as: number;
  local_as: number;
  state: NeighborState;
  uptime: string;
  prefixes_received: number;
  prefixes_sent: number;
  description: string;
}

interface OSPFNeighbor {
  id: string;
  device_id: string;
  device_name: string;
  vdom: string;
  neighbor_id: string;
  neighbor_ip: string;
  area: string;
  state: NeighborState;
  interface_name: string;
  priority: number;
  dead_timer: string;
  uptime: string;
}

interface InterfaceRow {
  name: string;
  ip: string;
  netmask: string;
  status: 'up' | 'down';
  type: string;
  role: string;
  vdom: string;
  speed: string;
  mtu: number;
  description: string;
  allowaccess: string[];
  parent_interface: string;
  vlan_id: number;
}

interface RouteRow {
  type: string;
  ip_mask: string;
  gateway: string;
  interface: string;
  distance: number;
  metric: number;
}

interface DeviceInfo {
  id: string;
  name: string;
  vdoms: string[];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function isNeighborUp(state: NeighborState): boolean {
  return state === 'established' || state === 'full';
}

function stateColor(state: NeighborState): string {
  if (state === 'established' || state === 'full') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
  if (state === '2-way' || state === 'loading' || state === 'openconfirm' || state === 'opensent') return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
  return 'text-red-400 bg-red-400/10 border-red-400/30';
}

function routeTypeColor(type: string): string {
  switch (type) {
    case 'connect': return 'text-emerald-400 bg-emerald-400/10';
    case 'static': return 'text-blue-400 bg-blue-400/10';
    case 'bgp': return 'text-purple-400 bg-purple-400/10';
    case 'ospf': return 'text-cyan-400 bg-cyan-400/10';
    case 'rip': return 'text-amber-400 bg-amber-400/10';
    case 'kernel': return 'text-slate-400 bg-slate-400/10';
    default: return 'text-slate-400 bg-slate-400/10';
  }
}

function ifaceTypeIcon(type: string) {
  switch (type) {
    case 'physical': case 'hard-switch': return Cable;
    case 'tunnel': return Globe;
    case 'vlan': return Network;
    case 'loopback': return Cpu;
    default: return Network;
  }
}

const subTabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
  { key: 'interfaces', label: 'Interfaces', icon: Cable },
  { key: 'routes', label: 'Routing Table', icon: Globe },
  { key: 'bgp-ospf', label: 'BGP / OSPF', icon: ArrowRightLeft },
];

export default function Routing() {
  const { scope } = useScope();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<SubTab>('interfaces');
  const [protocol, setProtocol] = useState<ProtocolType>('bgp');
  const [search, setSearch] = useState('');
  const [routeSearch, setRouteSearch] = useState('');
  const [routeTypeFilter, setRouteTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const [realDevices, setRealDevices] = useState<DeviceInfo[]>([]);
  const [interfaces, setInterfaces] = useState<Record<string, InterfaceRow[]>>({});
  const [routes, setRoutes] = useState<Record<string, RouteRow[]>>({});
  const [bgpNeighbors, setBgpNeighbors] = useState<BGPNeighbor[]>([]);
  const [ospfNeighbors, setOspfNeighbors] = useState<OSPFNeighbor[]>([]);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await deviceService.getAll();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = res.data as any[];
      if (!Array.isArray(list) || list.length === 0) { setLoading(false); return; }

      const devs: DeviceInfo[] = list.map((d) => {
        const dev = mapBackendDevice(d);
        return { id: dev.id, name: dev.name, vdoms: Array.isArray(d.vdom_list) ? d.vdom_list : ['root'] };
      });
      setRealDevices(devs);

      const ifaceMap: Record<string, InterfaceRow[]> = {};
      const routeMap: Record<string, RouteRow[]> = {};
      const bgpAll: BGPNeighbor[] = [];
      const ospfAll: OSPFNeighbor[] = [];

      await Promise.allSettled(devs.map(async (dev) => {
        // Interfaces
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ifaceRes = await deviceService.getInterfaces(dev.id) as any;
          const data = ifaceRes.data;
          const ifaces = data?.interfaces ?? data;
          if (Array.isArray(ifaces)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ifaceMap[dev.id] = ifaces.map((i: any): InterfaceRow => ({
              name: i.name || '',
              ip: i.ip_address || '',
              netmask: i.netmask || '',
              status: i.status === 'up' ? 'up' : 'down',
              type: i.type || 'physical',
              role: i.role || 'undefined',
              vdom: i.vdom || 'root',
              speed: i.speed || 'auto',
              mtu: i.mtu || 1500,
              description: i.description || i.alias || '',
              allowaccess: Array.isArray(i.allowaccess) ? i.allowaccess : [],
              parent_interface: i.parent_interface || '',
              vlan_id: i.vlan_id || 0,
            }));
          }
        } catch { /* skip */ }

        // Routes
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const routeRes = await deviceService.getRoutes(dev.id) as any;
          const data = routeRes.data;
          const rts = data?.routes ?? data;
          if (Array.isArray(rts)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            routeMap[dev.id] = rts.map((r: any): RouteRow => ({
              type: r.type || 'unknown',
              ip_mask: r.ip_mask || '',
              gateway: r.gateway || '0.0.0.0',
              interface: r.interface || '',
              distance: r.distance || 0,
              metric: r.metric || 0,
            }));
          }
        } catch { /* skip */ }

        // BGP
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bgpRes = await deviceService.getBgpNeighbors(dev.id) as any;
          const neighbors = bgpRes.data?.bgp_neighbors || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          neighbors.forEach((n: any, i: number) => {
            bgpAll.push({
              id: `bgp-${dev.id}-${i}`,
              device_id: dev.id,
              device_name: dev.name,
              vdom: n.vdom || 'root',
              neighbor_ip: n.neighbor_ip || '',
              remote_as: n.remote_as || 0,
              local_as: n.local_as || 0,
              state: (n.state || 'down').toLowerCase() as NeighborState,
              uptime: n.uptime || '—',
              prefixes_received: n.prefixes_received || 0,
              prefixes_sent: n.prefixes_sent || 0,
              description: n.description || '',
            });
          });
        } catch { /* skip */ }

        // OSPF
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ospfRes = await deviceService.getOspfNeighbors(dev.id) as any;
          const neighbors = ospfRes.data?.ospf_neighbors || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          neighbors.forEach((n: any, i: number) => {
            ospfAll.push({
              id: `ospf-${dev.id}-${i}`,
              device_id: dev.id,
              device_name: dev.name,
              vdom: n.vdom || 'root',
              neighbor_id: n.router_id || n.neighbor_ip || '',
              neighbor_ip: n.neighbor_ip || '',
              area: n.area || '0.0.0.0',
              state: (n.state || 'down').toLowerCase() as NeighborState,
              interface_name: n.interface_name || '',
              priority: n.priority || 0,
              dead_timer: n.dead_timer || '—',
              uptime: n.uptime || '—',
            });
          });
        } catch { /* skip */ }
      }));

      setInterfaces(ifaceMap);
      setRoutes(routeMap);
      setBgpNeighbors(bgpAll);
      setOspfNeighbors(ospfAll);
    } catch {
      addToast('error', 'Failed to load network data');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const deviceId = scope.deviceId;
  const vdom = scope.vdom;

  const filteredDevices = useMemo(() => (
    deviceId === 'all' ? realDevices : realDevices.filter((d) => d.id === deviceId)
  ), [deviceId, realDevices]);

  // Aggregate interface stats
  const ifaceStats = useMemo(() => {
    let total = 0, up = 0, down = 0, physical = 0, vlanCount = 0, tunnel = 0;
    for (const dev of filteredDevices) {
      const ifaces = interfaces[dev.id] || [];
      for (const i of ifaces) {
        total++;
        if (i.status === 'up') up++; else down++;
        if (i.type === 'physical' || i.type === 'hard-switch') physical++;
        else if (i.type === 'vlan') vlanCount++;
        else if (i.type === 'tunnel') tunnel++;
      }
    }
    return { total, up, down, physical, vlan: vlanCount, tunnel };
  }, [filteredDevices, interfaces]);

  // Aggregate route stats
  const routeStats = useMemo(() => {
    const byType: Record<string, number> = {};
    let total = 0;
    for (const dev of filteredDevices) {
      const rts = routes[dev.id] || [];
      for (const r of rts) {
        total++;
        byType[r.type] = (byType[r.type] || 0) + 1;
      }
    }
    return { total, byType };
  }, [filteredDevices, routes]);

  // All unique route types across all filtered devices
  const allRouteTypes = useMemo(() => {
    const types = new Set<string>();
    for (const dev of filteredDevices) {
      for (const r of routes[dev.id] || []) types.add(r.type);
    }
    return Array.from(types).sort();
  }, [filteredDevices, routes]);

  const bgpFiltered = useMemo(() => {
    const q = search.toLowerCase();
    return bgpNeighbors.filter((n) => {
      const devMatch = deviceId === 'all' || n.device_id === deviceId;
      const vdomMatch = vdom === 'all' || n.vdom === vdom;
      const textMatch = !q || n.neighbor_ip.includes(q) || n.description.toLowerCase().includes(q) || n.device_name.toLowerCase().includes(q);
      return devMatch && vdomMatch && textMatch;
    });
  }, [deviceId, vdom, search, bgpNeighbors]);

  const ospfFiltered = useMemo(() => {
    const q = search.toLowerCase();
    return ospfNeighbors.filter((n) => {
      const devMatch = deviceId === 'all' || n.device_id === deviceId;
      const vdomMatch = vdom === 'all' || n.vdom === vdom;
      const textMatch = !q || n.neighbor_ip.includes(q) || n.neighbor_id.includes(q) || n.device_name.toLowerCase().includes(q);
      return devMatch && vdomMatch && textMatch;
    });
  }, [deviceId, vdom, search, ospfNeighbors]);

  const bgpUp = bgpFiltered.filter((n) => isNeighborUp(n.state)).length;
  const ospfUp = ospfFiltered.filter((n) => isNeighborUp(n.state)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Smart Tab Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-dark-800/50 rounded-lg border border-dark-700 p-1">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                  activeTab === tab.key
                    ? 'bg-primary-500/15 text-primary-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-dark-700/50'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'bgp-ospf' && (
            <div className="relative max-w-xs w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search neighbors..."
                className="input-dark pl-9 w-full"
              />
            </div>
          )}
          <button onClick={loadData} disabled={loading} className="btn-secondary text-sm">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {/* ==================== INTERFACES TAB ==================== */}
      {activeTab === 'interfaces' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="glass-card p-3 text-center">
              <p className="text-xl font-bold text-slate-100">{ifaceStats.total}</p>
              <p className="text-[10px] text-slate-400 uppercase">Total</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xl font-bold text-emerald-400">{ifaceStats.up}</p>
              <p className="text-[10px] text-slate-400 uppercase">Up</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xl font-bold text-red-400">{ifaceStats.down}</p>
              <p className="text-[10px] text-slate-400 uppercase">Down</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xl font-bold text-blue-400">{ifaceStats.physical}</p>
              <p className="text-[10px] text-slate-400 uppercase">Physical</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xl font-bold text-purple-400">{ifaceStats.vlan}</p>
              <p className="text-[10px] text-slate-400 uppercase">VLAN</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xl font-bold text-cyan-400">{ifaceStats.tunnel}</p>
              <p className="text-[10px] text-slate-400 uppercase">Tunnel</p>
            </div>
          </div>

          {filteredDevices.map((dev) => {
            const ifaces = interfaces[dev.id] || [];
            if (ifaces.length === 0) return null;
            const isExpanded = expandedDevice === dev.id || deviceId !== 'all';
            const upCount = ifaces.filter((i) => i.status === 'up').length;

            return (
              <div key={dev.id} className="glass-card overflow-hidden">
                <button
                  onClick={() => setExpandedDevice(expandedDevice === dev.id ? null : dev.id)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-dark-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Monitor className="w-4 h-4 text-primary-400" />
                    <span className="text-sm font-semibold text-slate-100">{dev.name}</span>
                    <span className="text-xs text-slate-500">{ifaces.length} interfaces</span>
                    <span className="text-xs text-emerald-400">{upCount} up</span>
                    <span className="text-xs text-red-400">{ifaces.length - upCount} down</span>
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </button>
                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-t border-dark-700 text-left">
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Name</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">IP Address</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Status</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Type</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Role</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">VDOM</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Speed</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Access</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ifaces.map((iface) => {
                          const Icon = ifaceTypeIcon(iface.type);
                          return (
                            <tr key={iface.name} className="border-t border-dark-700/50 table-row-hover">
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <Icon className="w-3.5 h-3.5 text-slate-500" />
                                  <span className="font-mono text-xs text-slate-200">{iface.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-slate-300">
                                {iface.ip ? `${iface.ip}` : '—'}
                              </td>
                              <td className="px-4 py-2">
                                <span className={clsx(
                                  'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                                  iface.status === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'
                                )}>
                                  {iface.status === 'up' ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                                  {iface.status}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-400">{iface.type}</td>
                              <td className="px-4 py-2 text-xs text-slate-400">{iface.role !== 'undefined' ? iface.role : '—'}</td>
                              <td className="px-4 py-2 text-xs text-primary-400">{iface.vdom}</td>
                              <td className="px-4 py-2 text-xs text-slate-400">{iface.speed}</td>
                              <td className="px-4 py-2">
                                <div className="flex flex-wrap gap-0.5">
                                  {iface.allowaccess.map((a) => (
                                    <span key={a} className="text-[9px] px-1 py-0.5 bg-dark-700 text-slate-400 rounded">{a}</span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-500 max-w-[160px] truncate">{iface.description || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {filteredDevices.length === 0 && (
            <div className="glass-card p-12 text-center text-slate-500">
              <Network className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              <p>No devices found. Select a device from the scope selector.</p>
            </div>
          )}
        </>
      )}

      {/* ==================== ROUTING TABLE TAB ==================== */}
      {activeTab === 'routes' && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="p-2 bg-primary-400/10 rounded-lg"><Globe className="w-4 h-4 text-primary-400" /></div>
              <div>
                <p className="text-xl font-bold text-slate-100">{routeStats.total}</p>
                <p className="text-xs text-slate-400">Total Routes</p>
              </div>
            </div>
            {Object.entries(routeStats.byType).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, count]) => (
              <div key={type} className="glass-card p-4 flex items-center gap-3">
                <div className={clsx('p-2 rounded-lg', routeTypeColor(type).replace('text-', 'bg-').split(' ')[1]?.replace('/10', '/10') || 'bg-slate-400/10')}>
                  <Router className={clsx('w-4 h-4', routeTypeColor(type).split(' ')[0])} />
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-100">{count}</p>
                  <p className="text-xs text-slate-400 capitalize">{type}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Route type filter + search bar */}
          <div className="glass-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 shrink-0">Filter by type:</span>
              <button
                onClick={() => setRouteTypeFilter('all')}
                className={clsx(
                  'text-xs px-2.5 py-1 rounded-full border font-medium transition-colors',
                  routeTypeFilter === 'all'
                    ? 'bg-primary-500/20 text-primary-300 border-primary-500/40'
                    : 'border-dark-600 text-slate-400 hover:text-slate-200 hover:border-dark-500'
                )}
              >
                All ({routeStats.total})
              </button>
              {allRouteTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setRouteTypeFilter(type)}
                  className={clsx(
                    'text-xs px-2.5 py-1 rounded-full border font-medium transition-colors capitalize',
                    routeTypeFilter === type
                      ? clsx('border-transparent', routeTypeColor(type))
                      : 'border-dark-600 text-slate-400 hover:text-slate-200 hover:border-dark-500'
                  )}
                >
                  {type} ({routeStats.byType[type] ?? 0})
                </button>
              ))}
              <div className="ml-auto relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  value={routeSearch}
                  onChange={(e) => setRouteSearch(e.target.value)}
                  placeholder="Search destination / interface…"
                  className="input-dark text-sm !py-1 pl-8 w-64"
                />
              </div>
            </div>
          </div>

          {filteredDevices.map((dev) => {
            const allRts = routes[dev.id] || [];
            const rts = allRts.filter((r) => {
              if (routeTypeFilter !== 'all' && r.type !== routeTypeFilter) return false;
              if (routeSearch) {
                const q = routeSearch.toLowerCase();
                return (
                  r.ip_mask.includes(q) ||
                  r.gateway.includes(q) ||
                  r.interface.toLowerCase().includes(q) ||
                  r.type.toLowerCase().includes(q)
                );
              }
              return true;
            });
            if (allRts.length === 0) return null;
            const isExpanded = expandedDevice === dev.id || deviceId !== 'all';

            return (
              <div key={dev.id} className="glass-card overflow-hidden">
                <button
                  onClick={() => setExpandedDevice(expandedDevice === dev.id ? null : dev.id)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-dark-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Globe className="w-4 h-4 text-primary-400" />
                    <span className="text-sm font-semibold text-slate-100">{dev.name}</span>
                    <span className="text-xs text-slate-500">{allRts.length} routes total</span>
                    {rts.length !== allRts.length && (
                      <span className="text-xs text-primary-400">{rts.length} shown</span>
                    )}
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </button>
                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-t border-dark-700 text-left">
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Type</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Destination</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Gateway</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">Interface</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-right">Distance</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-right">Metric</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rts.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="text-center py-8 text-slate-500 text-xs">
                              No routes match the current filter
                            </td>
                          </tr>
                        ) : rts.map((r, i) => (
                          <tr key={i} className="border-t border-dark-700/50 table-row-hover">
                            <td className="px-4 py-2">
                              <span className={clsx('text-[10px] font-medium px-2 py-0.5 rounded-full capitalize', routeTypeColor(r.type))}>
                                {r.type}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-200">{r.ip_mask}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-300">
                              {r.gateway !== '0.0.0.0' ? r.gateway : '—'}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-cyan-400">{r.interface}</td>
                            <td className="px-4 py-2 text-xs text-slate-400 text-right">{r.distance}</td>
                            <td className="px-4 py-2 text-xs text-slate-400 text-right">{r.metric}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {filteredDevices.every((d) => (routes[d.id] || []).length === 0) && (
            <div className="glass-card p-12 text-center text-slate-500">
              <Globe className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              <p>No routes available. Routes are fetched from the live FortiGate routing table.</p>
            </div>
          )}
        </>
      )}

      {/* ==================== BGP / OSPF TAB ==================== */}
      {activeTab === 'bgp-ospf' && (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setProtocol('bgp')}
              className={clsx('btn-secondary text-sm', protocol === 'bgp' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
            >
              <ArrowRightLeft className="w-4 h-4" /> BGP
            </button>
            <button
              onClick={() => setProtocol('ospf')}
              className={clsx('btn-secondary text-sm', protocol === 'ospf' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
            >
              <Router className="w-4 h-4" /> OSPF
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="p-2 bg-primary-400/10 rounded-lg"><Network className="w-4 h-4 text-primary-400" /></div>
              <div>
                <p className="text-xl font-bold text-slate-100">{protocol === 'bgp' ? bgpFiltered.length : ospfFiltered.length}</p>
                <p className="text-xs text-slate-400">Total Neighbors</p>
              </div>
            </div>
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="p-2 bg-emerald-400/10 rounded-lg"><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>
              <div>
                <p className="text-xl font-bold text-emerald-400">{protocol === 'bgp' ? bgpUp : ospfUp}</p>
                <p className="text-xs text-slate-400">{protocol === 'bgp' ? 'Established' : 'Full'}</p>
              </div>
            </div>
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="p-2 bg-red-400/10 rounded-lg"><XCircle className="w-4 h-4 text-red-400" /></div>
              <div>
                <p className="text-xl font-bold text-red-400">{protocol === 'bgp' ? bgpFiltered.length - bgpUp : ospfFiltered.length - ospfUp}</p>
                <p className="text-xs text-slate-400">Down / Other</p>
              </div>
            </div>
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="p-2 bg-purple-400/10 rounded-lg"><Info className="w-4 h-4 text-purple-400" /></div>
              <div>
                <p className="text-xl font-bold text-purple-400">{protocol === 'bgp' ? bgpFiltered.reduce((s, n) => s + n.prefixes_received, 0).toLocaleString() : ospfFiltered.filter((n) => n.state === 'full').length}</p>
                <p className="text-xs text-slate-400">{protocol === 'bgp' ? 'Prefixes RX' : 'Full Adjacencies'}</p>
              </div>
            </div>
          </div>

          {protocol === 'bgp' && (
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-700 text-left">
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Device</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">VDOM</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Neighbor IP</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Remote AS</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Local AS</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">State</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Uptime</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase text-right">Pfx RX</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase text-right">Pfx TX</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bgpFiltered.map((n) => (
                      <tr key={n.id} className="border-b border-dark-700/50 table-row-hover">
                        <td className="px-3 py-2.5 text-slate-200 font-medium">{n.device_name}</td>
                        <td className="px-3 py-2.5 text-primary-400 text-xs">{n.vdom}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{n.neighbor_ip}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{n.remote_as}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{n.local_as}</td>
                        <td className="px-3 py-2.5">
                          <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border', stateColor(n.state))}>
                            {isNeighborUp(n.state) ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {n.state}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-300">{n.uptime || '—'}</td>
                        <td className="px-3 py-2.5 text-xs text-right font-mono text-slate-300">{n.prefixes_received.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs text-right font-mono text-slate-300">{n.prefixes_sent.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-400 max-w-[160px] truncate">{n.description}</td>
                      </tr>
                    ))}
                    {bgpFiltered.length === 0 && (
                      <tr><td colSpan={10} className="text-center py-12 text-slate-500">No BGP neighbors found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {protocol === 'ospf' && (
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-700 text-left">
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Device</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">VDOM</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Neighbor ID</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Neighbor IP</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Area</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Interface</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">State</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Priority</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Uptime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ospfFiltered.map((n) => (
                      <tr key={n.id} className="border-b border-dark-700/50 table-row-hover">
                        <td className="px-3 py-2.5 text-slate-200 font-medium">{n.device_name}</td>
                        <td className="px-3 py-2.5 text-primary-400 text-xs">{n.vdom}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{n.neighbor_id}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{n.neighbor_ip}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{n.area}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-cyan-400">{n.interface_name}</td>
                        <td className="px-3 py-2.5">
                          <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border', stateColor(n.state))}>
                            {isNeighborUp(n.state) ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {n.state}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-300 text-center">{n.priority}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-300">{n.uptime || '—'}</td>
                      </tr>
                    ))}
                    {ospfFiltered.length === 0 && (
                      <tr><td colSpan={9} className="text-center py-12 text-slate-500">No OSPF neighbors found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
