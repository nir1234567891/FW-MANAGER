import { useState, useMemo, useEffect } from 'react';
import {
  Bell, AlertTriangle, XCircle, Info, CheckCircle2, Check,
  CheckCheck, RefreshCw, Wifi, WifiOff, Cpu, Shield, HardDrive,
  Activity, Loader2, Trash2, Scan,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { Alert } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { useScope } from '@/hooks/useScope';
import { monitoringService } from '@/services/api';
import { useToast } from '@/components/Toast';

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
  cpu_high: Cpu, cpu_critical: Cpu,
  mem_high: Activity, mem_critical: Activity,
  high_cpu: Cpu, high_memory: Activity, high_disk: HardDrive,
  tunnel_down: WifiOff, tunnel_flap: Wifi,
  firmware_update: Shield, config_change: Shield,
  backup_success: CheckCircle2, backup_complete: CheckCircle2,
  ha_sync: RefreshCw, ha_warning: RefreshCw,
  certificate_expiry: Shield, cert_expiry: Shield,
  license_warning: Bell,
  memory_warning: Activity,
  auth_info: Shield,
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
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<Severity>('all');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchAlerts = async () => {
    try {
      const res = await monitoringService.getAlerts();
      if (Array.isArray(res.data)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAlerts(res.data.map((a: any) => ({
          id: String(a.id),
          device_id: String(a.device_id),
          device_name: a.device_name || `Device ${a.device_id}`,
          severity: a.severity || 'info',
          type: a.alert_type || a.type || 'unknown',
          message: a.message || '',
          acknowledged: a.acknowledged || false,
          created_at: a.created_at || new Date().toISOString(),
        })));
      }
    } catch {
      addToast('error', 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAlerts(); }, []);

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
    for (const a of scopedAlerts) c[a.severity] = (c[a.severity] || 0) + 1;
    return c;
  }, [scopedAlerts]);

  const handleAcknowledge = async (id: string) => {
    try {
      await monitoringService.acknowledgeAlert(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
      addToast('success', 'Alert acknowledged');
    } catch {
      addToast('error', 'Failed to acknowledge alert');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await monitoringService.deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      addToast('success', 'Alert deleted');
    } catch {
      addToast('error', 'Failed to delete alert');
    }
  };

  const handleAcknowledgeAll = async () => {
    setActionLoading(true);
    try {
      await monitoringService.bulkAcknowledge();
      setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
      addToast('success', 'All alerts acknowledged');
    } catch {
      addToast('error', 'Failed to acknowledge alerts');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAcknowledged = async () => {
    setActionLoading(true);
    try {
      const res = await monitoringService.deleteAcknowledged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleted = (res.data as any).deleted || 0;
      setAlerts((prev) => prev.filter((a) => !a.acknowledged));
      addToast('success', `Deleted ${deleted} acknowledged alert(s)`);
    } catch {
      addToast('error', 'Failed to delete acknowledged alerts');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEvaluate = async () => {
    setActionLoading(true);
    try {
      const res = await monitoringService.evaluate();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = res.data as any;
      addToast(
        'success',
        `Scan complete: ${result.devices_checked ?? 0} devices checked, ${result.alerts_created ?? 0} new alerts`,
      );
      await fetchAlerts();
    } catch {
      addToast('error', 'Health evaluation failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
      </div>
    );
  }

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
          <button onClick={handleEvaluate} className="btn-secondary text-sm" disabled={actionLoading}>
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scan className="w-4 h-4" />} Evaluate
          </button>
          <button onClick={fetchAlerts} className="btn-secondary text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={handleAcknowledgeAll} className="btn-secondary text-sm" disabled={unackCount === 0 || actionLoading}>
            <CheckCheck className="w-4 h-4" /> Ack All
          </button>
          <button
            onClick={handleDeleteAcknowledged}
            className="btn-secondary text-sm text-red-400 hover:text-red-300"
            disabled={scopedAlerts.filter((a) => a.acknowledged).length === 0 || actionLoading}
          >
            <Trash2 className="w-4 h-4" /> Clean Up
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
                    <span className="text-slate-600">&#183;</span>
                    <div className="flex items-center gap-1 text-xs text-slate-300">
                      <TypeIcon className="w-3 h-3" />
                      {alert.type.replace(/_/g, ' ')}
                    </div>
                    <span className="text-slate-600">&#183;</span>
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
                    <div className="flex items-center gap-1">
                      {!alert.acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(alert.id)}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 hover:bg-dark-700 px-2 py-1 rounded transition-colors"
                        >
                          <Check className="w-3 h-3" /> Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(alert.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 hover:bg-dark-700 px-2 py-1 rounded transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
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
