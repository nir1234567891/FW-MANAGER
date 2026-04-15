import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, RefreshCw, Loader2, FileText, AlertTriangle, ChevronDown, ChevronRight,
  Filter, Download, Server,
} from 'lucide-react';
import { clsx } from 'clsx';
import { logsService, deviceService } from '@/services/api';
import { useToast } from '@/components/Toast';

interface LogEntry {
  date: string;
  time: string;
  level: string;
  vd: string;
  logid: string;
  type: string;
  subtype: string;
  logdesc: string;
  msg: string;
  action: string;
  srcip: string;
  dstip: string;
  srcport: string | number;
  dstport: string | number;
  proto: string | number;
  policyid: string | number;
  user: string;
  devname: string;
  extra: Record<string, unknown>;
}

interface DeviceInfo {
  id: string;
  name: string;
  status: string;
  vdom_list?: string[];
}

/**
 * Log type options. The FortiGate returns the SAME event log data for all
 * event/* API endpoints — subtype differentiation must be done client-side.
 * - apiValue: actual API endpoint path segment (e.g. event/system)
 * - subtype: client-side subtype filter (empty string = show all)
 */
const LOG_TYPES = [
  { key: 'event-all',     apiValue: 'event/system',    label: 'Event - All',       subtype: '' },
  { key: 'event-vpn',     apiValue: 'event/system',    label: 'Event - VPN',       subtype: 'vpn' },
  { key: 'event-user',    apiValue: 'event/system',    label: 'Event - User',      subtype: 'user' },
  { key: 'event-router',  apiValue: 'event/system',    label: 'Event - Router',    subtype: 'router' },
  { key: 'event-system',  apiValue: 'event/system',    label: 'Event - System',    subtype: 'system' },
  { key: 'event-general', apiValue: 'event/system',    label: 'Event - General',   subtype: 'general' },
  { key: 'traffic-fwd',   apiValue: 'traffic/forward', label: 'Traffic - Forward', subtype: '' },
  { key: 'traffic-local', apiValue: 'traffic/local',   label: 'Traffic - Local',   subtype: '' },
] as const;

const LOG_SOURCES = [
  { value: 'memory', label: 'Memory' },
  { value: 'disk',   label: 'Disk' },
];

const LEVEL_STYLES: Record<string, string> = {
  emergency:   'text-red-500 bg-red-500/10',
  alert:       'text-red-400 bg-red-400/10',
  critical:    'text-red-400 bg-red-400/10',
  error:       'text-orange-400 bg-orange-400/10',
  warning:     'text-amber-400 bg-amber-400/10',
  notice:      'text-blue-400 bg-blue-400/10',
  information: 'text-slate-300 bg-slate-700/30',
  debug:       'text-slate-500 bg-slate-800/30',
};

export default function Logs() {
  const { addToast } = useToast();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedVdom, setSelectedVdom] = useState('');
  const [logSource, setLogSource] = useState('memory');
  // logTypeKey selects a LOG_TYPES entry (controls both API endpoint + subtype filter)
  const [logTypeKey, setLogTypeKey] = useState<string>('event-all');
  const [rows] = useState(200);
  const [page, setPage] = useState(0);

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [totalLines, setTotalLines] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const [searchText, setSearchText] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');

  // Current log type config derived from key
  const currentLogType = LOG_TYPES.find((t) => t.key === logTypeKey) ?? LOG_TYPES[0];

  // Load devices
  useEffect(() => {
    deviceService.getAll()
      .then((res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = (res.data as any[]).map((d) => ({
          id: String(d.id),
          name: d.name,
          status: d.status,
          vdom_list: d.vdom_list || ['root'],
        }));
        setDevices(list);
        if (list.length > 0) {
          const online = list.find((d) => d.status === 'online') || list[0];
          setSelectedDevice(online.id);
          const vdoms = online.vdom_list || ['root'];
          setSelectedVdom(vdoms[0] || 'root');
        }
      })
      .catch(() => addToast('error', 'Failed to load devices'));
  }, [addToast]);

  const fetchLogs = useCallback(async (silent = false) => {
    if (!selectedDevice) return;
    if (!silent) { setLoading(true); setEntries([]); }
    setError('');
    try {
      const res = await logsService.getLogs(selectedDevice, {
        vdom: selectedVdom || undefined,
        log_source: logSource,
        log_type: currentLogType.apiValue,
        rows,
        start: page * rows,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;
      setEntries(data.entries || []);
      setTotalLines(data.total_lines || 0);
      if (data.error) setError(data.error);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch logs';
      setError(msg);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDevice, selectedVdom, logSource, currentLogType.apiValue, rows, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedDevice) fetchLogs();
  }, [selectedDevice, selectedVdom, logSource, currentLogType.apiValue, page, fetchLogs]);

  const currentDevice = devices.find((d) => d.id === selectedDevice);
  const vdoms = currentDevice?.vdom_list || ['root'];

  // Filtered entries — combines subtype (log type dropdown), level, and search filters
  const filtered = entries.filter((e) => {
    // Client-side subtype filter: FortiGate returns all events for any event/* endpoint
    if (currentLogType.subtype && e.subtype !== currentLogType.subtype) return false;
    // Level filter
    if (levelFilter !== 'all' && e.level !== levelFilter) return false;
    // Text search
    if (searchText) {
      const s = searchText.toLowerCase();
      return (
        e.msg?.toLowerCase().includes(s) ||
        e.logdesc?.toLowerCase().includes(s) ||
        e.srcip?.includes(s) ||
        e.dstip?.includes(s) ||
        e.action?.toLowerCase().includes(s) ||
        e.user?.toLowerCase().includes(s) ||
        e.vd?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  // Compute level options from subtype-filtered entries (before level/search filter)
  const subtypeFiltered = currentLogType.subtype
    ? entries.filter((e) => e.subtype === currentLogType.subtype)
    : entries;
  const levels = ['all', ...Array.from(new Set(subtypeFiltered.map((e) => e.level).filter(Boolean)))];

  const exportCSV = () => {
    const cols = ['date', 'time', 'level', 'vd', 'logid', 'type', 'subtype', 'logdesc', 'msg', 'action', 'srcip', 'dstip', 'user'];
    const lines = [cols.join(','), ...filtered.map((e) => cols.map((c) => `"${String((e as unknown as Record<string, unknown>)[c] ?? '').replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${currentDevice?.name}-${currentLogType.key}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Controls */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Device */}
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-slate-400" />
            <select
              value={selectedDevice}
              onChange={(e) => {
                setSelectedDevice(e.target.value);
                setPage(0);
                const dev = devices.find((d) => d.id === e.target.value);
                setSelectedVdom(dev?.vdom_list?.[0] || 'root');
              }}
              className="input-dark text-sm !py-1.5"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id} disabled={d.status === 'offline'}>
                  {d.name}{d.status === 'offline' ? ' (offline)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* VDOM */}
          {vdoms.length > 1 && (
            <select value={selectedVdom} onChange={(e) => { setSelectedVdom(e.target.value); setPage(0); }} className="input-dark text-sm !py-1.5">
              {vdoms.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}

          {/* Source */}
          <select value={logSource} onChange={(e) => { setLogSource(e.target.value); setPage(0); }} className="input-dark text-sm !py-1.5">
            {LOG_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* Type */}
          <select
            value={logTypeKey}
            onChange={(e) => {
              setLogTypeKey(e.target.value);
              setPage(0);
              setLevelFilter('all');  // reset level filter when log type changes
              setExpandedRow(null);
            }}
            className="input-dark text-sm !py-1.5"
          >
            {LOG_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>

          <button onClick={() => fetchLogs()} disabled={loading} className="btn-secondary text-sm">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Fetch
          </button>

          <div className="ml-auto flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search logs..."
                className="input-dark text-sm !py-1.5 pl-8 w-48"
              />
            </div>
            {/* Level filter */}
            <div className="flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="input-dark text-sm !py-1.5">
                {levels.map((l) => <option key={l} value={l}>{l === 'all' ? 'All levels' : l}</option>)}
              </select>
            </div>
            <button onClick={exportCSV} disabled={filtered.length === 0} className="btn-secondary text-sm" title="Export to CSV">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-500">
          <span>Total on device: <span className="text-slate-300 font-medium">{totalLines.toLocaleString()}</span></span>
          <span>Fetched: <span className="text-slate-300 font-medium">{entries.length}</span></span>
          <span>Shown: <span className="text-slate-300 font-medium">{filtered.length}</span></span>
          {currentDevice && (
            <span className="ml-auto flex items-center gap-1">
              <span className={clsx('w-1.5 h-1.5 rounded-full', currentDevice.status === 'online' ? 'bg-emerald-400' : 'bg-red-400')} />
              {currentDevice.name} · {selectedVdom || 'default VDOM'} · {logSource}/{currentLogType.apiValue} ({currentLogType.label})
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-3 bg-red-400/10 border border-red-400/20 rounded-lg text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error === 'Device is offline' ? 'Device is offline — cannot retrieve logs' : error}
        </div>
      )}

      {/* Log table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Loader2 className="w-7 h-7 animate-spin text-primary-400 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Fetching logs from FortiGate...</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <FileText className="w-10 h-10 mb-3 text-slate-600" />
            <p className="text-sm">{entries.length === 0 ? 'No log entries found' : 'No entries match the current filter'}</p>
            {entries.length === 0 && logSource === 'disk' && (
              <p className="text-xs mt-1 text-slate-600">Try switching to Memory logs — disk logging may not be available on this device</p>
            )}
            {entries.length === 0 && currentLogType.apiValue.startsWith('traffic') && (
              <p className="text-xs mt-1 text-slate-600">Traffic logs may be empty if no traffic policies are logging</p>
            )}
            {entries.length > 0 && currentLogType.subtype && filtered.length === 0 && (
              <p className="text-xs mt-1 text-slate-600">
                {entries.length} total events loaded — none with subtype "{currentLogType.subtype}"
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dark-700 bg-dark-800/50">
                  <th className="w-6 px-2 py-2.5" />
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold whitespace-nowrap">Date / Time</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Level</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">VDOM</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Type</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Description</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Message</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold whitespace-nowrap">Src IP</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold whitespace-nowrap">Dst IP</th>
                  <th className="px-3 py-2.5 text-left text-slate-400 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, idx) => {
                  const isExpanded = expandedRow === idx;
                  const levelStyle = LEVEL_STYLES[entry.level] || LEVEL_STYLES.information;
                  return (
                    <React.Fragment key={`${entry.date}-${entry.time}-${entry.logid}-${idx}`}>
                      <tr
                        className="border-b border-dark-700/40 hover:bg-dark-800/30 cursor-pointer transition-colors"
                        onClick={() => setExpandedRow(isExpanded ? null : idx)}
                      >
                        <td className="px-2 py-1.5 text-slate-600">
                          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-400 whitespace-nowrap">{entry.date} {entry.time}</td>
                        <td className="px-3 py-1.5">
                          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-semibold', levelStyle)}>
                            {entry.level}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-slate-300">{entry.vd || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-400">{entry.subtype || entry.type}</td>
                        <td className="px-3 py-1.5 text-slate-300 max-w-[200px] truncate" title={entry.logdesc}>{entry.logdesc || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-200 max-w-[240px] truncate" title={entry.msg}>{entry.msg || '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-400">{entry.srcip || '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-400">{entry.dstip || '—'}</td>
                        <td className="px-3 py-1.5">
                          {entry.action && (
                            <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                              entry.action === 'block' || entry.action === 'deny' ? 'bg-red-400/10 text-red-400' :
                              entry.action === 'accept' || entry.action === 'pass' ? 'bg-emerald-400/10 text-emerald-400' :
                              'bg-slate-700/30 text-slate-400'
                            )}>
                              {entry.action}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-dark-900/50 border-b border-dark-700/40">
                          <td colSpan={10} className="px-6 py-3">
                            <div className="grid grid-cols-3 gap-x-8 gap-y-1 text-[11px]">
                              {Object.entries({ ...entry, ...entry.extra })
                                .filter(([k]) => !['extra', 'devname'].includes(k))
                                .filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== '—')
                                .map(([k, v]) => (
                                  <div key={k} className="flex gap-2">
                                    <span className="text-slate-500 font-mono shrink-0">{k}:</span>
                                    <span className="text-slate-300 font-mono truncate" title={String(v)}>{String(v)}</span>
                                  </div>
                                ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalLines > rows && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary text-sm">
            ← Previous
          </button>
          <span className="text-xs text-slate-400">
            Page {page + 1} · entries {page * rows + 1}–{Math.min((page + 1) * rows, totalLines)} of {totalLines}
          </span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * rows >= totalLines} className="btn-secondary text-sm">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
