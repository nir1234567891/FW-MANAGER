import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts';
import {
  Server, Wifi, Shield, Bell, Activity, AlertTriangle, CheckCircle2, XCircle, ArrowUpRight,
  Cpu, HardDrive, Key, RefreshCw, Layers, Clock, Loader2, Timer,
} from 'lucide-react';
import { clsx } from 'clsx';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import type { Device, Alert } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { useScope } from '@/hooks/useScope';
import { deviceService, monitoringService, dashboardService, fleetService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';
import { useToast } from '@/components/Toast';

interface DashboardStats {
  devices_total: number;
  devices_online: number;
  devices_offline: number;
  tunnels_total: number;
  tunnels_up: number;
  tunnels_down: number;
  policies_total: number;
  alerts_unacknowledged: number;
  alerts_critical: number;
  avg_cpu: number;
  avg_memory: number;
  total_sessions: number;
}

interface ResourcePoint {
  time: string;
  cpu: number;
  memory: number;
}

const severityIcon: Record<string, React.ReactNode> = {
  critical: <XCircle className="w-4 h-4 text-red-400" />,
  high: <AlertTriangle className="w-4 h-4 text-orange-400" />,
  medium: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  low: <Bell className="w-4 h-4 text-blue-400" />,
  info: <Bell className="w-4 h-4 text-slate-400" />,
};

const severityColors: Record<string, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-amber-500',
  low: 'border-l-blue-500',
  info: 'border-l-slate-500',
};

const ResourceTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      {payload.map((item, i) => (
        <p key={i} className="text-sm font-medium" style={{ color: item.color }}>
          {item.name}: {typeof item.value === 'number' ? item.value.toFixed(1) : item.value}%
        </p>
      ))}
    </div>
  );
};

function parseResourceHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cpuMetric: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memMetric: any,
  windowKey: string,
): ResourcePoint[] {
  const cpuHist = cpuMetric?.historical?.[windowKey];
  const memHist = memMetric?.historical?.[windowKey];
  if (!cpuHist?.values?.length) return [];

  const cpuMap = new Map<number, number>();
  for (const pt of cpuHist.values) {
    cpuMap.set(pt.timestamp, pt.value);
  }

  const memMap = new Map<number, number>();
  if (memHist?.values) {
    for (const pt of memHist.values) {
      memMap.set(pt.timestamp, pt.value);
    }
  }

  const allTs = new Set([...cpuMap.keys(), ...memMap.keys()]);
  const sorted = Array.from(allTs).sort((a, b) => a - b);

  return sorted.map((ts) => {
    const d = new Date(ts);
    return {
      time: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
      cpu: cpuMap.get(ts) ?? 0,
      memory: memMap.get(ts) ?? 0,
    };
  });
}

function LoadingSkeleton({ className = '' }: { className?: string }) {
  return <div className={clsx('animate-pulse bg-dark-700/50 rounded-lg', className)} />;
}

const TIME_WINDOWS = [
  { key: '1-min', label: '1m' },
  { key: '1-hour', label: '1h' },
  { key: '12-hour', label: '12h' },
  { key: '24-hour', label: '24h' },
];

export default function Dashboard() {
  const { scope } = useScope();
  const { addToast } = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [resourceData, setResourceData] = useState<ResourcePoint[]>([]);
  const [resourceDevice, setResourceDevice] = useState<string>('');
  const [resourceWindow, setResourceWindow] = useState('1-min');
  const [resourceLoading, setResourceLoading] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const [statsRes, devResult, alertResult, perfResult] = await Promise.allSettled([
        dashboardService.getOverview(),
        deviceService.getAll(),
        monitoringService.getAlerts(),
        fleetService.getPerformance(),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let perfMap: Record<string, any> = {};
      if (perfResult.status === 'fulfilled' && perfResult.value.data) {
        perfMap = perfResult.value.data as Record<string, unknown>;
      }

      if (statsRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = statsRes.value.data as any;
        // Merge live avg_cpu/avg_memory from fleet performance if available
        const perfValues = Object.values(perfMap) as Array<{ cpu_usage: number; memory_usage: number; source: string }>;
        const liveDevices = perfValues.filter((p) => p.source === 'live');
        if (liveDevices.length > 0) {
          const liveCpu = liveDevices.reduce((s, p) => s + (p.cpu_usage || 0), 0) / liveDevices.length;
          const liveMem = liveDevices.reduce((s, p) => s + (p.memory_usage || 0), 0) / liveDevices.length;
          raw.avg_cpu = Math.round(liveCpu * 10) / 10;
          raw.avg_memory = Math.round(liveMem * 10) / 10;
        }
        setStats(raw as DashboardStats);
      }

      if (devResult.status === 'fulfilled' && Array.isArray(devResult.value.data)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = (devResult.value.data as any[]).map((d) => {
          const dev = mapBackendDevice(d);
          // Overlay live performance data if available
          const perf = perfMap[String(d.id)];
          if (perf && perf.source === 'live') {
            dev.cpu_usage = Math.round(perf.cpu_usage);
            dev.memory_usage = Math.round(perf.memory_usage);
            if (perf.session_count != null) dev.session_count = perf.session_count;
          }
          return dev;
        });
        setDevices(mapped);
      }

      if (alertResult.status === 'fulfilled' && Array.isArray(alertResult.value.data)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAlerts(alertResult.value.data.map((a: any) => ({
          id: String(a.id),
          device_id: String(a.device_id),
          device_name: a.device_name || `Device ${a.device_id}`,
          severity: a.severity || 'medium',
          type: a.alert_type || a.type || 'unknown',
          message: a.message || '',
          acknowledged: a.acknowledged || false,
          created_at: a.created_at || new Date().toISOString(),
        })) as Alert[]);
      }

      if (silent) addToast('success', 'Dashboard refreshed');
    } catch {
      addToast('error', 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  const fetchResourceMetrics = useCallback(async (deviceId: string, window: string) => {
    if (!deviceId) return;
    setResourceLoading(true);
    try {
      const res = await deviceService.getDashboard(deviceId);
      const data = res.data;
      const points = parseResourceHistory(data.cpu, data.memory, window);
      setResourceData(points);
    } catch {
      setResourceData([]);
    } finally {
      setResourceLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-select first online device for resource chart
  useEffect(() => {
    if (devices.length > 0 && !resourceDevice) {
      const online = devices.find((d) => d.status === 'online');
      if (online) {
        setResourceDevice(online.id);
      }
    }
  }, [devices, resourceDevice]);

  // Fetch resource metrics when device or window changes
  useEffect(() => {
    if (resourceDevice) {
      fetchResourceMetrics(resourceDevice, resourceWindow);
    }
  }, [resourceDevice, resourceWindow, fetchResourceMetrics]);

  // Auto-refresh interval — fetchData already includes fleet performance
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(() => {
        fetchData(true);
        if (resourceDevice) fetchResourceMetrics(resourceDevice, resourceWindow);
      }, 30000);
    } else if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, fetchData, fetchResourceMetrics, resourceDevice, resourceWindow]);

  const scopedDevices = scope.deviceId === 'all'
    ? devices
    : devices.filter((d) => d.id === scope.deviceId);
  const scopedAlerts = scope.deviceId === 'all'
    ? alerts
    : alerts.filter((a) => a.device_id === scope.deviceId);

  const onlineCount = stats?.devices_online ?? scopedDevices.filter((d) => d.status === 'online').length;
  const offlineCount = stats?.devices_offline ?? scopedDevices.filter((d) => d.status === 'offline').length;
  const warningCount = scopedDevices.filter((d) => d.status === 'warning').length;

  const pieData = [
    { name: 'Online', value: onlineCount, color: '#34d399' },
    { name: 'Offline', value: offlineCount, color: '#f87171' },
    { name: 'Warning', value: warningCount, color: '#fbbf24' },
  ];

  const sessionData = scopedDevices
    .filter((d) => d.session_count > 0)
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 5)
    .map((d) => ({ name: d.name.replace('FG-', '').replace('FW-', ''), sessions: d.session_count }));

  const firmwareMatrix = useMemo(() => {
    const map = new Map<string, { version: string; devices: Device[] }>();
    for (const d of scopedDevices) {
      const v = d.firmware || 'unknown';
      const entry = map.get(v);
      if (entry) entry.devices.push(d);
      else map.set(v, { version: v, devices: [d] });
    }
    return Array.from(map.values()).sort((a, b) => b.version.localeCompare(a.version));
  }, [scopedDevices]);

  const onlineDevices = scopedDevices.filter((d) => d.status === 'online');

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <LoadingSkeleton key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <LoadingSkeleton className="lg:col-span-2 h-72" />
          <LoadingSkeleton className="h-72" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LoadingSkeleton className="h-64" />
          <LoadingSkeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <div />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((p) => !p)}
            className={clsx(
              'btn-secondary text-sm',
              autoRefresh && 'ring-1 ring-primary-400/50 text-primary-400'
            )}
            title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
          >
            <Timer className="w-4 h-4" />
            {autoRefresh ? '30s' : 'Auto'}
          </button>
          <button
            onClick={() => {
              fetchData(true);
              if (resourceDevice) fetchResourceMetrics(resourceDevice, resourceWindow);
            }}
            disabled={refreshing}
            className="btn-secondary text-sm"
          >
            {refreshing
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RefreshCw className="w-4 h-4" />
            }
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Devices" value={stats?.devices_total ?? scopedDevices.length} icon={Server} trend="up" change={`${onlineCount} online`} color="cyan" />
        <StatCard title="VPN Tunnels" value={stats?.tunnels_total ?? 0} icon={Wifi} trend={stats && stats.tunnels_down === 0 ? 'up' : 'down'} change={`${stats?.tunnels_up ?? 0} up / ${stats?.tunnels_down ?? 0} down`} color="emerald" />
        <StatCard title="Total Policies" value={stats?.policies_total ?? 0} icon={Shield} color="purple" />
        <StatCard title="Active Alerts" value={stats?.alerts_unacknowledged ?? scopedAlerts.filter((a) => !a.acknowledged).length} icon={Bell} trend={stats && stats.alerts_critical > 0 ? 'down' : 'up'} change={stats?.alerts_critical ? `${stats.alerts_critical} critical` : 'All clear'} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Resource Utilization Chart */}
        <div className="lg:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary-400" /> Resource Utilization
              <span className="text-[10px] font-normal px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">LIVE</span>
            </h3>
            <div className="flex items-center gap-2">
              <select
                value={resourceDevice}
                onChange={(e) => setResourceDevice(e.target.value)}
                className="text-xs bg-dark-800 border border-dark-600 rounded-md px-2 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-400/50"
              >
                {onlineDevices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <div className="flex bg-dark-800 rounded-md border border-dark-600 overflow-hidden">
                {TIME_WINDOWS.map((tw) => (
                  <button
                    key={tw.key}
                    onClick={() => setResourceWindow(tw.key)}
                    className={clsx(
                      'text-[10px] px-2 py-1 font-medium transition-colors',
                      resourceWindow === tw.key
                        ? 'bg-primary-500/20 text-primary-400'
                        : 'text-slate-500 hover:text-slate-300'
                    )}
                  >
                    {tw.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {resourceLoading ? (
            <LoadingSkeleton className="h-[280px]" />
          ) : resourceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={resourceData}>
                <defs>
                  <linearGradient id="gradCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradMem" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} unit="%" domain={([, dataMax]: [number, number]) => [0, Math.max(dataMax * 1.3, 10)]} />
                <Tooltip content={<ResourceTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                <Area type="monotone" dataKey="cpu" stroke="#22d3ee" fill="url(#gradCpu)" strokeWidth={2} name="CPU" />
                <Area type="monotone" dataKey="memory" stroke="#a78bfa" fill="url(#gradMem)" strokeWidth={2} name="Memory" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-slate-500 text-sm">
              <div className="text-center">
                <Activity className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p>No resource history available</p>
                <p className="text-xs mt-1 text-slate-600">Select an online device — data populates from live FortiGate API</p>
              </div>
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Server className="w-4 h-4 text-primary-400" /> Device Status
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value" strokeWidth={0}>
                {pieData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 13 }}
                itemStyle={{ color: '#e2e8f0' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            {pieData.map((item) => (
              <div key={item.name} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name} ({item.value})
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-primary-400" /> Top Devices by Sessions
          </h3>
          {sessionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={sessionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} width={100} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 13 }}
                  itemStyle={{ color: '#e2e8f0' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="sessions" fill="#06b6d4" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-slate-500 text-sm">
              No session data available
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary-400" /> Recent Alerts
          </h3>
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {scopedAlerts.length > 0 ? scopedAlerts.slice(0, 10).map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3 bg-dark-900/50 rounded-lg border-l-2 ${severityColors[alert.severity]}`}
              >
                <div className="mt-0.5">{severityIcon[alert.severity]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300">{alert.device_name}</span>
                    {alert.acknowledged && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{alert.message}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}</p>
                </div>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mb-2" />
                <p className="text-sm">No active alerts</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Server className="w-4 h-4 text-primary-400" /> Device Health Overview
        </h3>
        {scopedDevices.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {scopedDevices.map((device) => (
              <div key={device.id} className="glass-card-hover p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-200 truncate">{device.name}</span>
                  <StatusBadge status={device.status} size="sm" showDot label="" />
                </div>
                <div className="space-y-1.5">
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                      <span>CPU</span>
                      <span className={device.cpu_usage === 0 ? 'text-slate-600' : ''}>{device.cpu_usage}%</span>
                    </div>
                    <div className="h-1 bg-dark-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${device.cpu_usage >= 80 ? 'bg-red-400' : device.cpu_usage >= 60 ? 'bg-amber-400' : 'bg-primary-400'}`}
                        style={{ width: device.cpu_usage === 0 ? '2px' : `${device.cpu_usage}%`, opacity: device.cpu_usage === 0 ? 0.3 : 1 }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                      <span>MEM</span>
                      <span className={device.memory_usage === 0 ? 'text-slate-600' : ''}>{device.memory_usage}%</span>
                    </div>
                    <div className="h-1 bg-dark-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${device.memory_usage >= 80 ? 'bg-red-400' : device.memory_usage >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: device.memory_usage === 0 ? '2px' : `${device.memory_usage}%`, opacity: device.memory_usage === 0 ? 0.3 : 1 }}
                      />
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-slate-600 mt-2 font-mono">{device.ip_address}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card p-8 text-center text-slate-500">
            <Server className="w-8 h-8 mx-auto mb-2 text-slate-600" />
            <p className="text-sm">No devices found. Add your first FortiGate device to get started.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Firmware Matrix */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary-400" /> Firmware Matrix
          </h3>
          <div className="space-y-3">
            {firmwareMatrix.length > 0 ? firmwareMatrix.map((fw) => (
              <div key={fw.version} className="bg-dark-900/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-bold text-slate-300">{fw.version}</span>
                  <span className="text-xs text-slate-500">{fw.devices.length} device(s)</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {fw.devices.map((d) => (
                    <span key={d.id} className="text-[10px] px-2 py-0.5 bg-dark-800 text-slate-300 rounded border border-dark-600">
                      {d.name}
                    </span>
                  ))}
                </div>
              </div>
            )) : (
              <p className="text-sm text-slate-500 text-center py-4">No firmware data available</p>
            )}
            {firmwareMatrix.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/5 rounded-lg p-2 border border-amber-400/10">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{firmwareMatrix.length} different firmware versions detected -- consider standardizing</span>
              </div>
            )}
          </div>
        </div>

        {/* Fleet Performance Summary */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary-400" /> Fleet Performance
            <span className="text-[10px] font-normal px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">LIVE</span>
          </h3>
          <div className="space-y-4">
            <div className="bg-dark-900/50 rounded-lg p-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  {(() => {
                    const val = stats?.avg_cpu ?? 0;
                    const arc = Math.max(val, val === 0 ? 0 : 2);
                    const color = val >= 80 ? '#f87171' : val >= 60 ? '#fbbf24' : '#34d399';
                    return (
                      <div className="relative w-14 h-14 mx-auto mb-1">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <circle cx="18" cy="18" r="16" fill="none" stroke="#1e293b" strokeWidth="3" />
                          {val === 0 ? (
                            <circle cx="18" cy="18" r="16" fill="none" stroke="#1e2940" strokeWidth="3" strokeDasharray="100 0" />
                          ) : (
                            <circle cx="18" cy="18" r="16" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${arc} ${100 - arc}`} />
                          )}
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-200">{val}%</span>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-slate-500">Avg CPU</p>
                </div>
                <div className="text-center">
                  {(() => {
                    const val = stats?.avg_memory ?? 0;
                    const arc = Math.max(val, val > 0 ? 2 : 0);
                    const color = val >= 80 ? '#f87171' : val >= 60 ? '#fbbf24' : '#34d399';
                    return (
                      <div className="relative w-14 h-14 mx-auto mb-1">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <circle cx="18" cy="18" r="16" fill="none" stroke="#1e293b" strokeWidth="3" />
                          {val === 0 ? (
                            <circle cx="18" cy="18" r="16" fill="none" stroke="#1e2940" strokeWidth="3" strokeDasharray="100 0" />
                          ) : (
                            <circle cx="18" cy="18" r="16" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${arc} ${100 - arc}`} />
                          )}
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-200">{val}%</span>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-slate-500">Avg Memory</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-200 mt-2">
                    {(stats?.total_sessions ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">Total Sessions</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {onlineDevices.slice(0, 4).map((d) => (
                <div key={d.id} className="flex items-center gap-3 bg-dark-900/50 rounded-lg p-2.5">
                  <span className="text-xs text-slate-300 w-28 truncate">{d.name}</span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1">
                      <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
                        <div
                          className={clsx('h-full rounded-full transition-all', d.cpu_usage >= 80 ? 'bg-red-400' : d.cpu_usage >= 60 ? 'bg-amber-400' : 'bg-primary-400')}
                          style={{ width: d.cpu_usage === 0 ? '3px' : `${d.cpu_usage}%`, opacity: d.cpu_usage === 0 ? 0.3 : 1 }}
                        />
                      </div>
                    </div>
                    <span className={clsx('text-[10px] w-10 text-right', d.cpu_usage === 0 ? 'text-slate-600' : 'text-slate-500')}>{d.cpu_usage}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
