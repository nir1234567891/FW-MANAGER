import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Terminal, Play, Copy, Trash2, Clock, Server,
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Loader2, BookOpen, Plus, X, RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { deviceService, cliService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';
import { useToast } from '@/components/Toast';

interface CommandTemplate {
  id: string;
  label: string;
  command: string;
  category: string;
  description: string;
}

interface CommandResult {
  deviceId: string;
  deviceName: string;
  vdom: string;
  status: 'pending' | 'running' | 'success' | 'error';
  output: string;
  duration: number;
  timestamp: string;
}

interface ExecutionSession {
  id: string;
  command: string;
  targets: string[];
  results: CommandResult[];
  timestamp: string;
}

interface DeviceInfo {
  id: string;
  name: string;
  vdoms: string[];
  status: string;
}

// target key = "deviceId::vdom"
type TargetKey = string;

const templates: CommandTemplate[] = [
  { id: 't1',  label: 'System Status',          command: 'get system status',                 category: 'System',   description: 'Firmware, hostname, serial, uptime' },
  { id: 't2',  label: 'Interface List',          command: 'get system interface physical',     category: 'Network',  description: 'All interfaces and their status' },
  { id: 't3',  label: 'Routing Table',           command: 'get router info routing-table all', category: 'Routing',  description: 'Full routing table (FIB)' },
  { id: 't4',  label: 'Active Sessions',         command: 'get system session status',         category: 'System',   description: 'Session table information' },
  { id: 't5',  label: 'HA Status',               command: 'get system ha status',              category: 'HA',       description: 'High-Availability cluster info' },
  { id: 't6',  label: 'VPN Tunnels',             command: 'diag vpn ike gateway list',         category: 'VPN',      description: 'IKE gateways and tunnel states' },
  { id: 't7',  label: 'CPU & Memory',            command: 'get system performance status',     category: 'System',   description: 'CPU, memory, session counters' },
  { id: 't8',  label: 'DNS Settings',            command: 'get system dns',                    category: 'Network',  description: 'DNS server configuration' },
  { id: 't9',  label: 'NTP Status',              command: 'diag sys ntp status',               category: 'System',   description: 'NTP synchronization status' },
  { id: 't10', label: 'Log Disk Usage',          command: 'diag sys logdisk usage',            category: 'System',   description: 'Log disk space (returns API note)' },
  { id: 't11', label: 'BGP Summary',             command: 'get router info bgp summary',       category: 'Routing',  description: 'BGP neighbor summary' },
  { id: 't12', label: 'OSPF Neighbors',          command: 'get router info ospf neighbor',     category: 'Routing',  description: 'OSPF adjacency list' },
  { id: 't13', label: 'Policy Hit Count',        command: 'diag firewall iprope show 100004',  category: 'Firewall', description: 'Policy hit counters' },
  { id: 't14', label: 'License Status',          command: 'get system fortiguard-service status', category: 'System', description: 'FortiGuard subscription info' },
  { id: 't15', label: 'DHCP Leases',             command: 'execute dhcp lease-list',           category: 'Network',  description: 'Active DHCP leases' },
  { id: 't16', label: 'SSL VPN Users',           command: 'get vpn ssl monitor',               category: 'VPN',      description: 'Connected SSL VPN users' },
  { id: 't17', label: 'Crash Log',               command: 'diag debug crashlog read',          category: 'Debug',    description: 'Crash log (returns API note)' },
];

const categories = Array.from(new Set(templates.map((t) => t.category)));

const SESSIONS_KEY = 'fortimanager-pro-cli-sessions';
function loadSessions(): ExecutionSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function BulkCLI() {
  const { addToast } = useToast();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);

  // Selected targets: Set of "deviceId::vdom" keys
  const [selectedTargets, setSelectedTargets] = useState<Set<TargetKey>>(new Set());

  const [command, setCommand] = useState('');
  const [sessions, setSessions] = useState<ExecutionSession[]>(loadSessions);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [templateFilter, setTemplateFilter] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [customCommands, setCustomCommands] = useState<string[]>([]);
  const [newCustom, setNewCustom] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);

  // Load real devices from backend
  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const res = await deviceService.getAll();
      const list = res.data as any[];
      if (Array.isArray(list)) {
        const mapped: DeviceInfo[] = list.map((d: any) => {
          const dev = mapBackendDevice(d);
          return {
            id: dev.id,
            name: dev.name,
            status: d.status || 'unknown',
            vdoms: Array.isArray(d.vdom_list) && d.vdom_list.length > 0
              ? d.vdom_list as string[]
              : ['root'],
          };
        });
        setDevices(mapped);
        // Auto-select all online devices at root VDOM
        const autoSelect = new Set<TargetKey>();
        for (const dev of mapped) {
          if (dev.status === 'online') {
            autoSelect.add(`${dev.id}::${dev.vdoms[0]}`);
          }
        }
        setSelectedTargets(autoSelect);
      }
    } catch {
      addToast('error', 'Failed to load devices');
    } finally {
      setLoadingDevices(false);
    }
  }, [addToast]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  useEffect(() => {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50))); } catch {}
  }, [sessions]);

  const toggleTarget = (key: TargetKey) => {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    const all = new Set<TargetKey>();
    devices.forEach((d) => d.vdoms.forEach((v) => all.add(`${d.id}::${v}`)));
    setSelectedTargets(all);
  };

  const deselectAll = () => setSelectedTargets(new Set());

  const filteredTemplates = useMemo(() => {
    const q = templateFilter.toLowerCase();
    return templates.filter((t) =>
      t.label.toLowerCase().includes(q) ||
      t.command.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }, [templateFilter]);

  const groupedTemplates = useMemo(() => {
    const map = new Map<string, CommandTemplate[]>();
    for (const t of filteredTemplates) {
      const arr = map.get(t.category) || [];
      arr.push(t);
      map.set(t.category, arr);
    }
    return map;
  }, [filteredTemplates]);

  const executeCommand = async (cmd: string) => {
    if (!cmd.trim() || selectedTargets.size === 0) return;
    setIsRunning(true);

    const targets = Array.from(selectedTargets);
    const sessionId = `s${Date.now()}`;

    // Build result entries
    const initialResults: CommandResult[] = targets.map((key) => {
      const [dId, vdom] = key.split('::');
      const dev = devices.find((d) => d.id === dId);
      return {
        deviceId: dId,
        deviceName: dev?.name || dId,
        vdom,
        status: 'pending',
        output: '',
        duration: 0,
        timestamp: '',
      };
    });

    const session: ExecutionSession = {
      id: sessionId,
      command: cmd.trim(),
      targets,
      results: initialResults,
      timestamp: new Date().toISOString(),
    };

    setSessions((prev) => [session, ...prev]);
    setExpandedSession(sessionId);

    // Execute per-target sequentially to avoid overwhelming the device
    for (let i = 0; i < initialResults.length; i++) {
      const { deviceId, vdom } = initialResults[i];

      setSessions((prev) => prev.map((s) => {
        if (s.id !== sessionId) return s;
        const results = [...s.results];
        results[i] = { ...results[i], status: 'running' };
        return { ...s, results };
      }));

      const start = Date.now();
      try {
        const res = await cliService.execute(deviceId, cmd.trim(), vdom);
        const data = res.data as any;
        const duration = Date.now() - start;

        setSessions((prev) => prev.map((s) => {
          if (s.id !== sessionId) return s;
          const results = [...s.results];
          results[i] = {
            ...results[i],
            status: data.success ? 'success' : 'error',
            output: data.output || '(no output)',
            duration,
            timestamp: new Date().toISOString(),
          };
          return { ...s, results };
        }));
      } catch (err: any) {
        const duration = Date.now() - start;
        const errMsg = err?.response?.data?.detail || err?.message || 'Connection failed';
        setSessions((prev) => prev.map((s) => {
          if (s.id !== sessionId) return s;
          const results = [...s.results];
          results[i] = {
            ...results[i],
            status: 'error',
            output: `Error: ${errMsg}`,
            duration,
            timestamp: new Date().toISOString(),
          };
          return { ...s, results };
        }));
      }
    }

    setIsRunning(false);
  };

  const handleExecute = () => executeCommand(command);

  const handleBatchExecute = async () => {
    if (customCommands.length === 0) return;
    for (const cmd of customCommands) {
      await executeCommand(cmd);
    }
  };

  const copyOutput = (text: string) => {
    navigator.clipboard?.writeText(text);
    addToast('success', 'Copied to clipboard');
  };

  const clearHistory = () => {
    setSessions([]);
    localStorage.removeItem(SESSIONS_KEY);
  };

  const selectedCount = selectedTargets.size;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Command Input */}
        <div className="xl:col-span-2 space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Terminal className="w-5 h-5 text-primary-400" />
              <h3 className="text-sm font-semibold text-slate-200">Bulk CLI Commander</h3>
              <span className="text-[10px] text-slate-500 bg-dark-900 px-2 py-0.5 rounded-full ml-auto">
                {selectedCount} target{selectedCount !== 1 ? 's' : ''} selected
              </span>
              <button onClick={loadDevices} className="btn-secondary text-xs py-1">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            <div className="flex gap-2 mb-3">
              <div className="flex-1 relative">
                <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleExecute(); }
                  }}
                  placeholder="Enter FortiGate CLI command (e.g. get system status)..."
                  className="input-dark pl-10 font-mono text-sm w-full"
                  disabled={isRunning}
                />
              </div>
              <button
                onClick={handleExecute}
                disabled={isRunning || !command.trim() || selectedCount === 0}
                className="btn-primary text-sm whitespace-nowrap"
              >
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Execute
              </button>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className={clsx('btn-secondary text-sm', showTemplates && 'bg-primary-500/20 text-primary-400 border-primary-500/30')}
                title="Command Library"
              >
                <BookOpen className="w-4 h-4" />
              </button>
            </div>

            {/* Target Selection */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Targets:</span>
                <button onClick={selectAll} className="text-[10px] text-primary-400 hover:text-primary-300 underline">All</button>
                <button onClick={deselectAll} className="text-[10px] text-slate-400 hover:text-slate-300 underline">None</button>
              </div>
              {loadingDevices ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading devices...
                </div>
              ) : (
                <div className="space-y-2">
                  {devices.map((dev) => (
                    <div key={dev.id} className="flex flex-wrap items-center gap-1.5">
                      <span className={clsx(
                        'text-xs font-medium w-24 truncate',
                        dev.status === 'online' ? 'text-emerald-400' : 'text-slate-500'
                      )}>
                        {dev.name}
                      </span>
                      {dev.vdoms.map((vdom) => {
                        const key = `${dev.id}::${vdom}`;
                        const isSelected = selectedTargets.has(key);
                        const isOffline = dev.status !== 'online';
                        return (
                          <button
                            key={key}
                            onClick={() => !isOffline && toggleTarget(key)}
                            disabled={isOffline}
                            title={isOffline ? `${dev.name} is offline` : `${dev.name} / ${vdom}`}
                            className={clsx(
                              'px-2 py-0.5 text-[11px] rounded border transition-colors',
                              isOffline
                                ? 'bg-dark-900/30 text-slate-600 border-dark-700 cursor-not-allowed opacity-50'
                                : isSelected
                                  ? 'bg-primary-500/20 text-primary-300 border-primary-500/30'
                                  : 'bg-dark-900 text-slate-400 border-dark-600 hover:border-primary-500/30'
                            )}
                          >
                            {vdom}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Batch Commands */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-semibold text-slate-300">Command Queue (batch execution)</h4>
              {customCommands.length > 0 && (
                <button
                  onClick={handleBatchExecute}
                  disabled={isRunning}
                  className="btn-primary text-xs ml-auto py-1"
                >
                  <Play className="w-3 h-3" /> Run All ({customCommands.length})
                </button>
              )}
            </div>
            <div className="flex gap-2 mb-2">
              <input
                value={newCustom}
                onChange={(e) => setNewCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCustom.trim()) {
                    setCustomCommands((p) => [...p, newCustom.trim()]);
                    setNewCustom('');
                  }
                }}
                placeholder="Add command to queue..."
                className="input-dark font-mono text-xs flex-1"
              />
              <button
                onClick={() => {
                  if (newCustom.trim()) {
                    setCustomCommands((p) => [...p, newCustom.trim()]);
                    setNewCustom('');
                  }
                }}
                className="btn-secondary text-xs"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {customCommands.length > 0 && (
              <div className="space-y-1">
                {customCommands.map((cmd, i) => (
                  <div key={i} className="flex items-center gap-2 bg-dark-900/50 rounded px-3 py-1.5">
                    <span className="text-xs text-slate-500 w-5">{i + 1}.</span>
                    <span className="text-xs text-slate-300 font-mono flex-1">{cmd}</span>
                    <button onClick={() => setCustomCommands((p) => p.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Execution Results */}
          <div ref={outputRef} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary-400" /> Execution History
              </h3>
              {sessions.length > 0 && (
                <button onClick={clearHistory} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {sessions.length === 0 && (
              <div className="glass-card p-12 text-center">
                <Terminal className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No commands executed yet</p>
                <p className="text-xs text-slate-500 mt-1">Select targets and run a command to see live results from FortiGate</p>
              </div>
            )}

            {sessions.map((session) => {
              const isExpanded = expandedSession === session.id;
              const successCount = session.results.filter((r) => r.status === 'success').length;
              const errorCount = session.results.filter((r) => r.status === 'error').length;
              const pendingCount = session.results.filter((r) => r.status === 'pending' || r.status === 'running').length;

              return (
                <div key={session.id} className="glass-card overflow-hidden">
                  <button
                    onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-dark-800/50 transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    <code className="text-sm text-primary-300 font-mono flex-1 text-left truncate">{session.command}</code>
                    <div className="flex items-center gap-2">
                      {pendingCount > 0 && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
                      {successCount > 0 && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20">
                          {successCount} OK
                        </span>
                      )}
                      {errorCount > 0 && (
                        <span className="text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full border border-red-400/20">
                          {errorCount} ERR
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500">
                        {new Date(session.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-dark-700 divide-y divide-dark-700/50">
                      {session.results.map((result) => {
                        const devKey = `${session.id}-${result.deviceId}-${result.vdom}`;
                        const isDevExpanded = expandedDevice === devKey;
                        return (
                          <div key={devKey}>
                            <button
                              onClick={() => setExpandedDevice(isDevExpanded ? null : devKey)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-dark-800/30 transition-colors"
                            >
                              {isDevExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                              <Server className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-xs text-slate-200 font-medium">{result.deviceName}</span>
                              <span className="text-[10px] text-primary-400 bg-primary-400/10 px-1.5 py-0.5 rounded">{result.vdom}</span>
                              <div className="ml-auto flex items-center gap-2">
                                {result.status === 'running' && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
                                {result.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                                {result.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                                {result.status === 'pending' && <span className="w-2 h-2 bg-slate-500 rounded-full" />}
                                {result.duration > 0 && (
                                  <span className="text-[10px] text-slate-500">{result.duration}ms</span>
                                )}
                              </div>
                            </button>
                            {isDevExpanded && result.output && (
                              <div className="relative bg-dark-950 mx-4 mb-3 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => copyOutput(result.output)}
                                  className="absolute top-2 right-2 p-1.5 bg-dark-800 rounded hover:bg-dark-700 transition-colors z-10"
                                  title="Copy output"
                                >
                                  <Copy className="w-3 h-3 text-slate-400" />
                                </button>
                                <pre className="p-4 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">
                                  {result.output}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Templates Sidebar */}
        <div className={clsx('space-y-3', !showTemplates && 'hidden xl:block')}>
          <div className="glass-card p-4 sticky top-20">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-primary-400" />
              <h3 className="text-sm font-semibold text-slate-200">Command Library</h3>
              <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded ml-auto border border-emerald-400/20">
                Live
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mb-2">All commands use real FortiGate REST API</p>
            <input
              value={templateFilter}
              onChange={(e) => setTemplateFilter(e.target.value)}
              placeholder="Search commands..."
              className="input-dark text-xs mb-3 w-full"
            />
            <div className="space-y-3 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
              {categories.map((cat) => {
                const items = groupedTemplates.get(cat);
                if (!items?.length) return null;
                return (
                  <div key={cat}>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">{cat}</p>
                    <div className="space-y-1">
                      {items.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setCommand(t.command);
                            setShowTemplates(false);
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg bg-dark-900/50 hover:bg-dark-800 border border-transparent hover:border-primary-500/20 transition-colors group"
                        >
                          <p className="text-xs text-slate-200 font-medium group-hover:text-primary-300 transition-colors">{t.label}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">{t.command}</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">{t.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
