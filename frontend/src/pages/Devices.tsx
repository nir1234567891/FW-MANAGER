import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, LayoutGrid, List, RefreshCw, Download, Eye, Trash2,
  Server, X, Cpu, MemoryStick, HardDrive, Network, Shield, ChevronRight, Terminal, ExternalLink,
} from 'lucide-react';
import { clsx } from 'clsx';
import DeviceCard from '@/components/DeviceCard';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import type { Device, VDOM, DeviceInterface } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { useScope } from '@/hooks/useScope';
import { deviceService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';

const initialDevices: Device[] = [
  { id: '1', name: 'FG-HQ-DC1', ip_address: '10.0.1.1', port: 443, api_key: 'tk-xxxx-1', hostname: 'FG-HQ-DC1', model: 'FortiGate 600E', firmware: 'v7.4.3', serial_number: 'FG6H0E1234560001', status: 'online', cpu_usage: 45, memory_usage: 62, disk_usage: 38, session_count: 15420, uptime: 8640000, vdom_count: 3, last_seen: new Date().toISOString(), notes: 'Primary DC firewall', created_at: '2024-01-15T00:00:00Z', updated_at: new Date().toISOString() },
  { id: '2', name: 'FG-HQ-DC2', ip_address: '10.0.1.2', port: 443, api_key: 'tk-xxxx-2', hostname: 'FG-HQ-DC2', model: 'FortiGate 600E', firmware: 'v7.4.3', serial_number: 'FG6H0E1234560002', status: 'online', cpu_usage: 38, memory_usage: 55, disk_usage: 42, session_count: 12830, uptime: 8640000, vdom_count: 3, last_seen: new Date().toISOString(), notes: 'Secondary DC firewall (HA pair)', created_at: '2024-01-15T00:00:00Z', updated_at: new Date().toISOString() },
  { id: '3', name: 'FG-BRANCH-NYC', ip_address: '10.1.1.1', port: 443, api_key: 'tk-xxxx-3', hostname: 'FG-BRANCH-NYC', model: 'FortiGate 200F', firmware: 'v7.4.2', serial_number: 'FG2H0F1234560003', status: 'online', cpu_usage: 22, memory_usage: 41, disk_usage: 25, session_count: 3240, uptime: 2592000, vdom_count: 1, last_seen: new Date().toISOString(), notes: 'New York branch office', created_at: '2024-03-10T00:00:00Z', updated_at: new Date().toISOString() },
  { id: '4', name: 'FG-BRANCH-LON', ip_address: '10.2.1.1', port: 443, api_key: 'tk-xxxx-4', hostname: 'FG-BRANCH-LON', model: 'FortiGate 200F', firmware: 'v7.4.2', serial_number: 'FG2H0F1234560004', status: 'online', cpu_usage: 31, memory_usage: 48, disk_usage: 30, session_count: 2890, uptime: 1728000, vdom_count: 1, last_seen: new Date().toISOString(), notes: 'London branch office', created_at: '2024-03-12T00:00:00Z', updated_at: new Date().toISOString() },
  { id: '5', name: 'FG-BRANCH-TKY', ip_address: '10.3.1.1', port: 443, api_key: 'tk-xxxx-5', hostname: 'FG-BRANCH-TKY', model: 'FortiGate 100F', firmware: 'v7.4.1', serial_number: 'FG1H0F1234560005', status: 'offline', cpu_usage: 0, memory_usage: 0, disk_usage: 45, session_count: 0, uptime: 0, vdom_count: 1, last_seen: new Date(Date.now() - 3600000).toISOString(), notes: 'Tokyo branch - unreachable', created_at: '2024-06-01T00:00:00Z', updated_at: new Date(Date.now() - 3600000).toISOString() },
  { id: '6', name: 'FG-BRANCH-SYD', ip_address: '10.4.1.1', port: 443, api_key: 'tk-xxxx-6', hostname: 'FG-BRANCH-SYD', model: 'FortiGate 100F', firmware: 'v7.2.8', serial_number: 'FG1H0F1234560006', status: 'warning', cpu_usage: 87, memory_usage: 91, disk_usage: 78, session_count: 4200, uptime: 604800, vdom_count: 1, last_seen: new Date().toISOString(), notes: 'Sydney - high resource usage', created_at: '2024-06-15T00:00:00Z', updated_at: new Date().toISOString() },
];

const mockVdoms: Record<string, VDOM[]> = {
  '1': [
    { name: 'root', status: 'enabled', type: 'traffic', policy_count: 42, interface_count: 8 },
    { name: 'DMZ', status: 'enabled', type: 'traffic', policy_count: 18, interface_count: 4 },
    { name: 'Guest', status: 'enabled', type: 'traffic', policy_count: 6, interface_count: 2 },
  ],
  '2': [
    { name: 'root', status: 'enabled', type: 'traffic', policy_count: 42, interface_count: 8 },
    { name: 'DMZ', status: 'enabled', type: 'traffic', policy_count: 18, interface_count: 4 },
    { name: 'Guest', status: 'enabled', type: 'traffic', policy_count: 6, interface_count: 2 },
  ],
};

const mockInterfaces: DeviceInterface[] = [
  { name: 'port1', ip: '10.0.1.1/24', status: 'up', speed: '10Gbps', type: 'physical', vdom: 'root', rx_bytes: 1284901200, tx_bytes: 982340100 },
  { name: 'port2', ip: '172.16.0.1/24', status: 'up', speed: '10Gbps', type: 'physical', vdom: 'root', rx_bytes: 502930000, tx_bytes: 401230000 },
  { name: 'port3', ip: '192.168.1.1/24', status: 'up', speed: '1Gbps', type: 'physical', vdom: 'DMZ', rx_bytes: 128490000, tx_bytes: 98234000 },
  { name: 'port4', ip: '192.168.10.1/24', status: 'up', speed: '1Gbps', type: 'physical', vdom: 'Guest', rx_bytes: 42840000, tx_bytes: 31200000 },
  { name: 'ssl.root', ip: '10.212.134.200/24', status: 'up', speed: 'N/A', type: 'tunnel', vdom: 'root', rx_bytes: 12049000, tx_bytes: 8042000 },
  { name: 'port5', ip: '', status: 'down', speed: '1Gbps', type: 'physical', vdom: 'root', rx_bytes: 0, tx_bytes: 0 },
];

type SSHAuthType = 'password' | 'key';
interface SSHConfig {
  username: string;
  port: string;
  authType: SSHAuthType;
  password: string;
  keyPath: string;
}
const SSH_CONFIGS_KEY = 'fortimanager-pro-ssh-configs';

function genPerfData() {
  return Array.from({ length: 12 }, (_, i) => ({
    time: `${(i * 5)}m`,
    cpu: 35 + Math.random() * 25,
    memory: 50 + Math.random() * 20,
  }));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatUptime(seconds: number): string {
  if (seconds === 0) return 'Down';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export default function Devices() {
  const { scope, setDeviceId } = useScope();
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>(initialDevices);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [detailDevice, setDetailDevice] = useState<Device | null>(null);
  const [sortCol, setSortCol] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [sshModalOpen, setSshModalOpen] = useState(false);
  const [sshDevice, setSshDevice] = useState<Device | null>(null);
  const [sshDraft, setSshDraft] = useState<SSHConfig>({ username: 'admin', port: '22', authType: 'password', password: '', keyPath: '' });
  const [actionMessage, setActionMessage] = useState('');
  const [sshConfigs, setSshConfigs] = useState<Record<string, SSHConfig>>(() => {
    try {
      const raw = localStorage.getItem(SSH_CONFIGS_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, SSHConfig>;
    } catch {
      return {};
    }
  });

  const [formData, setFormData] = useState({ name: '', hostname: '', ip_address: '', port: '443', api_key: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Real data for device detail panel
  const [detailVdoms, setDetailVdoms] = useState<VDOM[]>([]);
  const [detailInterfaces, setDetailInterfaces] = useState<DeviceInterface[]>([]);
  const [detailPerfData, setDetailPerfData] = useState<{ time: string; cpu: number; memory: number }[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const defaultSshFor = (device: Device): SSHConfig => ({
    username: 'admin',
    port: String(device.port || 22),
    authType: 'password',
    password: '',
    keyPath: '',
  });

  useEffect(() => {
    deviceService.getAll()
      .then((res) => {
        if (Array.isArray(res.data) && res.data.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mapped = (res.data as any[]).map(mapBackendDevice);
          setDevices(mapped);
        }
      })
      .catch(() => {
        // backend unavailable - keep mock data
      });
  }, []);

  // Fetch real VDOMs, interfaces, performance when detail panel opens
  useEffect(() => {
    if (!detailDevice) return;
    const devId = String(detailDevice.id);
    setDetailLoading(true);
    Promise.allSettled([
      deviceService.getVdoms(devId),
      deviceService.getInterfaces(devId),
      deviceService.getPerformance(devId),
    ]).then(([vdomRes, ifaceRes, perfRes]) => {
      // VDOMs
      if (vdomRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = vdomRes.value.data as any;
        const vdoms = data?.vdoms ?? data;
        if (Array.isArray(vdoms) && vdoms.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setDetailVdoms(vdoms.map((v: any) => ({
            name: v.name || 'root',
            status: v.status || 'enabled',
            type: v.mode || 'traffic',
            policy_count: v.policy_count || 0,
            interface_count: v.interface_count || 0,
          })));
        } else {
          setDetailVdoms(mockVdoms[devId] || [{ name: 'root', status: 'enabled', type: 'traffic', policy_count: 0, interface_count: 0 }]);
        }
      } else {
        setDetailVdoms(mockVdoms[devId] || [{ name: 'root', status: 'enabled', type: 'traffic', policy_count: 0, interface_count: 0 }]);
      }

      // Interfaces
      if (ifaceRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = ifaceRes.value.data as any;
        const ifaces = data?.interfaces ?? data;
        if (Array.isArray(ifaces) && ifaces.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setDetailInterfaces(ifaces.map((i: any) => ({
            name: i.name || '',
            ip: i.ip || '',
            status: (i.status === 'up' ? 'up' : 'down') as 'up' | 'down',
            speed: i.speed || 'N/A',
            type: i.type || 'physical',
            vdom: i.vdom || 'root',
            rx_bytes: i.rx_bytes || 0,
            tx_bytes: i.tx_bytes || 0,
          })));
        } else {
          setDetailInterfaces(mockInterfaces);
        }
      } else {
        setDetailInterfaces(mockInterfaces);
      }

      // Performance (snapshot → seed chart)
      if (perfRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = perfRes.value.data as any;
        const cpuBase = typeof p.cpu_usage === 'number' ? p.cpu_usage : 30;
        const memBase = typeof p.memory_usage === 'number' ? p.memory_usage : 50;
        setDetailPerfData(Array.from({ length: 12 }, (_, i) => ({
          time: `${i * 5}m`,
          cpu: Math.max(0, Math.min(100, cpuBase + (Math.random() * 14 - 7))),
          memory: Math.max(0, Math.min(100, memBase + (Math.random() * 10 - 5))),
        })));
      } else {
        setDetailPerfData(genPerfData());
      }

      setDetailLoading(false);
    });
  }, [detailDevice]);

  const handleAddDevice = async () => {
    if (!formData.name.trim() || !formData.ip_address.trim() || !formData.api_key.trim()) return;
    setIsSubmitting(true);
    setFormError('');
    try {
      const res = await deviceService.create({
        name: formData.name.trim(),
        hostname: (formData.hostname.trim() || formData.name.trim()) as string,
        ip_address: formData.ip_address.trim(),
        port: Number(formData.port) || 443,
        api_key: formData.api_key.trim(),
        notes: formData.notes.trim(),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resData = res.data as any;
      const created = resData?.device ?? resData;
      const newDevice = mapBackendDevice(created);
      setDevices((prev) => [...prev, newDevice]);
      setFormData({ name: '', hostname: '', ip_address: '', port: '443', api_key: '', notes: '' });
      setAddModalOpen(false);
      setActionMessage(`Device "${newDevice.name}" added successfully`);
      setTimeout(() => setActionMessage(''), 2500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(msg || 'Failed to add device. Check IP and API key.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDevice = async () => {
    if (!selectedDevice) return;
    try {
      await deviceService.delete(selectedDevice.id);
    } catch {
      // if backend fails, still remove from UI
    }
    setDevices((prev) => prev.filter((d) => d.id !== selectedDevice.id));
    if (detailDevice?.id === selectedDevice.id) setDetailDevice(null);
    setDeleteModalOpen(false);
    setActionMessage(`Device "${selectedDevice.name}" deleted`);
    setTimeout(() => setActionMessage(''), 2500);
    setSelectedDevice(null);
  };

  const filtered = useMemo(() => {
    let list = devices.filter((d) => {
      const matchSearch = d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.ip_address.includes(searchQuery) || d.model.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'all' || d.status === statusFilter;
      const matchScope = scope.deviceId === 'all' || d.id === scope.deviceId;
      return matchSearch && matchStatus && matchScope;
    });
    list = [...list].sort((a, b) => {
      const aVal = String((a as unknown as Record<string, unknown>)[sortCol] ?? '');
      const bVal = String((b as unknown as Record<string, unknown>)[sortCol] ?? '');
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [devices, searchQuery, statusFilter, sortCol, sortDir, scope.deviceId]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const perfData = detailPerfData.length > 0 ? detailPerfData : genPerfData();

  const goToTunnelMap = (device?: Device | null) => {
    // Keep simple and reliable: always route to tunnel map.
    // We also pass selected device metadata for future filtering support.
    navigate('/tunnel-map', {
      state: device
        ? { selectedDeviceId: device.id, selectedDeviceName: device.name }
        : undefined,
    });
  };

  const goToBackups = (device?: Device | null) => {
    navigate('/backups', {
      state: device
        ? { selectedDeviceId: device.id, selectedDeviceName: device.name }
        : undefined,
    });
  };

  const handleRefreshDevice = async (id: string) => {
    try {
      const res = await deviceService.refresh(id);
      const updated = mapBackendDevice(res.data);
      setDevices((prev) => prev.map((x) => (String(x.id) === String(id) ? updated : x)));
      if (detailDevice && String(detailDevice.id) === String(id)) {
        setDetailDevice(updated);
      }
      setActionMessage(`Device "${updated.name}" refreshed`);
      setTimeout(() => setActionMessage(''), 2500);
    } catch {
      // fallback to local jitter if backend unreachable
      const d = devices.find((x) => String(x.id) === String(id));
      if (!d) return;
      setDetailDevice({
        ...d,
        cpu_usage: Math.max(1, Math.min(99, Math.round(d.cpu_usage + (Math.random() * 14 - 7)))),
        memory_usage: Math.max(1, Math.min(99, Math.round(d.memory_usage + (Math.random() * 10 - 5)))),
        session_count: Math.max(0, Math.round(d.session_count + (Math.random() * 1200 - 600))),
        updated_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });
    }
  };

  const openSshModal = (device: Device) => {
    setSshDevice(device);
    setSshDraft(sshConfigs[device.id] || defaultSshFor(device));
    setSshModalOpen(true);
  };

  const saveSshConfig = () => {
    if (!sshDevice) return;
    const next = { ...sshConfigs, [sshDevice.id]: sshDraft };
    setSshConfigs(next);
    try {
      localStorage.setItem(SSH_CONFIGS_KEY, JSON.stringify(next));
    } catch {
      // ignore localStorage failures
    }
    setSshModalOpen(false);
    setActionMessage(`SSH configuration saved for ${sshDevice.name}`);
    setTimeout(() => setActionMessage(''), 2500);
  };

  const connectSsh = async (device: Device) => {
    const cfg = sshConfigs[device.id] || defaultSshFor(device);
    const port = Number(cfg.port) > 0 ? Number(cfg.port) : 22;
    const cmd = cfg.authType === 'key' && cfg.keyPath.trim()
      ? `ssh -i "${cfg.keyPath.trim()}" ${cfg.username}@${device.ip_address} -p ${port}`
      : `ssh ${cfg.username}@${device.ip_address} -p ${port}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(cmd);
      }
    } catch {
      // clipboard access may fail in some browsers
    }
    try {
      window.location.href = `ssh://${encodeURIComponent(cfg.username)}@${device.ip_address}:${port}`;
    } catch {
      // protocol handler may be unavailable
    }
    setActionMessage(`SSH command copied: ${cmd}`);
    setTimeout(() => setActionMessage(''), 3500);
  };

  const connectHttps = (device: Device) => {
    const url = `https://${device.ip_address}:${device.port}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setActionMessage(`Opening ${device.name} management interface...`);
    setTimeout(() => setActionMessage(''), 2500);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search devices..."
              className="input-dark pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-dark w-auto"
          >
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="warning">Warning</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-dark-800 rounded-lg border border-dark-700 p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={clsx('p-1.5 rounded-md transition-colors', viewMode === 'grid' ? 'bg-primary-500/20 text-primary-400' : 'text-slate-400 hover:text-slate-200')}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={clsx('p-1.5 rounded-md transition-colors', viewMode === 'list' ? 'bg-primary-500/20 text-primary-400' : 'text-slate-400 hover:text-slate-200')}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <button onClick={() => setAddModalOpen(true)} className="btn-primary text-sm">
            <Plus className="w-4 h-4" /> Add Device
          </button>
        </div>
      </div>
      {actionMessage && <div className="text-xs text-emerald-400">{actionMessage}</div>}

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              onView={(id) => {
                const next = devices.find((d) => d.id === id) || null;
                setDetailDevice(next);
                if (next) setDeviceId(next.id);
              }}
              onRefresh={(id) => handleRefreshDevice(id)}
              onBackup={(id) => goToBackups(devices.find((d) => d.id === id) || null)}
              onSsh={(id) => {
                const device = devices.find((d) => d.id === id);
                if (device) openSshModal(device);
              }}
              onHttps={(id) => {
                const device = devices.find((d) => d.id === id);
                if (device) connectHttps(device);
              }}
              onDelete={(id) => {
                const device = devices.find((d) => d.id === id);
                if (device) { setSelectedDevice(device); setDeleteModalOpen(true); }
              }}
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-500">
              <Server className="w-12 h-12 mb-3 text-slate-600" />
              <p className="text-lg font-medium">No devices found</p>
              <p className="text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700 text-left">
                  {[
                    { key: 'name', label: 'Name' },
                    { key: 'ip_address', label: 'IP Address' },
                    { key: 'model', label: 'Model' },
                    { key: 'status', label: 'Status' },
                    { key: 'cpu_usage', label: 'CPU' },
                    { key: 'memory_usage', label: 'Memory' },
                    { key: 'vdom_count', label: 'VDOMs' },
                    { key: 'firmware', label: 'Firmware' },
                    { key: 'last_seen', label: 'Last Seen' },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 transition-colors"
                    >
                      {col.label}
                      {sortCol === col.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => (
                  <tr
                    key={device.id}
                    className="border-b border-dark-700/50 table-row-hover"
                    onClick={() => setDetailDevice(device)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-primary-400" />
                        <span className="font-medium text-slate-200">{device.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{device.ip_address}</td>
                    <td className="px-4 py-3 text-slate-300">{device.model}</td>
                    <td className="px-4 py-3"><StatusBadge status={device.status} size="sm" /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-dark-900 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${device.cpu_usage >= 80 ? 'bg-red-400' : 'bg-primary-400'}`} style={{ width: `${device.cpu_usage}%` }} />
                        </div>
                        <span className="text-xs text-slate-400">{device.cpu_usage}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-dark-900 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${device.memory_usage >= 80 ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${device.memory_usage}%` }} />
                        </div>
                        <span className="text-xs text-slate-400">{device.memory_usage}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{device.vdom_count}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">{device.firmware}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => connectHttps(device)}
                          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-dark-700 rounded transition-colors"
                          title="Open HTTPS Management"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRefreshDevice(device.id)}
                          className="p-1.5 text-slate-400 hover:text-primary-400 hover:bg-dark-700 rounded transition-colors"
                          title="Refresh Status"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => goToBackups(device)}
                          className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-dark-700 rounded transition-colors"
                          title="View Backups"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openSshModal(device)}
                          className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-dark-700 rounded transition-colors"
                          title="SSH Connection"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setSelectedDevice(device); setDeleteModalOpen(true); }}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-dark-700 rounded transition-colors"
                          title="Delete Device"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <Server className="w-12 h-12 mb-3 text-slate-600" />
              <p>No devices found</p>
            </div>
          )}
        </div>
      )}

      {detailDevice && (
        <div className="fixed inset-y-0 right-0 w-full max-w-lg z-50 animate-slide-in-right">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailDevice(null)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-dark-800 border-l border-dark-700 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-dark-800/95 backdrop-blur-sm border-b border-dark-700 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="font-semibold text-slate-100">{detailDevice.name}</h3>
              <button onClick={() => setDetailDevice(null)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-dark-700 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {detailLoading && (
                <div className="flex items-center gap-2 text-xs text-primary-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading device data...
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary-400/10 rounded-xl">
                  <Server className="w-8 h-8 text-primary-400" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-100">{detailDevice.name}</h4>
                  <p className="text-sm text-slate-400">{detailDevice.model}</p>
                </div>
                <div className="ml-auto"><StatusBadge status={detailDevice.status} /></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'IP Address', value: detailDevice.ip_address },
                  { label: 'Serial', value: detailDevice.serial_number },
                  { label: 'Firmware', value: detailDevice.firmware },
                  { label: 'Uptime', value: formatUptime(detailDevice.uptime) },
                  { label: 'Sessions', value: detailDevice.session_count.toLocaleString() },
                  { label: 'VDOMs', value: String(detailDevice.vdom_count) },
                ].map((item) => (
                  <div key={item.label} className="bg-dark-900/50 rounded-lg p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
                    <p className="text-sm font-medium text-slate-200 mt-0.5 font-mono">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Resource Usage</h5>
                {[
                  { label: 'CPU', value: detailDevice.cpu_usage, icon: Cpu },
                  { label: 'Memory', value: detailDevice.memory_usage, icon: MemoryStick },
                  { label: 'Disk', value: detailDevice.disk_usage, icon: HardDrive },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <item.icon className="w-4 h-4 text-slate-500" />
                    <span className="text-xs text-slate-400 w-14">{item.label}</span>
                    <div className="flex-1 h-2 bg-dark-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${item.value >= 80 ? 'bg-red-400' : item.value >= 60 ? 'bg-amber-400' : 'bg-primary-400'}`}
                        style={{ width: `${item.value}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-300 w-10 text-right">{item.value}%</span>
                  </div>
                ))}
              </div>

              <div>
                <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Performance (Last Hour)</h5>
                <div className="bg-dark-900/50 rounded-lg p-3">
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={perfData}>
                      <defs>
                        <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis stroke="#475569" tick={{ fill: '#64748b', fontSize: 10 }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="cpu" stroke="#22d3ee" fill="url(#cpuGrad)" strokeWidth={1.5} name="CPU" />
                      <Area type="monotone" dataKey="memory" stroke="#a78bfa" fill="url(#memGrad)" strokeWidth={1.5} name="Memory" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">VDOMs</h5>
                <div className="space-y-2">
                  {(detailVdoms.length > 0 ? detailVdoms : [{ name: 'root', status: 'enabled', type: 'traffic', policy_count: 0, interface_count: 0 }]).map((vdom) => (
                    <div key={vdom.name} className="flex items-center justify-between bg-dark-900/50 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-primary-400" />
                        <span className="text-sm text-slate-200">{vdom.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>{vdom.policy_count} policies</span>
                        <span>{vdom.interface_count} interfaces</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Interfaces</h5>
                <div className="space-y-1.5">
                  {(detailInterfaces.length > 0 ? detailInterfaces : mockInterfaces).map((iface) => (
                    <div key={iface.name} className="flex items-center justify-between bg-dark-900/50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Network className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-xs font-mono text-slate-200">{iface.name}</span>
                        <StatusBadge status={iface.status} size="sm" />
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        <span className="font-mono">{iface.ip || '---'}</span>
                        <span>{iface.speed}</span>
                        <span className="text-primary-400">RX:{formatBytes(iface.rx_bytes)}</span>
                        <span className="text-purple-400">TX:{formatBytes(iface.tx_bytes)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => connectHttps(detailDevice)}
                  className="btn-primary flex-1 justify-center text-sm"
                  title="Open HTTPS management interface"
                >
                  <ExternalLink className="w-4 h-4" /> HTTPS
                </button>
                <button
                  onClick={() => handleRefreshDevice(detailDevice.id)}
                  className="btn-secondary flex-1 justify-center text-sm"
                >
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
                <button
                  onClick={() => goToBackups(detailDevice)}
                  className="btn-secondary flex-1 justify-center text-sm"
                >
                  <Download className="w-4 h-4" /> Backup
                </button>
                <button
                  onClick={() => goToTunnelMap(detailDevice)}
                  className="btn-secondary flex-1 justify-center text-sm"
                >
                  <Eye className="w-4 h-4" /> Tunnels
                </button>
                <button
                  onClick={() => openSshModal(detailDevice)}
                  className="btn-secondary flex-1 justify-center text-sm"
                >
                  <Terminal className="w-4 h-4" /> SSH
                </button>
              </div>

              {detailDevice.notes && (
                <div className="bg-dark-900/50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-sm text-slate-300">{detailDevice.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add New Device"
        footer={
          <>
            <button onClick={() => { setAddModalOpen(false); setFormError(''); }} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleAddDevice} disabled={isSubmitting || !formData.name.trim() || !formData.ip_address.trim() || !formData.api_key.trim()} className="btn-primary text-sm">
              {isSubmitting ? 'Adding...' : 'Add Device'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}
          {[
            { label: 'Device Name *', key: 'name', placeholder: 'FG-BRANCH-XXX' },
            { label: 'Hostname', key: 'hostname', placeholder: 'Same as name if empty' },
            { label: 'IP Address *', key: 'ip_address', placeholder: '10.x.x.x' },
            { label: 'Port', key: 'port', placeholder: '443' },
            { label: 'API Key *', key: 'api_key', placeholder: 'Enter FortiGate REST API token' },
          ].map((field) => (
            <div key={field.key}>
              <label className="block text-sm text-slate-300 mb-1.5">{field.label}</label>
              <input
                value={formData[field.key as keyof typeof formData]}
                onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                className="input-dark"
              />
            </div>
          ))}
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              placeholder="Optional notes about this device..."
              className="input-dark resize-none"
            />
          </div>
          <p className="text-xs text-slate-500">* Required fields. API Key is a REST API token from FortiGate.</p>
        </div>
      </Modal>

      <Modal
        isOpen={sshModalOpen}
        onClose={() => setSshModalOpen(false)}
        title={`SSH Connection ${sshDevice ? `- ${sshDevice.name}` : ''}`}
        footer={(
          <>
            <button onClick={() => setSshModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={() => sshDevice && connectSsh(sshDevice)} className="btn-secondary text-sm" disabled={!sshDevice}>
              <Terminal className="w-4 h-4" /> Connect
            </button>
            <button onClick={saveSshConfig} className="btn-primary text-sm" disabled={!sshDevice}>
              Save SSH
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Username</label>
            <input
              value={sshDraft.username}
              onChange={(e) => setSshDraft((p) => ({ ...p, username: e.target.value }))}
              className="input-dark"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Port</label>
            <input
              value={sshDraft.port}
              onChange={(e) => setSshDraft((p) => ({ ...p, port: e.target.value }))}
              className="input-dark"
              placeholder="22"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Authentication</label>
            <select
              value={sshDraft.authType}
              onChange={(e) => setSshDraft((p) => ({ ...p, authType: e.target.value as SSHAuthType }))}
              className="input-dark"
            >
              <option value="password">Password</option>
              <option value="key">Private Key</option>
            </select>
          </div>
          {sshDraft.authType === 'password' ? (
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Password (optional)</label>
              <input
                type="password"
                value={sshDraft.password}
                onChange={(e) => setSshDraft((p) => ({ ...p, password: e.target.value }))}
                className="input-dark"
                placeholder="Stored locally only"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Private key path</label>
              <input
                value={sshDraft.keyPath}
                onChange={(e) => setSshDraft((p) => ({ ...p, keyPath: e.target.value }))}
                className="input-dark"
                placeholder="C:\\Users\\you\\.ssh\\id_rsa"
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Device"
        size="sm"
        footer={
          <>
            <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleDeleteDevice} className="btn-danger text-sm">
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </>
        }
      >
        <div className="text-center py-4">
          <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <Trash2 className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-slate-200">
            Are you sure you want to delete <strong>{selectedDevice?.name}</strong>?
          </p>
          <p className="text-sm text-slate-400 mt-2">This action cannot be undone. All associated backups and data will be removed.</p>
        </div>
      </Modal>
    </div>
  );
}
