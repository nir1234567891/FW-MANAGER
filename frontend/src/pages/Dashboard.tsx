import { useState, useMemo, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts';
import {
  Server, Wifi, Shield, Bell, Activity, AlertTriangle, CheckCircle2, XCircle, ArrowUpRight,
  Cpu, HardDrive, Key, RefreshCw, Layers, Clock,
} from 'lucide-react';
import { clsx } from 'clsx';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import type { Device, Alert } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { useScope } from '@/hooks/useScope';
import { deviceService, monitoringService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';

const mockDevices: Device[] = [
  { id: '1', name: 'FG-HQ-DC1', ip_address: '10.0.1.1', port: 443, api_key: '', hostname: 'FG-HQ-DC1', model: 'FortiGate 600E', firmware: 'v7.4.3', serial_number: 'FG6H0E1234560001', status: 'online', cpu_usage: 45, memory_usage: 62, disk_usage: 38, session_count: 15420, uptime: 8640000, vdom_count: 3, last_seen: new Date().toISOString(), notes: '', created_at: '', updated_at: '' },
  { id: '2', name: 'FG-HQ-DC2', ip_address: '10.0.1.2', port: 443, api_key: '', hostname: 'FG-HQ-DC2', model: 'FortiGate 600E', firmware: 'v7.4.3', serial_number: 'FG6H0E1234560002', status: 'online', cpu_usage: 38, memory_usage: 55, disk_usage: 42, session_count: 12830, uptime: 8640000, vdom_count: 3, last_seen: new Date().toISOString(), notes: '', created_at: '', updated_at: '' },
  { id: '3', name: 'FG-BRANCH-NYC', ip_address: '10.1.1.1', port: 443, api_key: '', hostname: 'FG-BRANCH-NYC', model: 'FortiGate 200F', firmware: 'v7.4.2', serial_number: 'FG2H0F1234560003', status: 'online', cpu_usage: 22, memory_usage: 41, disk_usage: 25, session_count: 3240, uptime: 2592000, vdom_count: 1, last_seen: new Date().toISOString(), notes: '', created_at: '', updated_at: '' },
  { id: '4', name: 'FG-BRANCH-LON', ip_address: '10.2.1.1', port: 443, api_key: '', hostname: 'FG-BRANCH-LON', model: 'FortiGate 200F', firmware: 'v7.4.2', serial_number: 'FG2H0F1234560004', status: 'online', cpu_usage: 31, memory_usage: 48, disk_usage: 30, session_count: 2890, uptime: 1728000, vdom_count: 1, last_seen: new Date().toISOString(), notes: '', created_at: '', updated_at: '' },
  { id: '5', name: 'FG-BRANCH-TKY', ip_address: '10.3.1.1', port: 443, api_key: '', hostname: 'FG-BRANCH-TKY', model: 'FortiGate 100F', firmware: 'v7.4.1', serial_number: 'FG1H0F1234560005', status: 'offline', cpu_usage: 0, memory_usage: 0, disk_usage: 45, session_count: 0, uptime: 0, vdom_count: 1, last_seen: new Date(Date.now() - 3600000).toISOString(), notes: '', created_at: '', updated_at: '' },
  { id: '6', name: 'FG-BRANCH-SYD', ip_address: '10.4.1.1', port: 443, api_key: '', hostname: 'FG-BRANCH-SYD', model: 'FortiGate 100F', firmware: 'v7.2.8', serial_number: 'FG1H0F1234560006', status: 'warning', cpu_usage: 87, memory_usage: 91, disk_usage: 78, session_count: 4200, uptime: 604800, vdom_count: 1, last_seen: new Date().toISOString(), notes: '', created_at: '', updated_at: '' },
];

const mockAlerts: Alert[] = [
  { id: 'a1', device_id: '5', device_name: 'FG-BRANCH-TKY', severity: 'critical', type: 'device_down', message: 'Device unreachable - connection timeout after 3 retries', acknowledged: false, created_at: new Date(Date.now() - 1800000).toISOString() },
  { id: 'a2', device_id: '6', device_name: 'FG-BRANCH-SYD', severity: 'high', type: 'high_cpu', message: 'CPU usage exceeds 85% threshold (currently 87%)', acknowledged: false, created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'a3', device_id: '6', device_name: 'FG-BRANCH-SYD', severity: 'high', type: 'high_memory', message: 'Memory usage exceeds 90% threshold (currently 91%)', acknowledged: false, created_at: new Date(Date.now() - 3900000).toISOString() },
  { id: 'a4', device_id: '3', device_name: 'FG-BRANCH-NYC', severity: 'medium', type: 'tunnel_flap', message: 'VPN tunnel "NYC-to-HQ" flapped 3 times in last hour', acknowledged: true, created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: 'a5', device_id: '6', device_name: 'FG-BRANCH-SYD', severity: 'low', type: 'firmware', message: 'Firmware update available: v7.4.3 (current: v7.2.8)', acknowledged: false, created_at: new Date(Date.now() - 86400000).toISOString() },
];

function generateTrafficData() {
  const data = [];
  const now = Date.now();
  for (let i = 24; i >= 0; i--) {
    const hour = new Date(now - i * 3600000);
    const isBusinessHours = hour.getHours() >= 8 && hour.getHours() <= 18;
    const base = isBusinessHours ? 800 : 200;
    data.push({
      time: `${hour.getHours().toString().padStart(2, '0')}:00`,
      incoming: base + Math.random() * 400,
      outgoing: (base * 0.6) + Math.random() * 250,
    });
  }
  return data;
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

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      {payload.map((item, i) => (
        <p key={i} className="text-sm font-medium" style={{ color: item.color }}>
          {item.name}: {typeof item.value === 'number' ? item.value.toFixed(1) : item.value} Mbps
        </p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { scope } = useScope();
  const [trafficData] = useState(generateTrafficData);
  const [devices, setDevices] = useState<Device[]>(mockDevices);
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts);

  useEffect(() => {
    Promise.allSettled([
      deviceService.getAll(),
      monitoringService.getAlerts(),
    ]).then(([devResult, alertResult]) => {
      if (devResult.status === 'fulfilled' && Array.isArray(devResult.value.data) && devResult.value.data.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = (devResult.value.data as any[]).map(mapBackendDevice);
        setDevices(mapped);

        // Build device name lookup for alerts
        const devMap = new Map(mapped.map((d) => [String(d.id), d.name]));

        if (alertResult.status === 'fulfilled' && Array.isArray(alertResult.value.data) && alertResult.value.data.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setAlerts(alertResult.value.data.map((a: any) => ({
            id: String(a.id),
            device_id: String(a.device_id),
            device_name: a.device_name || devMap.get(String(a.device_id)) || `Device ${a.device_id}`,
            severity: a.severity || 'medium',
            type: a.alert_type || a.type || 'unknown',
            message: a.message || '',
            acknowledged: a.acknowledged || false,
            created_at: a.created_at || new Date().toISOString(),
          })) as Alert[]);
        }
      } else if (alertResult.status === 'fulfilled' && Array.isArray(alertResult.value.data) && alertResult.value.data.length > 0) {
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
    });
  }, []);

  const scopedDevices = scope.deviceId === 'all'
    ? devices
    : devices.filter((d) => d.id === scope.deviceId);
  const scopedAlerts = scope.deviceId === 'all'
    ? alerts
    : alerts.filter((a) => a.device_id === scope.deviceId);

  const onlineCount = scopedDevices.filter((d) => d.status === 'online').length;
  const offlineCount = scopedDevices.filter((d) => d.status === 'offline').length;
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
    .map((d) => ({ name: d.name.replace('FG-', ''), sessions: d.session_count }));

  const sparkDevices = [45, 42, 48, 44, 46, 43, 47, 45];
  const sparkTunnels = [12, 11, 12, 10, 12, 11, 12, 12];
  const sparkPolicies = [142, 142, 145, 148, 148, 150, 152, 152];
  const sparkAlerts = [3, 5, 4, 2, 6, 5, 3, 5];

  const firmwareMatrix = useMemo(() => {
    const map = new Map<string, { version: string; devices: Device[] }>();
    for (const d of scopedDevices) {
      const entry = map.get(d.firmware);
      if (entry) entry.devices.push(d);
      else map.set(d.firmware, { version: d.firmware, devices: [d] });
    }
    return Array.from(map.values()).sort((a, b) => b.version.localeCompare(a.version));
  }, [scopedDevices]);

  const licenseInfo = useMemo(() => [
    { device: 'FG-HQ-DC1', expiry: '2027-03-15', daysLeft: 355, services: ['FortiGuard', 'IPS', 'Web Filter', 'AntiVirus'] },
    { device: 'FG-HQ-DC2', expiry: '2027-03-15', daysLeft: 355, services: ['FortiGuard', 'IPS', 'Web Filter', 'AntiVirus'] },
    { device: 'FG-BRANCH-NYC', expiry: '2026-06-30', daysLeft: 97, services: ['FortiGuard', 'IPS', 'Web Filter'] },
    { device: 'FG-BRANCH-LON', expiry: '2026-09-01', daysLeft: 160, services: ['FortiGuard', 'IPS'] },
    { device: 'FG-BRANCH-TKY', expiry: '2026-04-15', daysLeft: 21, services: ['FortiGuard', 'IPS'] },
    { device: 'FG-BRANCH-SYD', expiry: '2026-04-01', daysLeft: 7, services: ['FortiGuard'] },
  ].filter((l) => scope.deviceId === 'all' || scopedDevices.some((d) => d.name === l.device)), [scopedDevices, scope.deviceId]);

  const haStatus = useMemo(() => [
    { cluster: 'HQ-DC Cluster', primary: 'FG-HQ-DC1', secondary: 'FG-HQ-DC2', mode: 'Active-Passive', syncStatus: 'synchronized', configMatch: true, sessionSync: 15420, uptime: '100d 0h' },
  ], []);

  const latestRecommendation = 'v7.4.3';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Devices" value={scopedDevices.length} icon={Server} trend="up" change="+2 this month" color="cyan" sparkData={sparkDevices} />
        <StatCard title="Active Tunnels" value={12} icon={Wifi} trend="up" change="100% uptime" color="emerald" sparkData={sparkTunnels} />
        <StatCard title="Total Policies" value={152} icon={Shield} trend="up" change="+4 this week" color="purple" sparkData={sparkPolicies} />
        <StatCard title="Active Alerts" value={scopedAlerts.filter((a) => !a.acknowledged).length} icon={Bell} trend="down" change="-2 from yesterday" color="amber" sparkData={sparkAlerts} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary-400" /> Network Traffic (Last 24h)
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trafficData}>
              <defs>
                <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
              <Area type="monotone" dataKey="incoming" stroke="#22d3ee" fill="url(#gradIn)" strokeWidth={2} name="Incoming" />
              <Area type="monotone" dataKey="outgoing" stroke="#a78bfa" fill="url(#gradOut)" strokeWidth={2} name="Outgoing" />
            </AreaChart>
          </ResponsiveContainer>
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
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary-400" /> Recent Alerts
          </h3>
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {scopedAlerts.map((alert) => (
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
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Server className="w-4 h-4 text-primary-400" /> Device Health Overview
        </h3>
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
                    <span>CPU</span><span>{device.cpu_usage}%</span>
                  </div>
                  <div className="h-1 bg-dark-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${device.cpu_usage >= 80 ? 'bg-red-400' : device.cpu_usage >= 60 ? 'bg-amber-400' : 'bg-primary-400'}`}
                      style={{ width: `${device.cpu_usage}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                    <span>MEM</span><span>{device.memory_usage}%</span>
                  </div>
                  <div className="h-1 bg-dark-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${device.memory_usage >= 80 ? 'bg-red-400' : device.memory_usage >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${device.memory_usage}%` }}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-2 font-mono">{device.ip_address}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Smart Widgets Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Firmware Matrix */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary-400" /> Firmware Matrix
          </h3>
          <div className="space-y-3">
            {firmwareMatrix.map((fw) => {
              const isLatest = fw.version === latestRecommendation;
              return (
                <div key={fw.version} className="bg-dark-900/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={clsx('text-xs font-mono font-bold', isLatest ? 'text-emerald-400' : 'text-amber-400')}>
                        {fw.version}
                      </span>
                      {isLatest && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 rounded-full">
                          RECOMMENDED
                        </span>
                      )}
                    </div>
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
              );
            })}
            {firmwareMatrix.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/5 rounded-lg p-2 border border-amber-400/10">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{firmwareMatrix.length} different firmware versions detected — consider standardizing</span>
              </div>
            )}
          </div>
        </div>

        {/* License Expiry */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Key className="w-4 h-4 text-primary-400" /> License Expiry Tracker
          </h3>
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {licenseInfo
              .sort((a, b) => a.daysLeft - b.daysLeft)
              .map((lic) => (
                <div key={lic.device} className="bg-dark-900/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-200">{lic.device}</span>
                    <span className={clsx(
                      'text-[10px] px-2 py-0.5 rounded-full border font-medium',
                      lic.daysLeft <= 30 ? 'text-red-400 bg-red-400/10 border-red-400/20' :
                      lic.daysLeft <= 90 ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' :
                      'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                    )}>
                      {lic.daysLeft}d left
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span className="text-[10px] text-slate-500">{lic.expiry}</span>
                  </div>
                  <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
                    <div
                      className={clsx('h-full rounded-full transition-all',
                        lic.daysLeft <= 30 ? 'bg-red-400' :
                        lic.daysLeft <= 90 ? 'bg-amber-400' : 'bg-emerald-400'
                      )}
                      style={{ width: `${Math.min(100, (lic.daysLeft / 365) * 100)}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {lic.services.map((s) => (
                      <span key={s} className="text-[9px] px-1.5 py-0.5 bg-dark-800 text-slate-400 rounded border border-dark-600">{s}</span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* HA Sync Status */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary-400" /> HA Cluster Status
          </h3>
          {haStatus.map((ha) => (
            <div key={ha.cluster} className="space-y-4">
              <div className="bg-dark-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-slate-200">{ha.cluster}</span>
                  <span className={clsx(
                    'text-[10px] px-2 py-0.5 rounded-full border font-medium',
                    ha.syncStatus === 'synchronized'
                      ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                      : 'text-red-400 bg-red-400/10 border-red-400/20'
                  )}>
                    {ha.syncStatus}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-dark-800 rounded-lg p-3 text-center border border-emerald-400/20">
                    <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1">Primary</p>
                    <p className="text-xs text-slate-200 font-medium">{ha.primary}</p>
                    <p className="text-[10px] text-slate-500 mt-1">Active</p>
                  </div>
                  <div className="bg-dark-800 rounded-lg p-3 text-center border border-blue-400/20">
                    <p className="text-[10px] text-blue-400 uppercase tracking-wider mb-1">Secondary</p>
                    <p className="text-xs text-slate-200 font-medium">{ha.secondary}</p>
                    <p className="text-[10px] text-slate-500 mt-1">Standby</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { label: 'Mode', value: ha.mode },
                    { label: 'Config Sync', value: ha.configMatch ? 'Matched' : 'MISMATCH', ok: ha.configMatch },
                    { label: 'Session Sync', value: `${ha.sessionSync.toLocaleString()} sessions` },
                    { label: 'Uptime', value: ha.uptime },
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-500">{item.label}</span>
                      <span className={clsx('text-[10px] font-medium',
                        'ok' in item ? (item.ok ? 'text-emerald-400' : 'text-red-400') : 'text-slate-300'
                      )}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/5 rounded-lg p-2 border border-emerald-400/10">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>HA cluster healthy — configuration synchronized, all sessions mirrored</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
