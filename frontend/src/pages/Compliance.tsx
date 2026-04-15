import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  Server, Cpu, Activity, RefreshCw, Zap, Info, Loader2, Clock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { complianceService, deviceService } from '@/services/api';
import { useToast } from '@/components/Toast';
import { formatDistanceToNow } from 'date-fns';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'ok';

interface CheckResult {
  compliant: boolean;
  details: string;
  [key: string]: unknown;
}

interface ComplianceData {
  device_id: number;
  device_name: string;
  status: string;
  model?: string;
  firmware: CheckResult & { version: string };
  checks: Record<string, CheckResult>;
  resources: { cpu: number; memory: number };
  checks_passed: number;
  checks_total: number;
  score: number;
  source: string;
  last_checked: string;
  error?: string;
}

interface DeviceInfo {
  id: string;
  name: string;
  status: string;
}

const CHECK_META: Record<string, { label: string; description: string; expectedValue: string; severity: Severity }> = {
  firmware:       { label: 'Firmware Version',     description: 'Device should run a supported FortiOS version (≥ v7.2)', expectedValue: '≥ v7.2', severity: 'high' },
  ntp:            { label: 'NTP Synchronization',   description: 'NTP must be configured and actively syncing', expectedValue: 'Enabled', severity: 'medium' },
  dns:            { label: 'Dual DNS Servers',      description: 'At least two DNS servers for redundancy', expectedValue: '2 servers', severity: 'low' },
  admin_timeout:  { label: 'Admin Session Timeout', description: 'Idle admin sessions must timeout (1–480 min)', expectedValue: '1–480 min', severity: 'medium' },
  admin_https:    { label: 'HTTPS Admin Access',    description: 'Admin interface should use HTTPS (not plain HTTP)', expectedValue: 'HTTPS enabled', severity: 'high' },
  ssh_v1:         { label: 'SSH v1 Disabled',       description: 'Legacy SSHv1 protocol must be disabled', expectedValue: 'Disabled', severity: 'high' },
  strong_crypto:  { label: 'Strong Cryptography',   description: 'Weak cipher suites should be disabled', expectedValue: 'Enabled', severity: 'high' },
  telnet:         { label: 'Telnet Disabled',        description: 'Plaintext Telnet access must be disabled', expectedValue: 'Disabled', severity: 'critical' },
  syslog:         { label: 'Syslog Forwarding',     description: 'Logs should be forwarded to a central syslog server', expectedValue: 'Enabled', severity: 'medium' },
  cli_audit:      { label: 'CLI Audit Logging',     description: 'Admin CLI commands should be logged for audit trail', expectedValue: 'Enabled', severity: 'medium' },
};

const severityConfig: Record<Severity, { color: string; bg: string; icon: React.ReactNode }> = {
  critical: { color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/20',    icon: <XCircle className="w-4 h-4 text-red-400" /> },
  high:     { color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20', icon: <AlertTriangle className="w-4 h-4 text-orange-400" /> },
  medium:   { color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20',   icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
  low:      { color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/20',     icon: <Info className="w-4 h-4 text-blue-400" /> },
  ok:       { color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20', icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
};

function ScoreCircle({ score, size = 80 }: { score: number; size?: number }) {
  const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="16" fill="none" stroke="#1e293b" strokeWidth="3" />
        <circle cx="18" cy="18" r="16" fill="none" stroke={color}
          strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 100.53} ${100.53 - (score / 100) * 100.53}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold" style={{ color }}>{grade}</span>
        <span className="text-[9px] text-slate-500">{score}</span>
      </div>
    </div>
  );
}

export default function Compliance() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'compliance' | 'health'>('compliance');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [complianceMap, setComplianceMap] = useState<Record<string, ComplianceData>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [loadingDevices, setLoadingDevices] = useState<Set<string>>(new Set());

  const fetchDevices = useCallback(async () => {
    try {
      const res = await deviceService.getAll();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (res.data as any[]).map((d) => ({
        id: String(d.id),
        name: d.name,
        status: d.status,
      }));
      setDevices(list);
      return list;
    } catch {
      addToast('error', 'Failed to load devices');
      return [];
    }
  }, [addToast]);

  const fetchComplianceForDevice = useCallback(async (deviceId: string) => {
    setLoadingDevices((prev) => new Set(prev).add(deviceId));
    try {
      const res = await complianceService.getDevice(deviceId);
      setComplianceMap((prev) => ({ ...prev, [deviceId]: res.data as ComplianceData }));
    } catch {
      // Keep previous data
    } finally {
      setLoadingDevices((prev) => {
        const next = new Set(prev);
        next.delete(deviceId);
        return next;
      });
    }
  }, []);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const list = await fetchDevices();
      // Fetch compliance for all devices in parallel
      await Promise.allSettled(list.map((d) => fetchComplianceForDevice(d.id)));
      if (silent) addToast('success', 'Compliance data refreshed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchDevices, fetchComplianceForDevice, addToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const allChecks = devices.map((d) => complianceMap[d.id]).filter(Boolean);
  const totalChecks = allChecks.reduce((s, d) => s + d.checks_total, 0);
  const passedChecks = allChecks.reduce((s, d) => s + d.checks_passed, 0);
  const complianceRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
  const avgScore = allChecks.length > 0 ? Math.round(allChecks.reduce((s, d) => s + d.score, 0) / allChecks.length) : 0;

  // Build compliance matrix rows
  const checkKeys = ['firmware', ...Object.keys(CHECK_META).filter((k) => k !== 'firmware')];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-400 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Running compliance checks on all devices...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveTab('compliance')} className={clsx('btn-secondary text-sm', activeTab === 'compliance' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}>
            <ShieldCheck className="w-4 h-4" /> Compliance Checker
          </button>
          <button onClick={() => setActiveTab('health')} className={clsx('btn-secondary text-sm', activeTab === 'health' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}>
            <Activity className="w-4 h-4" /> Health Score
          </button>
        </div>
        <button onClick={() => fetchAll(true)} disabled={refreshing} className="btn-secondary text-sm">
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {activeTab === 'compliance' && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-4">
              <p className="text-xs text-slate-400 mb-1">Total Checks</p>
              <p className="text-2xl font-bold text-slate-100">{totalChecks}</p>
              <p className="text-[10px] text-slate-500 mt-1">{devices.length} devices</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-slate-400 mb-1">Passed</p>
              <p className="text-2xl font-bold text-emerald-400">{passedChecks}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-slate-400 mb-1">Failed</p>
              <p className="text-2xl font-bold text-red-400">{totalChecks - passedChecks}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-slate-400 mb-1">Compliance Rate</p>
              <p className={clsx('text-2xl font-bold', complianceRate >= 80 ? 'text-emerald-400' : complianceRate >= 60 ? 'text-amber-400' : 'text-red-400')}>
                {complianceRate}%
              </p>
            </div>
          </div>

          {/* Compliance Matrix */}
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700">
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider sticky left-0 bg-dark-800/95 z-10 text-left">Check</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-left">Expected</th>
                    {devices.map((d) => (
                      <th key={d.id} className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <span>{d.name}</span>
                          {loadingDevices.has(d.id) && <Loader2 className="w-3 h-3 animate-spin text-primary-400" />}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checkKeys.map((key) => {
                    const meta = key === 'firmware' ? { label: 'Firmware Version', description: 'Device should run a supported FortiOS version (≥ v7.2)', expectedValue: '≥ v7.2' } : CHECK_META[key];
                    if (!meta) return null;
                    const isExpanded = expandedCheck === key;
                    return (
                      <tr key={key}
                        className="border-b border-dark-700/50 hover:bg-dark-800/30 cursor-pointer transition-colors"
                        onClick={() => setExpandedCheck(isExpanded ? null : key)}
                      >
                        <td className="px-3 py-2.5 sticky left-0 bg-dark-800/95 z-10">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                            <div>
                              <p className="text-xs text-slate-200 font-medium">{meta.label}</p>
                              {isExpanded && <p className="text-[10px] text-slate-500 mt-0.5">{meta.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-400 font-mono">{meta.expectedValue}</td>
                        {devices.map((d) => {
                          const cdata = complianceMap[d.id];
                          if (!cdata) return <td key={d.id} className="px-3 py-2.5 text-center"><Loader2 className="w-3 h-3 animate-spin text-slate-600 mx-auto" /></td>;
                          const check = key === 'firmware' ? cdata.firmware : cdata.checks[key];
                          if (!check) return <td key={d.id} className="px-3 py-2.5 text-center text-slate-600">—</td>;
                          return (
                            <td key={d.id} className="px-3 py-2.5 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                {check.compliant
                                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                  : <XCircle className="w-4 h-4 text-red-400" />}
                                {isExpanded && (
                                  <span className={clsx('text-[10px] max-w-[120px] text-center', check.compliant ? 'text-slate-500' : 'text-red-300')}>
                                    {check.details}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-device compliance bars */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Per-Device Compliance</h3>
            <div className="space-y-2">
              {devices.map((d) => {
                const cdata = complianceMap[d.id];
                const pct = cdata?.score ?? 0;
                const isLoading = loadingDevices.has(d.id);
                return (
                  <div key={d.id} className="flex items-center gap-3">
                    <span className="text-xs text-slate-300 w-36 truncate">{d.name}</span>
                    <div className="flex-1 h-3 bg-dark-900 rounded-full overflow-hidden">
                      {isLoading
                        ? <div className="h-full bg-dark-700 animate-pulse rounded-full" />
                        : <div className={clsx('h-full rounded-full transition-all', pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400')} style={{ width: `${pct}%` }} />
                      }
                    </div>
                    {isLoading
                      ? <Loader2 className="w-3 h-3 animate-spin text-slate-600" />
                      : <span className={clsx('text-xs font-bold w-12 text-right', pct >= 80 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400')}>{pct}%</span>
                    }
                    {cdata && <span className="text-[10px] text-slate-500 w-16">{cdata.checks_passed}/{cdata.checks_total}</span>}
                    {cdata && (
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', cdata.source === 'live' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-slate-700/50 text-slate-500')}>
                        {cdata.source === 'live' ? 'live' : cdata.source === 'offline' ? 'offline' : 'cached'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'health' && (
        <div className="space-y-4">
          {/* Avg health */}
          <div className="glass-card p-5 flex items-center gap-6">
            <ScoreCircle score={avgScore} size={96} />
            <div>
              <h3 className="text-lg font-semibold text-slate-100">Average Network Health</h3>
              <p className="text-sm text-slate-400 mt-1">Across {devices.length} device(s) — live compliance data</p>
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                {devices.map((d) => {
                  const cdata = complianceMap[d.id];
                  if (!cdata) return null;
                  const grade = cdata.score >= 90 ? 'A+' : cdata.score >= 80 ? 'A' : cdata.score >= 70 ? 'B' : cdata.score >= 60 ? 'C' : cdata.score >= 40 ? 'D' : 'F';
                  const color = cdata.score >= 80 ? 'text-emerald-400' : cdata.score >= 60 ? 'text-amber-400' : 'text-red-400';
                  return (
                    <div key={d.id} className="flex items-center gap-1.5">
                      <span className={clsx('text-sm font-bold', color)}>{grade}</span>
                      <span className="text-[10px] text-slate-500">{d.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Device health cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {devices.map((d) => {
              const cdata = complianceMap[d.id];
              const isLoading = loadingDevices.has(d.id);
              const isSelected = selectedDevice === d.id;

              if (isLoading || !cdata) {
                return (
                  <div key={d.id} className="glass-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Server className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-semibold text-slate-100">{d.name}</span>
                    </div>
                    <div className="animate-pulse space-y-2">
                      <div className="h-3 bg-dark-700 rounded" />
                      <div className="h-3 bg-dark-700 rounded w-3/4" />
                    </div>
                  </div>
                );
              }

              const score = cdata.score;
              const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
              const gradeColor = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
              const gradeBg = score >= 80 ? 'bg-emerald-400/10' : score >= 60 ? 'bg-amber-400/10' : 'bg-red-400/10';

              // Failed checks = recommendations
              const failedChecks = [
                ...(!cdata.firmware.compliant ? [{ key: 'firmware', meta: { label: 'Firmware', severity: 'high' as Severity }, details: cdata.firmware.details }] : []),
                ...Object.entries(cdata.checks)
                  .filter(([, v]) => !v.compliant)
                  .map(([k, v]) => ({ key: k, meta: CHECK_META[k], details: v.details }))
                  .filter((x) => x.meta),
              ];

              return (
                <div key={d.id}
                  className={clsx('glass-card overflow-hidden cursor-pointer transition-all', isSelected && 'ring-1 ring-primary-500/40')}
                  onClick={() => setSelectedDevice(isSelected ? null : d.id)}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-semibold text-slate-100">{d.name}</span>
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', cdata.source === 'live' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-slate-700/50 text-slate-400')}>
                          {cdata.source}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-2xl font-bold', gradeColor)}>{score}</span>
                        <span className={clsx('text-sm font-bold px-2 py-0.5 rounded', gradeColor, gradeBg)}>{grade}</span>
                      </div>
                    </div>

                    {/* Progress bar: checks_passed / checks_total */}
                    <div className="flex h-2 rounded-full overflow-hidden bg-dark-900 mb-3">
                      <div className={clsx('h-full rounded-l-full', score >= 80 ? 'bg-emerald-400' : score >= 60 ? 'bg-amber-400' : 'bg-red-400')}
                        style={{ width: `${score}%` }} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                      <div className="flex items-center gap-1">
                        <Cpu className="w-3 h-3" />
                        <span>CPU {cdata.resources.cpu.toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        <span>MEM {cdata.resources.memory.toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>{cdata.checks_passed}/{cdata.checks_total} checks</span>
                      </div>
                      {cdata.last_checked && (
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatDistanceToNow(new Date(cdata.last_checked), { addSuffix: true })}</span>
                        </div>
                      )}
                    </div>

                    {failedChecks.length > 0 && (
                      <div className="flex items-center gap-2 mt-2 text-xs text-amber-400">
                        <AlertTriangle className="w-3 h-3" />
                        {failedChecks.length} issue(s) found
                      </div>
                    )}
                  </div>

                  {isSelected && failedChecks.length > 0 && (
                    <div className="border-t border-dark-700 p-4 space-y-2">
                      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" /> Failed Checks
                      </p>
                      {failedChecks.map((fc, idx) => {
                        const sev = fc.meta?.severity ?? 'medium';
                        const cfg = severityConfig[sev];
                        return (
                          <div key={idx} className={clsx('rounded-lg border p-3', cfg.bg)}>
                            <div className="flex items-start gap-2">
                              {cfg.icon}
                              <div>
                                <p className={clsx('text-xs font-medium', cfg.color)}>{fc.meta?.label ?? fc.key}</p>
                                <p className="text-[10px] text-slate-400 mt-1 font-mono">{fc.details}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isSelected && failedChecks.length === 0 && (
                    <div className="border-t border-dark-700 p-4">
                      <div className="flex items-center gap-2 text-emerald-400 text-sm">
                        <CheckCircle2 className="w-4 h-4" />
                        All compliance checks passed
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
