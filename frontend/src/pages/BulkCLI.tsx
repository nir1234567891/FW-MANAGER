import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Terminal, Play, Copy, Trash2, Clock, Server,
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Loader2, BookOpen, Plus, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useScope, scopeDevices } from '@/hooks/useScope';

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

const templates: CommandTemplate[] = [
  { id: 't1', label: 'System Status', command: 'get system status', category: 'System', description: 'Show firmware, hostname, serial, uptime' },
  { id: 't2', label: 'Interface List', command: 'get system interface physical', category: 'Network', description: 'List all physical interfaces and status' },
  { id: 't3', label: 'Routing Table', command: 'get router info routing-table all', category: 'Routing', description: 'Full routing table' },
  { id: 't4', label: 'Active Sessions', command: 'get system session status', category: 'System', description: 'Current session count and table info' },
  { id: 't5', label: 'HA Status', command: 'get system ha status', category: 'HA', description: 'High-Availability cluster information' },
  { id: 't6', label: 'VPN Tunnels', command: 'diag vpn ike gateway list', category: 'VPN', description: 'List IKE gateways and tunnel states' },
  { id: 't7', label: 'CPU & Memory', command: 'get system performance status', category: 'System', description: 'CPU, memory, session counters' },
  { id: 't8', label: 'ARP Table', command: 'get system arp', category: 'Network', description: 'Show ARP cache entries' },
  { id: 't9', label: 'DNS Settings', command: 'get system dns', category: 'Network', description: 'DNS server configuration' },
  { id: 't10', label: 'NTP Status', command: 'diag sys ntp status', category: 'System', description: 'NTP synchronization status' },
  { id: 't11', label: 'Log Disk Usage', command: 'diag sys logdisk usage', category: 'System', description: 'Log disk space usage' },
  { id: 't12', label: 'BGP Summary', command: 'get router info bgp summary', category: 'Routing', description: 'BGP neighbor summary' },
  { id: 't13', label: 'OSPF Neighbors', command: 'get router info ospf neighbor', category: 'Routing', description: 'OSPF adjacency list' },
  { id: 't14', label: 'Policy Hit Count', command: 'diag firewall iprope show 100004', category: 'Firewall', description: 'Policy lookup counters' },
  { id: 't15', label: 'License Status', command: 'get system fortiguard-service status', category: 'System', description: 'FortiGuard subscription and license info' },
  { id: 't16', label: 'DHCP Leases', command: 'execute dhcp lease-list', category: 'Network', description: 'Active DHCP leases' },
  { id: 't17', label: 'SSL VPN Users', command: 'get vpn ssl monitor', category: 'VPN', description: 'Connected SSL VPN users' },
  { id: 't18', label: 'Crash Log', command: 'diag debug crashlog read', category: 'Debug', description: 'Recent crash/debug log entries' },
];

const categories = Array.from(new Set(templates.map((t) => t.category)));

function generateMockOutput(command: string, deviceName: string): string {
  const outputs: Record<string, (name: string) => string> = {
    'get system status': (n) =>
      `Version: FortiGate-${n.includes('HQ') ? '600E' : n.includes('NYC') || n.includes('LON') ? '200F' : '100F'} v7.4.${Math.floor(Math.random() * 3) + 1}\nSerial-Number: FG${Math.random().toString(36).substring(2, 14).toUpperCase()}\nHostname: ${n}\nOperation Mode: NAT\nCurrent HA mode: ${n.includes('HQ') ? 'a-p' : 'standalone'}\nSystem time: ${new Date().toISOString()}\nUptime: ${Math.floor(Math.random() * 100)} days, ${Math.floor(Math.random() * 24)} hours`,
    'get system performance status': (n) =>
      `CPU states: ${15 + Math.floor(Math.random() * 60)}% user ${2 + Math.floor(Math.random() * 10)}% system 0% nice ${20 + Math.floor(Math.random() * 50)}% idle\nMemory: ${40 + Math.floor(Math.random() * 45)}% used\nAverage network usage: ${Math.floor(Math.random() * 500)} kbps\nSessions: ${1000 + Math.floor(Math.random() * 15000)}\nSession setup rate: ${Math.floor(Math.random() * 200)}/s\nVirus caught: ${Math.floor(Math.random() * 50)}\nIPS attacks blocked: ${Math.floor(Math.random() * 200)}\nUptime: ${Math.floor(Math.random() * 100)} days`,
    'get system ha status': (n) =>
      n.includes('HQ')
        ? `HA Mode: Active-Passive\nModel: FortiGate-600E\nMode: ${n.endsWith('1') ? 'Primary' : 'Secondary'}\nConfiguration Status: ${n.endsWith('1') ? 'master' : 'slave'}\nHA Uptime: ${Math.floor(Math.random() * 50)} days\nState Sync: Connected\nSession Pickup: enable\nSession Sync: ${12000 + Math.floor(Math.random() * 5000)} sessions synced`
        : 'HA is not configured on this device',
    'diag vpn ike gateway list': () => {
      const tunnels = ['HQ-to-NYC', 'HQ-to-LON', 'HQ-to-TKY', 'HQ-to-SYD'];
      return tunnels.map((t) =>
        `vd: root\nname: ${t}\ncreated: ${Math.floor(Math.random() * 1000000)}s ago\nIKE SA: created ${Math.floor(Math.random() * 100000)}/${Math.floor(Math.random() * 100000)} established ${Math.random() > 0.2 ? 1 : 0}/${Math.random() > 0.2 ? 1 : 0}\nIPsec SA: created ${Math.floor(Math.random() * 100000)}/${Math.floor(Math.random() * 100000)} established ${Math.random() > 0.15 ? 2 : 0}/2`
      ).join('\n\n');
    },
  };
  const fn = outputs[command];
  if (fn) return fn(deviceName);
  return `${n(deviceName)} # ${command}\n${Array.from({ length: 5 + Math.floor(Math.random() * 15) }, (_, i) =>
    `line ${i + 1}: ${command.split(' ').pop()}_data_${Math.random().toString(36).substring(2, 8)} = ${Math.floor(Math.random() * 1000)}`
  ).join('\n')}`;
}

function n(name: string) { return name; }

const SESSIONS_KEY = 'fortimanager-pro-cli-sessions';
function loadSessions(): ExecutionSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function BulkCLI() {
  const { scope } = useScope();
  const [command, setCommand] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(() => {
    if (scope.deviceId !== 'all') return [scope.deviceId];
    return scopeDevices.map((d) => d.id);
  });
  const [sessions, setSessions] = useState<ExecutionSession[]>(loadSessions);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [templateFilter, setTemplateFilter] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [customCommands, setCustomCommands] = useState<string[]>([]);
  const [newCustom, setNewCustom] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50))); } catch {}
  }, [sessions]);

  const toggleTarget = (id: string) => {
    setSelectedTargets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedTargets(scopeDevices.map((d) => d.id));
  const deselectAll = () => setSelectedTargets([]);

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
    if (!cmd.trim() || selectedTargets.length === 0) return;
    setIsRunning(true);

    const sessionId = `s${Date.now()}`;
    const initialResults: CommandResult[] = selectedTargets.map((id) => ({
      deviceId: id,
      deviceName: scopeDevices.find((d) => d.id === id)?.name || id,
      status: 'pending',
      output: '',
      duration: 0,
      timestamp: '',
    }));

    const session: ExecutionSession = {
      id: sessionId,
      command: cmd.trim(),
      targets: selectedTargets,
      results: initialResults,
      timestamp: new Date().toISOString(),
    };

    setSessions((prev) => [session, ...prev]);
    setExpandedSession(sessionId);

    for (let i = 0; i < initialResults.length; i++) {
      setSessions((prev) => prev.map((s) => {
        if (s.id !== sessionId) return s;
        const results = [...s.results];
        results[i] = { ...results[i], status: 'running' };
        return { ...s, results };
      }));

      const delay = 300 + Math.random() * 1200;
      await new Promise((r) => setTimeout(r, delay));

      const hasError = Math.random() < 0.05;
      const output = hasError
        ? `Command fail. Return code -61\nConnection timed out`
        : generateMockOutput(cmd.trim(), initialResults[i].deviceName);

      setSessions((prev) => prev.map((s) => {
        if (s.id !== sessionId) return s;
        const results = [...s.results];
        results[i] = {
          ...results[i],
          status: hasError ? 'error' : 'success',
          output,
          duration: Math.round(delay),
          timestamp: new Date().toISOString(),
        };
        return { ...s, results };
      }));
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
  };

  const clearHistory = () => {
    setSessions([]);
    localStorage.removeItem(SESSIONS_KEY);
  };

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
                {selectedTargets.length} device(s) selected
              </span>
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
                disabled={isRunning || !command.trim() || selectedTargets.length === 0}
                className="btn-primary text-sm whitespace-nowrap"
              >
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Execute
              </button>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className="btn-secondary text-sm"
                title="Command Library"
              >
                <BookOpen className="w-4 h-4" />
              </button>
            </div>

            {/* Target Selection */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Targets:</span>
              <button onClick={selectAll} className="text-[10px] text-primary-400 hover:text-primary-300 underline">All</button>
              <button onClick={deselectAll} className="text-[10px] text-slate-400 hover:text-slate-300 underline">None</button>
              {scopeDevices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => toggleTarget(d.id)}
                  className={clsx(
                    'px-2.5 py-1 text-xs rounded border transition-colors',
                    selectedTargets.includes(d.id)
                      ? 'bg-primary-500/20 text-primary-300 border-primary-500/30'
                      : 'bg-dark-900 text-slate-400 border-dark-600 hover:border-primary-500/30'
                  )}
                >
                  {d.name}
                </button>
              ))}
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
                <p className="text-xs text-slate-500 mt-1">Select targets and run a command to see results here</p>
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
                        const isDevExpanded = expandedDevice === `${session.id}-${result.deviceId}`;
                        return (
                          <div key={result.deviceId}>
                            <button
                              onClick={() => setExpandedDevice(isDevExpanded ? null : `${session.id}-${result.deviceId}`)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-dark-800/30 transition-colors"
                            >
                              {isDevExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                              <Server className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-xs text-slate-200 font-medium">{result.deviceName}</span>
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
                                <pre className="p-4 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
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
            </div>
            <input
              value={templateFilter}
              onChange={(e) => setTemplateFilter(e.target.value)}
              placeholder="Search commands..."
              className="input-dark text-xs mb-3 w-full"
            />
            <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
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
