import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts';
import {
  Activity, Cpu, MemoryStick, Timer, Zap, RefreshCw, Pause, Play,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettings } from '../hooks/useSettings';
import { useScope } from '../hooks/useScope';
import { deviceService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';

const fallbackDevices = [
  { id: '1', name: 'FG-HQ-DC1' },
  { id: '2', name: 'FG-HQ-DC2' },
  { id: '3', name: 'FG-BRANCH-NYC' },
  { id: '4', name: 'FG-BRANCH-LON' },
  { id: '5', name: 'FG-BRANCH-TKY' },
  { id: '6', name: 'FG-BRANCH-SYD' },
];

function generatePerfData(base: { cpu: number; mem: number; sessions: number; bwIn: number; bwOut: number }) {
  return Array.from({ length: 60 }, (_, i) => ({
    time: `${60 - i}m`,
    cpu: Math.max(5, Math.min(99, base.cpu + (Math.random() - 0.5) * 20 + Math.sin(i / 8) * 8)),
    memory: Math.max(10, Math.min(99, base.mem + (Math.random() - 0.5) * 10 + Math.cos(i / 10) * 5)),
    sessions: Math.max(100, Math.floor(base.sessions + (Math.random() - 0.5) * base.sessions * 0.3 + Math.sin(i / 6) * base.sessions * 0.1)),
    incoming: Math.max(10, base.bwIn + (Math.random() - 0.5) * base.bwIn * 0.4 + Math.sin(i / 5) * base.bwIn * 0.2),
    outgoing: Math.max(5, base.bwOut + (Math.random() - 0.5) * base.bwOut * 0.4 + Math.cos(i / 7) * base.bwOut * 0.15),
  }));
}

const deviceBases: Record<string, { cpu: number; mem: number; sessions: number; bwIn: number; bwOut: number }> = {
  '1': { cpu: 45, mem: 62, sessions: 15420, bwIn: 850, bwOut: 520 },
  '2': { cpu: 38, mem: 55, sessions: 12830, bwIn: 720, bwOut: 450 },
  '3': { cpu: 22, mem: 41, sessions: 3240, bwIn: 320, bwOut: 180 },
  '4': { cpu: 31, mem: 48, sessions: 2890, bwIn: 280, bwOut: 160 },
  '5': { cpu: 0, mem: 0, sessions: 0, bwIn: 0, bwOut: 0 },
  '6': { cpu: 87, mem: 91, sessions: 4200, bwIn: 450, bwOut: 280 },
};

const topSessions = [
  { source: '10.0.2.45', dest: '203.0.113.50', service: 'HTTPS', bytes: '2.4 GB', duration: '4h 32m' },
  { source: '10.0.2.112', dest: '198.51.100.25', service: 'SSH', bytes: '856 MB', duration: '2h 15m' },
  { source: '172.16.0.88', dest: '151.101.1.140', service: 'HTTPS', bytes: '1.2 GB', duration: '1h 48m' },
  { source: '10.0.3.22', dest: '104.16.132.229', service: 'HTTPS', bytes: '945 MB', duration: '3h 12m' },
  { source: '172.16.0.201', dest: '52.84.150.11', service: 'HTTPS', bytes: '678 MB', duration: '56m' },
  { source: '10.0.2.77', dest: '185.199.108.153', service: 'HTTPS', bytes: '512 MB', duration: '1h 22m' },
];

function GaugeDisplay({ label, value, max, unit, icon: Icon, color }: {
  label: string; value: number; max: number; unit: string;
  icon: React.ElementType; color: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference * 0.75;
  const isHigh = pct >= 80;

  return (
    <div className="glass-card p-5 flex flex-col items-center">
      <div className="relative w-32 h-32">
        <svg width="128" height="128" className="-rotate-[135deg]">
          <circle cx="64" cy="64" r={radius} fill="none" stroke="#1e293b" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} />
          <circle cx="64" cy="64" r={radius} fill="none" stroke={isHigh ? '#f87171' : color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeDashoffset={dashOffset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon className="w-4 h-4 text-slate-500 mb-1" />
          <span className={clsx('text-2xl font-bold', isHigh ? 'text-red-400' : 'text-slate-100')}>
            {typeof value === 'number' && value < 1000 ? value.toFixed(0) : value.toLocaleString()}
          </span>
          <span className="text-[10px] text-slate-500">{unit}</span>
        </div>
      </div>
      <p className="text-sm text-slate-400 mt-2 font-medium">{label}</p>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  );
};

export default function Monitoring() {
  const { settings } = useSettings();
  const { scope, setDeviceId } = useScope();
  const [devices, setDevices] = useState(fallbackDevices);
  const [selectedDevice, setSelectedDevice] = useState('1');
  const [refreshing, setRefreshing] = useState(true);
  const [interval, setRefreshInterval] = useState(() => Number(settings.refreshInterval) * 1000 || 5000);
  const [data, setData] = useState(() => generatePerfData(deviceBases['1']));
  const [realBases, setRealBases] = useState<Record<string, { cpu: number; mem: number; sessions: number; bwIn: number; bwOut: number }>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  // Load real device list on mount
  useEffect(() => {
    deviceService.getAll()
      .then((res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = res.data as any[];
        if (Array.isArray(list) && list.length > 0) {
          const fullDevices = list.map(mapBackendDevice);
          const mapped = fullDevices.map((d) => ({ id: d.id, name: d.name }));
          setDevices(mapped);
          // Build real performance bases from device data
          const bases: typeof realBases = {};
          for (const d of fullDevices) {
            bases[d.id] = {
              cpu: d.cpu_usage || 5,
              mem: d.memory_usage || 10,
              sessions: d.session_count || 100,
              bwIn: 100 + Math.random() * 400,
              bwOut: 50 + Math.random() * 200,
            };
          }
          setRealBases(bases);
          // If currently selected device isn't in new list, select first
          if (!mapped.find((d) => d.id === selectedDevice) && mapped.length > 0) {
            setSelectedDevice(mapped[0].id);
          }
        }
      })
      .catch(() => { /* keep fallback */ });
  }, []);

  useEffect(() => {
    const ms = Number(settings.refreshInterval) * 1000;
    if (ms > 0) setRefreshInterval(ms);
  }, [settings.refreshInterval]);

  useEffect(() => {
    if (scope.deviceId !== 'all' && scope.deviceId !== selectedDevice) {
      setSelectedDevice(scope.deviceId);
    }
  }, [scope.deviceId, selectedDevice]);

  const refreshData = useCallback(() => {
    const base = realBases[selectedDevice] || deviceBases[selectedDevice];
    if (base) setData(generatePerfData(base));
  }, [selectedDevice, realBases]);

  useEffect(() => {
    refreshData();
  }, [selectedDevice, refreshData]);

  useEffect(() => {
    if (refreshing) {
      intervalRef.current = setInterval(refreshData, interval);
      return () => clearInterval(intervalRef.current);
    } else {
      clearInterval(intervalRef.current);
    }
  }, [refreshing, interval, refreshData]);

  const latest = data[data.length - 1];
  const [deviceUptimes, setDeviceUptimes] = useState<Record<string, number>>({
    '1': 8640000, '2': 8640000, '3': 2592000, '4': 1728000, '5': 0, '6': 604800,
  });
  // Update uptimes when we load real devices
  useEffect(() => {
    deviceService.getAll()
      .then((res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = res.data as any[];
        if (Array.isArray(list)) {
          const uptimes: Record<string, number> = {};
          for (const d of list) {
            const dev = mapBackendDevice(d);
            uptimes[dev.id] = dev.uptime;
          }
          setDeviceUptimes((prev) => ({ ...prev, ...uptimes }));
        }
      })
      .catch(() => { /* keep fallback */ });
  }, []);
  const formatUptime = (id: string) => {
    const s = deviceUptimes[id] || 0;
    if (s === 0) return '0d 0h';
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  };

  const sessionBarData = data.filter((_, i) => i % 5 === 0).map((d) => ({
    time: d.time,
    sessions: d.sessions,
  }));

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={selectedDevice}
            onChange={(e) => {
              setSelectedDevice(e.target.value);
              setDeviceId(e.target.value);
            }}
            className="input-dark w-auto text-sm"
          >
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>Refresh:</span>
            <select value={interval} onChange={(e) => setRefreshInterval(Number(e.target.value))} className="input-dark w-auto text-sm">
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1m</option>
            </select>
          </div>
          <button
            onClick={() => setRefreshing(!refreshing)}
            className={clsx('btn-secondary text-sm', refreshing && 'border-emerald-500/30 text-emerald-400')}
          >
            {refreshing ? <><Pause className="w-4 h-4" /> Live</> : <><Play className="w-4 h-4" /> Paused</>}
          </button>
          <button onClick={refreshData} className="btn-primary text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh Now
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <GaugeDisplay label="CPU Usage" value={latest.cpu} max={100} unit="%" icon={Cpu} color="#22d3ee" />
        <GaugeDisplay label="Memory Usage" value={latest.memory} max={100} unit="%" icon={MemoryStick} color="#a78bfa" />
        <GaugeDisplay label="Active Sessions" value={latest.sessions} max={30000} unit="sessions" icon={Zap} color="#34d399" />
        <GaugeDisplay label="Uptime" value={0} max={1} unit={formatUptime(selectedDevice)} icon={Timer} color="#fbbf24" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary-400" /> CPU & Memory (Last Hour)
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="cpuG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} interval={9} />
              <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Area type="monotone" dataKey="cpu" stroke="#22d3ee" fill="url(#cpuG)" strokeWidth={2} name="CPU %" dot={false} />
              <Area type="monotone" dataKey="memory" stroke="#a78bfa" fill="url(#memG)" strokeWidth={2} name="Memory %" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary-400" /> Network Throughput (Last Hour)
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="inG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} interval={9} />
              <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Area type="monotone" dataKey="incoming" stroke="#22d3ee" fill="url(#inG)" strokeWidth={2} name="Incoming (Mbps)" dot={false} />
              <Area type="monotone" dataKey="outgoing" stroke="#a78bfa" fill="url(#outG)" strokeWidth={2} name="Outgoing (Mbps)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary-400" /> Sessions (Last Hour)
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sessionBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="sessions" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={16} name="Sessions" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary-400" /> Top Active Sessions
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Source</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Destination</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Service</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Bytes</th>
                  <th className="px-3 py-2 text-left text-slate-400 font-semibold">Duration</th>
                </tr>
              </thead>
              <tbody>
                {topSessions.map((s, i) => (
                  <tr key={i} className="border-b border-dark-700/50 table-row-hover">
                    <td className="px-3 py-2.5 font-mono text-slate-300">{s.source}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-300">{s.dest}</td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 bg-primary-400/10 text-primary-400 rounded text-[10px]">{s.service}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{s.bytes}</td>
                    <td className="px-3 py-2.5 text-slate-400">{s.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
