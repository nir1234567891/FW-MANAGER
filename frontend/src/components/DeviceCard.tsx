import { Server, RefreshCw, Download, Eye, Cpu, MemoryStick, HardDrive, Terminal, ExternalLink } from 'lucide-react';
import StatusBadge from './StatusBadge';
import type { Device } from '@/types';
import { clsx } from 'clsx';

interface DeviceCardProps {
  device: Device;
  onRefresh?: (id: string) => void;
  onBackup?: (id: string) => void;
  onView?: (id: string) => void;
  onSsh?: (id: string) => void;
  onHttps?: (id: string) => void;
}

function UsageBar({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  const getColor = (v: number) => {
    if (v >= 90) return 'bg-red-400';
    if (v >= 70) return 'bg-amber-400';
    return 'bg-primary-400';
  };

  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <div className="flex-1">
        <div className="h-1.5 bg-dark-900 rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full transition-all duration-500', getColor(value))} style={{ width: `${value}%` }} />
        </div>
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{value}%</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export default function DeviceCard({ device, onRefresh, onBackup, onView, onSsh, onHttps }: DeviceCardProps) {
  return (
    <div className="glass-card-hover p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-400/10 rounded-lg">
            <Server className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-100">{device.name}</h3>
            <p className="text-xs text-slate-400">{device.model}</p>
          </div>
        </div>
        <StatusBadge status={device.status} size="sm" />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div className="text-slate-500">IP Address</div>
        <div className="text-slate-200 text-right font-mono text-xs">{device.ip_address}</div>
        <div className="text-slate-500">Firmware</div>
        <div className="text-slate-200 text-right text-xs">{device.firmware}</div>
        <div className="text-slate-500">VDOMs</div>
        <div className="text-slate-200 text-right">{device.vdom_count}</div>
        <div className="text-slate-500">Uptime</div>
        <div className="text-slate-200 text-right text-xs">{formatUptime(device.uptime)}</div>
      </div>

      <div className="flex flex-col gap-2">
        <UsageBar label="CPU" value={device.cpu_usage} icon={Cpu} />
        <UsageBar label="Memory" value={device.memory_usage} icon={MemoryStick} />
        <UsageBar label="Disk" value={device.disk_usage} icon={HardDrive} />
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-dark-700/50">
        <button
          onClick={() => onHttps?.(device.id)}
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-blue-400 hover:bg-dark-700 rounded-md transition-colors"
          title="Open HTTPS Management"
        >
          <ExternalLink className="w-3.5 h-3.5" /> HTTPS
        </button>
        <button
          onClick={() => onSsh?.(device.id)}
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-cyan-400 hover:bg-dark-700 rounded-md transition-colors"
          title="SSH Connection"
        >
          <Terminal className="w-3.5 h-3.5" /> SSH
        </button>
        <button
          onClick={() => onRefresh?.(device.id)}
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-primary-400 hover:bg-dark-700 rounded-md transition-colors"
          title="Refresh Status"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
        <button
          onClick={() => onBackup?.(device.id)}
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-emerald-400 hover:bg-dark-700 rounded-md transition-colors"
          title="View Backups"
        >
          <Download className="w-3.5 h-3.5" /> Backup
        </button>
        <button
          onClick={() => onView?.(device.id)}
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-amber-400 hover:bg-dark-700 rounded-md transition-colors col-span-2"
          title="View Details"
        >
          <Eye className="w-3.5 h-3.5" /> View Details
        </button>
      </div>
    </div>
  );
}
