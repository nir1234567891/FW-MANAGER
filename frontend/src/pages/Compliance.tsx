import { useState, useMemo } from 'react';
import {
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  Server, Cpu, HardDrive, Wifi, Clock, Key, FileSearch, Activity,
  TrendingUp, RefreshCw, Zap, Info,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useScope, scopeDevices } from '@/hooks/useScope';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'ok';
type CheckCategory = 'firmware' | 'ntp' | 'ha' | 'dns' | 'logging' | 'admin' | 'license' | 'backup' | 'password' | 'snmp';

interface ComplianceCheck {
  id: string;
  category: CheckCategory;
  label: string;
  description: string;
  expectedValue: string;
  results: Record<string, { value: string; compliant: boolean }>;
}

interface HealthMetric {
  id: string;
  label: string;
  weight: number;
  getScore: (deviceId: string) => number;
  getReason: (deviceId: string) => string;
}

const deviceInfo: Record<string, {
  firmware: string; model: string; haMode: string; ntpServer: string; ntpSync: boolean;
  dns1: string; dns2: string; logging: string; adminTimeout: number; adminPort: number;
  licenseExpiry: string; lastBackup: string; adminPasswordAge: number; snmpEnabled: boolean;
  cpu: number; mem: number; disk: number; sessions: number; uptime: number; status: string;
  tunnelsUp: number; tunnelsTotal: number;
}> = {
  '1': { firmware: 'v7.4.3', model: '600E', haMode: 'a-p', ntpServer: 'pool.ntp.org', ntpSync: true, dns1: '8.8.8.8', dns2: '8.8.4.4', logging: 'syslog+disk', adminTimeout: 480, adminPort: 443, licenseExpiry: '2027-03-15', lastBackup: '2026-03-25', adminPasswordAge: 15, snmpEnabled: true, cpu: 45, mem: 62, disk: 38, sessions: 15420, uptime: 8640000, status: 'online', tunnelsUp: 4, tunnelsTotal: 4 },
  '2': { firmware: 'v7.4.3', model: '600E', haMode: 'a-p', ntpServer: 'pool.ntp.org', ntpSync: true, dns1: '8.8.8.8', dns2: '8.8.4.4', logging: 'syslog+disk', adminTimeout: 480, adminPort: 443, licenseExpiry: '2027-03-15', lastBackup: '2026-03-25', adminPasswordAge: 15, snmpEnabled: true, cpu: 38, mem: 55, disk: 42, sessions: 12830, uptime: 8640000, status: 'online', tunnelsUp: 4, tunnelsTotal: 4 },
  '3': { firmware: 'v7.4.2', model: '200F', haMode: 'standalone', ntpServer: 'pool.ntp.org', ntpSync: true, dns1: '8.8.8.8', dns2: '1.1.1.1', logging: 'disk', adminTimeout: 300, adminPort: 8443, licenseExpiry: '2026-06-30', lastBackup: '2026-03-23', adminPasswordAge: 45, snmpEnabled: false, cpu: 22, mem: 41, disk: 25, sessions: 3240, uptime: 2592000, status: 'online', tunnelsUp: 1, tunnelsTotal: 1 },
  '4': { firmware: 'v7.4.2', model: '200F', haMode: 'standalone', ntpServer: '10.2.0.5', ntpSync: true, dns1: '10.2.0.5', dns2: '', logging: 'syslog', adminTimeout: 0, adminPort: 443, licenseExpiry: '2026-09-01', lastBackup: '2026-03-20', adminPasswordAge: 90, snmpEnabled: false, cpu: 31, mem: 48, disk: 30, sessions: 2890, uptime: 1728000, status: 'online', tunnelsUp: 1, tunnelsTotal: 1 },
  '5': { firmware: 'v7.4.1', model: '100F', haMode: 'standalone', ntpServer: '', ntpSync: false, dns1: '8.8.8.8', dns2: '', logging: 'disk', adminTimeout: 300, adminPort: 443, licenseExpiry: '2026-04-15', lastBackup: '2026-02-10', adminPasswordAge: 120, snmpEnabled: false, cpu: 0, mem: 0, disk: 45, sessions: 0, uptime: 0, status: 'offline', tunnelsUp: 0, tunnelsTotal: 1 },
  '6': { firmware: 'v7.2.8', model: '100F', haMode: 'standalone', ntpServer: 'pool.ntp.org', ntpSync: false, dns1: '8.8.8.8', dns2: '8.8.4.4', logging: 'none', adminTimeout: 0, adminPort: 80, licenseExpiry: '2026-04-01', lastBackup: '2026-01-05', adminPasswordAge: 180, snmpEnabled: true, cpu: 87, mem: 91, disk: 78, sessions: 4200, uptime: 604800, status: 'warning', tunnelsUp: 0, tunnelsTotal: 1 },
};

const complianceChecks: ComplianceCheck[] = [
  {
    id: 'c1', category: 'firmware', label: 'Firmware Version', description: 'All devices should run the recommended firmware version',
    expectedValue: 'v7.4.3',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: d.firmware, compliant: d.firmware === 'v7.4.3' }])),
  },
  {
    id: 'c2', category: 'ntp', label: 'NTP Configured', description: 'NTP must be configured and synchronized',
    expectedValue: 'Synced',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: d.ntpSync ? `Synced (${d.ntpServer})` : d.ntpServer ? 'Not synced' : 'Not configured', compliant: d.ntpSync }])),
  },
  {
    id: 'c3', category: 'dns', label: 'Dual DNS Servers', description: 'At least two DNS servers should be configured for redundancy',
    expectedValue: '2 servers',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: d.dns2 ? `${d.dns1}, ${d.dns2}` : d.dns1, compliant: !!d.dns2 }])),
  },
  {
    id: 'c4', category: 'logging', label: 'Syslog Forwarding', description: 'Logs should be forwarded to a central syslog server',
    expectedValue: 'syslog enabled',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: d.logging, compliant: d.logging.includes('syslog') }])),
  },
  {
    id: 'c5', category: 'admin', label: 'Admin Timeout', description: 'Admin session timeout must be set (no unlimited sessions)',
    expectedValue: '> 0 minutes',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: d.adminTimeout > 0 ? `${d.adminTimeout}s` : 'Disabled (unlimited)', compliant: d.adminTimeout > 0 }])),
  },
  {
    id: 'c6', category: 'admin', label: 'HTTPS Admin Port', description: 'Admin interface should use HTTPS (port 443 or custom)',
    expectedValue: 'HTTPS (443)',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: d.adminPort === 80 ? 'HTTP (80) - INSECURE' : `HTTPS (${d.adminPort})`, compliant: d.adminPort !== 80 }])),
  },
  {
    id: 'c7', category: 'license', label: 'License Expiry', description: 'Licenses should have at least 90 days remaining',
    expectedValue: '> 90 days',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => {
      const days = Math.floor((new Date(d.licenseExpiry).getTime() - Date.now()) / 86400000);
      return [id, { value: `${days} days (${d.licenseExpiry})`, compliant: days > 90 }];
    })),
  },
  {
    id: 'c8', category: 'backup', label: 'Recent Backup', description: 'Last backup should be within 7 days',
    expectedValue: '< 7 days',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => {
      const days = Math.floor((Date.now() - new Date(d.lastBackup).getTime()) / 86400000);
      return [id, { value: `${days} days ago (${d.lastBackup})`, compliant: days <= 7 }];
    })),
  },
  {
    id: 'c9', category: 'password', label: 'Admin Password Age', description: 'Admin password should be changed at least every 90 days',
    expectedValue: '< 90 days',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: `${d.adminPasswordAge} days`, compliant: d.adminPasswordAge <= 90 }])),
  },
  {
    id: 'c10', category: 'snmp', label: 'SNMP Configuration', description: 'SNMP should be configured for network monitoring',
    expectedValue: 'Enabled',
    results: Object.fromEntries(Object.entries(deviceInfo).map(([id, d]) => [id, { value: d.snmpEnabled ? 'Enabled' : 'Disabled', compliant: d.snmpEnabled }])),
  },
];

function getHealthScore(deviceId: string): { score: number; grade: string; color: string; items: { label: string; score: number; maxScore: number; reason: string }[] } {
  const d = deviceInfo[deviceId];
  if (!d) return { score: 0, grade: 'N/A', color: 'text-slate-400', items: [] };

  const items: { label: string; score: number; maxScore: number; reason: string }[] = [];

  const fwScore = d.firmware === 'v7.4.3' ? 15 : d.firmware.startsWith('v7.4') ? 10 : d.firmware.startsWith('v7.') ? 5 : 0;
  items.push({ label: 'Firmware', score: fwScore, maxScore: 15, reason: d.firmware === 'v7.4.3' ? 'Latest version' : `Outdated (${d.firmware})` });

  const cpuScore = d.status === 'offline' ? 5 : d.cpu <= 60 ? 15 : d.cpu <= 80 ? 10 : 3;
  items.push({ label: 'CPU Usage', score: cpuScore, maxScore: 15, reason: d.status === 'offline' ? 'Device offline' : `${d.cpu}%` });

  const memScore = d.status === 'offline' ? 5 : d.mem <= 70 ? 15 : d.mem <= 85 ? 8 : 2;
  items.push({ label: 'Memory', score: memScore, maxScore: 15, reason: d.status === 'offline' ? 'Device offline' : `${d.mem}%` });

  const diskScore = d.disk <= 50 ? 10 : d.disk <= 75 ? 6 : 2;
  items.push({ label: 'Disk', score: diskScore, maxScore: 10, reason: `${d.disk}% used` });

  const tunnelScore = d.tunnelsTotal === 0 ? 10 : Math.round((d.tunnelsUp / d.tunnelsTotal) * 10);
  items.push({ label: 'VPN Tunnels', score: tunnelScore, maxScore: 10, reason: d.tunnelsTotal === 0 ? 'No tunnels configured' : `${d.tunnelsUp}/${d.tunnelsTotal} up` });

  const checksForDevice = complianceChecks.filter((c) => c.results[deviceId]);
  const passedChecks = checksForDevice.filter((c) => c.results[deviceId]?.compliant).length;
  const complianceScore = checksForDevice.length > 0 ? Math.round((passedChecks / checksForDevice.length) * 20) : 10;
  items.push({ label: 'Compliance', score: complianceScore, maxScore: 20, reason: `${passedChecks}/${checksForDevice.length} checks passed` });

  const licDays = Math.floor((new Date(d.licenseExpiry).getTime() - Date.now()) / 86400000);
  const licScore = licDays > 180 ? 10 : licDays > 90 ? 7 : licDays > 30 ? 3 : 0;
  items.push({ label: 'License', score: licScore, maxScore: 10, reason: licDays > 0 ? `${licDays} days remaining` : 'Expired' });

  const uptimeScore = d.status === 'offline' ? 0 : 5;
  items.push({ label: 'Availability', score: uptimeScore, maxScore: 5, reason: d.status === 'offline' ? 'Device is offline' : 'Online' });

  const total = items.reduce((s, i) => s + i.score, 0);
  const grade = total >= 90 ? 'A+' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 40 ? 'D' : 'F';
  const color = total >= 80 ? 'text-emerald-400' : total >= 60 ? 'text-amber-400' : 'text-red-400';

  return { score: total, grade, color, items };
}

function getRecommendations(deviceId: string): { severity: Severity; text: string; action: string }[] {
  const d = deviceInfo[deviceId];
  if (!d) return [];
  const rec: { severity: Severity; text: string; action: string }[] = [];

  if (d.status === 'offline') rec.push({ severity: 'critical', text: 'Device is offline', action: 'Check physical connectivity, power supply, and management IP reachability' });
  if (d.firmware !== 'v7.4.3') rec.push({ severity: d.firmware.startsWith('v7.4') ? 'medium' : 'high', text: `Firmware outdated (${d.firmware})`, action: 'Upgrade to v7.4.3 during maintenance window' });
  if (d.cpu > 80) rec.push({ severity: 'high', text: `High CPU usage (${d.cpu}%)`, action: 'Review session table, check for DDoS, disable unnecessary UTM features' });
  if (d.mem > 85) rec.push({ severity: 'high', text: `High memory usage (${d.mem}%)`, action: 'Check conserve mode status, review session limits, consider hardware upgrade' });
  if (d.disk > 70) rec.push({ severity: 'medium', text: `Disk usage high (${d.disk}%)`, action: 'Purge old logs, configure log forwarding to external syslog' });
  if (!d.ntpSync) rec.push({ severity: 'medium', text: 'NTP not synchronized', action: 'Configure NTP: set system ntp / set ntpsync enable / set server pool.ntp.org' });
  if (!d.dns2) rec.push({ severity: 'low', text: 'Single DNS server', action: 'Add secondary DNS for redundancy' });
  if (!d.logging.includes('syslog')) rec.push({ severity: 'medium', text: 'No syslog forwarding', action: 'Configure: config log syslogd setting / set status enable' });
  if (d.adminTimeout === 0) rec.push({ severity: 'medium', text: 'Admin timeout disabled', action: 'Set admin timeout: config system global / set admintimeout 480' });
  if (d.adminPort === 80) rec.push({ severity: 'critical', text: 'Admin using HTTP (insecure)', action: 'Switch to HTTPS: config system global / set admin-sport 443' });
  const licDays = Math.floor((new Date(d.licenseExpiry).getTime() - Date.now()) / 86400000);
  if (licDays <= 30) rec.push({ severity: 'critical', text: `License expires in ${licDays} days`, action: 'Contact Fortinet or reseller to renew license immediately' });
  else if (licDays <= 90) rec.push({ severity: 'high', text: `License expires in ${licDays} days`, action: 'Plan license renewal before expiration' });
  const backupDays = Math.floor((Date.now() - new Date(d.lastBackup).getTime()) / 86400000);
  if (backupDays > 7) rec.push({ severity: backupDays > 30 ? 'high' : 'medium', text: `Last backup ${backupDays} days ago`, action: 'Run immediate backup and configure automated daily backups' });
  if (d.adminPasswordAge > 90) rec.push({ severity: d.adminPasswordAge > 150 ? 'high' : 'medium', text: `Admin password ${d.adminPasswordAge} days old`, action: 'Change admin password according to security policy' });
  if (d.tunnelsUp < d.tunnelsTotal) rec.push({ severity: 'high', text: `${d.tunnelsTotal - d.tunnelsUp} VPN tunnel(s) down`, action: 'Check IKE phase1/phase2 settings, verify peer reachability' });

  return rec.sort((a, b) => {
    const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, ok: 4 };
    return order[a.severity] - order[b.severity];
  });
}

const severityConfig: Record<Severity, { color: string; bg: string; icon: React.ReactNode }> = {
  critical: { color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20', icon: <XCircle className="w-4 h-4 text-red-400" /> },
  high: { color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20', icon: <AlertTriangle className="w-4 h-4 text-orange-400" /> },
  medium: { color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20', icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
  low: { color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/20', icon: <Info className="w-4 h-4 text-blue-400" /> },
  ok: { color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20', icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
};

export default function Compliance() {
  const { scope } = useScope();
  const [activeTab, setActiveTab] = useState<'compliance' | 'health'>('compliance');
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  const visibleDevices = useMemo(() => {
    if (scope.deviceId === 'all') return scopeDevices;
    return scopeDevices.filter((d) => d.id === scope.deviceId);
  }, [scope.deviceId]);

  const complianceSummary = useMemo(() => {
    let total = 0;
    let passed = 0;
    for (const check of complianceChecks) {
      for (const dev of visibleDevices) {
        const r = check.results[dev.id];
        if (r) {
          total++;
          if (r.compliant) passed++;
        }
      }
    }
    return { total, passed, failed: total - passed, rate: total > 0 ? Math.round((passed / total) * 100) : 0 };
  }, [visibleDevices]);

  const deviceHealthScores = useMemo(() =>
    visibleDevices.map((d) => ({ ...d, health: getHealthScore(d.id) })),
    [visibleDevices]
  );

  const avgHealth = useMemo(() => {
    if (deviceHealthScores.length === 0) return 0;
    return Math.round(deviceHealthScores.reduce((s, d) => s + d.health.score, 0) / deviceHealthScores.length);
  }, [deviceHealthScores]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <button onClick={() => setActiveTab('compliance')} className={clsx('btn-secondary text-sm', activeTab === 'compliance' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}>
          <ShieldCheck className="w-4 h-4" /> Compliance Checker
        </button>
        <button onClick={() => setActiveTab('health')} className={clsx('btn-secondary text-sm', activeTab === 'health' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}>
          <Activity className="w-4 h-4" /> Health Score
        </button>
      </div>

      {activeTab === 'compliance' && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <FileSearch className="w-4 h-4 text-primary-400" />
                <span className="text-xs text-slate-400">Total Checks</span>
              </div>
              <p className="text-2xl font-bold text-slate-100">{complianceSummary.total}</p>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-slate-400">Passed</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400">{complianceSummary.passed}</p>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-xs text-slate-400">Failed</span>
              </div>
              <p className="text-2xl font-bold text-red-400">{complianceSummary.failed}</p>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-primary-400" />
                <span className="text-xs text-slate-400">Compliance Rate</span>
              </div>
              <p className={clsx('text-2xl font-bold', complianceSummary.rate >= 80 ? 'text-emerald-400' : complianceSummary.rate >= 60 ? 'text-amber-400' : 'text-red-400')}>
                {complianceSummary.rate}%
              </p>
            </div>
          </div>

          {/* Compliance Matrix */}
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700 text-left">
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider sticky left-0 bg-dark-800/95 z-10">Check</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Expected</th>
                    {visibleDevices.map((d) => (
                      <th key={d.id} className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center whitespace-nowrap">{d.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {complianceChecks.map((check) => {
                    const isExpanded = expandedCheck === check.id;
                    return (
                      <tr
                        key={check.id}
                        className="border-b border-dark-700/50 hover:bg-dark-800/30 cursor-pointer transition-colors"
                        onClick={() => setExpandedCheck(isExpanded ? null : check.id)}
                      >
                        <td className="px-3 py-2.5 sticky left-0 bg-dark-800/95 z-10">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                            <div>
                              <p className="text-xs text-slate-200 font-medium">{check.label}</p>
                              {isExpanded && <p className="text-[10px] text-slate-500 mt-0.5">{check.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-400 font-mono">{check.expectedValue}</td>
                        {visibleDevices.map((d) => {
                          const r = check.results[d.id];
                          return (
                            <td key={d.id} className="px-3 py-2.5 text-center">
                              {r ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  {r.compliant
                                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                    : <XCircle className="w-4 h-4 text-red-400" />}
                                  {isExpanded && (
                                    <span className={clsx('text-[10px]', r.compliant ? 'text-slate-500' : 'text-red-300')}>{r.value}</span>
                                  )}
                                </div>
                              ) : <span className="text-slate-600">—</span>}
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

          {/* Per-device compliance bar */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Per-Device Compliance</h3>
            <div className="space-y-2">
              {visibleDevices.map((d) => {
                const checks = complianceChecks.filter((c) => c.results[d.id]);
                const passed = checks.filter((c) => c.results[d.id]?.compliant).length;
                const pct = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 0;
                return (
                  <div key={d.id} className="flex items-center gap-3">
                    <span className="text-xs text-slate-300 w-36 truncate">{d.name}</span>
                    <div className="flex-1 h-3 bg-dark-900 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all', pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={clsx('text-xs font-bold w-12 text-right', pct >= 80 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400')}>
                      {pct}%
                    </span>
                    <span className="text-[10px] text-slate-500 w-16">{passed}/{checks.length}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'health' && (
        <div className="space-y-4">
          {/* Average Health */}
          <div className="glass-card p-5 flex items-center gap-6">
            <div className="relative w-24 h-24">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#1e293b" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="16" fill="none"
                  stroke={avgHealth >= 80 ? '#34d399' : avgHealth >= 60 ? '#fbbf24' : '#f87171'}
                  strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${avgHealth} ${100 - avgHealth}`}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={clsx('text-xl font-bold', avgHealth >= 80 ? 'text-emerald-400' : avgHealth >= 60 ? 'text-amber-400' : 'text-red-400')}>
                  {avgHealth}
                </span>
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-100">Average Network Health</h3>
              <p className="text-sm text-slate-400 mt-1">
                Across {visibleDevices.length} device(s) — score out of 100
              </p>
              <div className="flex items-center gap-4 mt-2">
                {deviceHealthScores.map((d) => (
                  <div key={d.id} className="flex items-center gap-1.5">
                    <span className={clsx('text-sm font-bold', d.health.color)}>{d.health.grade}</span>
                    <span className="text-[10px] text-slate-500">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Device Health Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {deviceHealthScores.map((d) => {
              const isSelected = selectedDevice === d.id;
              const recs = getRecommendations(d.id);
              return (
                <div
                  key={d.id}
                  className={clsx('glass-card overflow-hidden cursor-pointer transition-all', isSelected && 'ring-1 ring-primary-500/40')}
                  onClick={() => setSelectedDevice(isSelected ? null : d.id)}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-semibold text-slate-100">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-2xl font-bold', d.health.color)}>{d.health.score}</span>
                        <span className={clsx('text-sm font-bold px-2 py-0.5 rounded', d.health.color, d.health.score >= 80 ? 'bg-emerald-400/10' : d.health.score >= 60 ? 'bg-amber-400/10' : 'bg-red-400/10')}>
                          {d.health.grade}
                        </span>
                      </div>
                    </div>

                    {/* Score breakdown bar */}
                    <div className="flex h-2 rounded-full overflow-hidden bg-dark-900 mb-3">
                      {d.health.items.map((item, idx) => (
                        <div
                          key={idx}
                          className={clsx(item.score >= item.maxScore * 0.8 ? 'bg-emerald-400' : item.score >= item.maxScore * 0.5 ? 'bg-amber-400' : 'bg-red-400')}
                          style={{ width: `${(item.maxScore / 100) * 100}%`, opacity: 0.5 + (item.score / item.maxScore) * 0.5 }}
                          title={`${item.label}: ${item.score}/${item.maxScore}`}
                        />
                      ))}
                    </div>

                    {recs.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        {recs.length} recommendation(s)
                      </div>
                    )}
                  </div>

                  {isSelected && (
                    <div className="border-t border-dark-700">
                      {/* Score details */}
                      <div className="p-4 space-y-2">
                        <p className="text-xs font-semibold text-slate-300 mb-2">Score Breakdown</p>
                        {d.health.items.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 w-24">{item.label}</span>
                            <div className="flex-1 h-1.5 bg-dark-900 rounded-full overflow-hidden">
                              <div
                                className={clsx('h-full rounded-full', item.score >= item.maxScore * 0.8 ? 'bg-emerald-400' : item.score >= item.maxScore * 0.5 ? 'bg-amber-400' : 'bg-red-400')}
                                style={{ width: `${(item.score / item.maxScore) * 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 w-12 text-right">{item.score}/{item.maxScore}</span>
                          </div>
                        ))}
                      </div>

                      {/* Recommendations */}
                      {recs.length > 0 && (
                        <div className="border-t border-dark-700 p-4 space-y-2">
                          <p className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-amber-400" /> Recommendations
                          </p>
                          {recs.map((rec, idx) => (
                            <div key={idx} className={clsx('rounded-lg border p-3', severityConfig[rec.severity].bg)}>
                              <div className="flex items-start gap-2">
                                {severityConfig[rec.severity].icon}
                                <div>
                                  <p className={clsx('text-xs font-medium', severityConfig[rec.severity].color)}>{rec.text}</p>
                                  <p className="text-[10px] text-slate-400 mt-1 font-mono">{rec.action}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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
