import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Bell, AlertTriangle, XCircle, Info, CheckCircle2, Check,
  CheckCheck, RefreshCw, Wifi, WifiOff, Cpu, Shield, HardDrive,
  Activity,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { Alert } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { useScope } from '@/hooks/useScope';

const mockAlerts: Alert[] = [
  { id: 'a1', device_id: '5', device_name: 'FG-BRANCH-TKY', severity: 'critical', type: 'device_down', message: 'Device unreachable — connection timeout after 3 consecutive retries. Last successful contact: 1 hour ago.', acknowledged: false, created_at: new Date(Date.now() - 1800000).toISOString() },
  { id: 'a2', device_id: '6', device_name: 'FG-BRANCH-SYD', severity: 'critical', type: 'high_memory', message: 'Memory usage at 91% — exceeds critical threshold of 90%. Risk of service degradation or device reboot.', acknowledged: false, created_at: new Date(Date.now() - 2400000).toISOString() },
  { id: 'a3', device_id: '6', device_name: 'FG-BRANCH-SYD', severity: 'high', type: 'high_cpu', message: 'CPU usage sustained above 85% for 15 minutes (currently 87%). Investigate running processes.', acknowledged: false, created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'a4', device_id: '1', device_name: 'FG-HQ-DC1', severity: 'high', type: 'tunnel_down', message: 'IPSec tunnel "HQ-DC1-to-TKY" is down. Phase 1 negotiation failed — peer unreachable.', acknowledged: false, created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'a5', device_id: '3', device_name: 'FG-BRANCH-NYC', severity: 'medium', type: 'tunnel_flap', message: 'VPN tunnel "NYC-to-HQ" flapped 3 times in the last hour. Possible WAN instability.', acknowledged: true, created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: 'a6', device_id: '6', device_name: 'FG-BRANCH-SYD', severity: 'medium', type: 'high_disk', message: 'Disk usage at 78% — approaching warning threshold of 80%. Consider cleanup or expansion.', acknowledged: false, created_at: new Date(Date.now() - 14400000).toISOString() },
  { id: 'a7', device_id: '6', device_name: 'FG-BRANCH-SYD', severity: 'low', type: 'firmware_update', message: 'Firmware update available: v7.4.3 (current: v7.2.8). Includes security patches and performance improvements.', acknowledged: false, created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'a8', device_id: '4', device_name: 'FG-BRANCH-LON', severity: 'low', type: 'config_change', message: 'Configuration changed by admin "netops" at 14:32 UTC. 3 firewall policies modified.', acknowledged: true, created_at: new Date(Date.now() - 43200000).toISOString() },
  { id: 'a9', device_id: '1', device_name: 'FG-HQ-DC1', severity: 'info', type: 'backup_success', message: 'Scheduled backup completed successfully. Configuration saved (245 KB).', acknowledged: true, created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'a10', device_id: '2', device_name: 'FG-HQ-DC2', severity: 'info', type: 'ha_sync', message: 'HA configuration synchronized successfully with FG-HQ-DC1. All checksums match.', acknowledged: true, created_at: new Date(Date.now() - 172800000).toISOString() },
  { id: 'a11', device_id: '1', device_name: 'FG-HQ-DC1', severity: 'medium', type: 'certificate_expiry', message: 'SSL certificate for "vpn.company.com" expires in 14 days. Renewal recommended.', acknowledged: false, created_at: new Date(Date.now() - 28800000).toISOString() },
  { id: 'a12', device_id: '3', device_name: 'FG-BRANCH-NYC', severity: 'low', type: 'license_warning', message: 'FortiGuard Web Filter license expires in 30 days. Contact Fortinet for renewal.', acknowledged: false, created_at: new Date(Date.now() - 259200000).toISOString() },
];

type Severity = 'all' | 'critical' | 'high' | 'medium' | 'low' | 'info';

const severityConfig: Record<string, { color: string; border: string; bg: string; icon: React.ElementType }> = {
  critical: { color: 'text-red-400', border: 'border-l-red-500', bg: 'bg-red-500/5', icon: XCircle },
  high: { color: 'text-orange-400', border: 'border-l-orange-500', bg: 'bg-orange-500/5', icon: AlertTriangle },
  medium: { color: 'text-amber-400', border: 'border-l-amber-500', bg: 'bg-amber-500/5', icon: AlertTriangle },
  low: { color: 'text-blue-400', border: 'border-l-blue-500', bg: 'bg-blue-500/5', icon: Info },
  info: { color: 'text-slate-400', border: 'border-l-slate-500', bg: 'bg-slate-500/5', icon: Info },
};

const typeIcons: Record<string, React.ElementType> = {
  device_down: WifiOff,
  high_cpu: Cpu,
  high_memory: Activity,
  high_disk: HardDrive,
  tunnel_down: WifiOff,
  tunnel_flap: Wifi,
  firmware_update: Shield,
  config_change: Shield,
  backup_success: CheckCircle2,
  ha_sync: RefreshCw,
  certificate_expiry: Shield,
  license_warning: Bell,
};

const tabs: { key: Severity; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
  { key: 'info', label: 'Info' },
];

export default function Alerts() {
  const { scope } = useScope();
  const [activeTab, setActiveTab] = useState<Severity>('all');
  const [alerts, setAlerts] = useState(mockAlerts);
  const scopedAlerts = useMemo(() => (
    scope.deviceId === 'all' ? alerts : alerts.filter((a) => a.device_id === scope.deviceId)
  ), [alerts, scope.deviceId]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return scopedAlerts;
    return scopedAlerts.filter((a) => a.severity === activeTab);
  }, [activeTab, scopedAlerts]);

  const unackCount = scopedAlerts.filter((a) => !a.acknowledged).length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of scopedAlerts) {
      c[a.severity] = (c[a.severity] || 0) + 1;
    }
    return c;
  }, [scopedAlerts]);

  const handleAcknowledge = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  };

  const handleAcknowledgeAll = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {tabs.map((tab) => {
              const count = tab.key === 'all' ? scopedAlerts.length : (counts[tab.key] || 0);
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border',
                  activeTab === tab.key
                    ? 'bg-primary-500/10 text-primary-400 border-primary-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-dark-800 border-transparent'
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded-full',
                    activeTab === tab.key ? 'bg-primary-400/20' : 'bg-dark-700'
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {unackCount > 0 && (
            <span className="text-xs text-slate-400">
              <span className="text-red-400 font-medium">{unackCount}</span> unacknowledged
            </span>
          )}
          <button onClick={handleAcknowledgeAll} className="btn-secondary text-sm" disabled={unackCount === 0}>
            <CheckCheck className="w-4 h-4" /> Acknowledge All
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((alert) => {
          const config = severityConfig[alert.severity] || severityConfig.info;
          const TypeIcon = typeIcons[alert.type] || Bell;
          const SeverityIcon = config.icon;

          return (
            <div
              key={alert.id}
              className={clsx(
                'glass-card p-4 border-l-[3px] transition-all duration-200',
                config.border,
                config.bg,
                alert.acknowledged && 'opacity-60'
              )}
            >
              <div className="flex items-start gap-3">
                <div className={clsx('mt-0.5 p-1.5 rounded-lg', `${config.color.replace('text-', 'bg-').replace('-400', '-400/10')}`)}>
                  <SeverityIcon className={clsx('w-4 h-4', config.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx('text-xs font-bold uppercase tracking-wider', config.color)}>
                      {alert.severity}
                    </span>
                    <span className="text-slate-600">•</span>
                    <div className="flex items-center gap-1 text-xs text-slate-300">
                      <TypeIcon className="w-3 h-3" />
                      {alert.type.replace(/_/g, ' ')}
                    </div>
                    <span className="text-slate-600">•</span>
                    <span className="text-xs text-primary-400 font-medium">{alert.device_name}</span>
                    {alert.acknowledged && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
                        <Check className="w-2.5 h-2.5" /> ACK
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-200 mt-1.5 leading-relaxed">{alert.message}</p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-slate-500">
                      {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                    </p>
                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 hover:bg-dark-700 px-2 py-1 rounded transition-colors"
                      >
                        <Check className="w-3 h-3" /> Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-600" />
            <p className="text-lg font-medium">No alerts</p>
            <p className="text-sm mt-1">Everything looks good!</p>
          </div>
        )}
      </div>
    </div>
  );
}
