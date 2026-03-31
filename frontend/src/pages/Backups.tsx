import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Download, Trash2, Eye, GitCompareArrows, DatabaseBackup, Plus, Clock,
  Search, CheckSquare, Square, FileText, Server,
} from 'lucide-react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import Modal from '@/components/Modal';
import type { Backup } from '@/types';
import { format, formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';
import { useScope } from '@/hooks/useScope';
import { deviceService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';

const sampleConfig1 = `config system global
    set hostname "FG-HQ-DC1"
    set timezone "US/Eastern"
    set admin-sport 443
    set admin-ssh-port 22
    set admintimeout 30
end

config system interface
    edit "port1"
        set vdom "root"
        set ip 10.0.1.1 255.255.255.0
        set allowaccess ping https ssh snmp
        set type physical
        set alias "WAN1"
        set role wan
    next
    edit "port2"
        set vdom "root"
        set ip 172.16.0.1 255.255.255.0
        set allowaccess ping https ssh
        set type physical
        set alias "LAN"
        set role lan
    next
end

config firewall policy
    edit 1
        set name "allow-internet"
        set srcintf "port2"
        set dstintf "port1"
        set srcaddr "LAN_SUBNET"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
        set logtraffic all
    next
    edit 2
        set name "deny-all"
        set srcintf "any"
        set dstintf "any"
        set srcaddr "all"
        set dstaddr "all"
        set action deny
        set schedule "always"
        set service "ALL"
        set logtraffic all
    next
end`;

const sampleConfig2 = `config system global
    set hostname "FG-HQ-DC1"
    set timezone "US/Eastern"
    set admin-sport 8443
    set admin-ssh-port 2222
    set admintimeout 15
    set admin-lockout-threshold 3
end

config system interface
    edit "port1"
        set vdom "root"
        set ip 10.0.1.1 255.255.255.0
        set allowaccess ping https ssh snmp fgfm
        set type physical
        set alias "WAN1"
        set role wan
    next
    edit "port2"
        set vdom "root"
        set ip 172.16.0.1 255.255.255.0
        set allowaccess ping https ssh
        set type physical
        set alias "LAN"
        set role lan
    next
    edit "port3"
        set vdom "DMZ"
        set ip 192.168.1.1 255.255.255.0
        set allowaccess ping https
        set type physical
        set alias "DMZ"
    next
end

config firewall policy
    edit 1
        set name "allow-internet"
        set srcintf "port2"
        set dstintf "port1"
        set srcaddr "LAN_SUBNET"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
        set logtraffic all
        set utm-status enable
        set av-profile "default"
        set ips-sensor "default"
    next
    edit 2
        set name "dmz-to-internet"
        set srcintf "port3"
        set dstintf "port1"
        set srcaddr "DMZ_SUBNET"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "HTTP HTTPS DNS"
        set nat enable
        set logtraffic all
    next
    edit 3
        set name "deny-all"
        set srcintf "any"
        set dstintf "any"
        set srcaddr "all"
        set dstaddr "all"
        set action deny
        set schedule "always"
        set service "ALL"
        set logtraffic all
    next
end`;

const mockBackups: Backup[] = [
  { id: 'b1', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'Full', backup_type: 'manual', file_size: 245760, file_hash: 'a3f2e8c1d4b5...', config_content: sampleConfig2, notes: 'Post-DMZ configuration', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'b2', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'Full', backup_type: 'scheduled', file_size: 238592, file_hash: 'b7d1f3a2e6c4...', config_content: sampleConfig1, notes: 'Daily scheduled backup', created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'b3', device_id: '2', device_name: 'FG-HQ-DC2', vdom: 'Full', backup_type: 'scheduled', file_size: 241664, file_hash: 'c9e2a4b7d1f3...', config_content: sampleConfig1, notes: 'Daily scheduled backup', created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'b4', device_id: '3', device_name: 'FG-BRANCH-NYC', vdom: 'root', backup_type: 'manual', file_size: 128000, file_hash: 'd4f1e3c7a2b5...', config_content: sampleConfig1, notes: 'Pre-change backup', created_at: new Date(Date.now() - 172800000).toISOString() },
  { id: 'b5', device_id: '4', device_name: 'FG-BRANCH-LON', vdom: 'Full', backup_type: 'scheduled', file_size: 134144, file_hash: 'e8a3b6d2f1c4...', config_content: sampleConfig1, notes: '', created_at: new Date(Date.now() - 259200000).toISOString() },
  { id: 'b6', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'root', backup_type: 'vdom', file_size: 102400, file_hash: 'f2c4d7a1e3b6...', config_content: sampleConfig1, notes: 'Root VDOM only', created_at: new Date(Date.now() - 345600000).toISOString() },
  { id: 'b7', device_id: '6', device_name: 'FG-BRANCH-SYD', vdom: 'Full', backup_type: 'manual', file_size: 118784, file_hash: 'a1b3c5d7e2f4...', config_content: sampleConfig1, notes: 'Before firmware upgrade', created_at: new Date(Date.now() - 604800000).toISOString() },
  { id: 'b8', device_id: '3', device_name: 'FG-BRANCH-NYC', vdom: 'Full', backup_type: 'scheduled', file_size: 125952, file_hash: 'b2d4f6a1c3e5...', config_content: sampleConfig2, notes: '', created_at: new Date(Date.now() - 432000000).toISOString() },
];

function formatSize(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const typeColors: Record<string, string> = {
  manual: 'text-primary-400 bg-primary-400/10 border-primary-400/30',
  scheduled: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  vdom: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  full: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
};

const diffStyles = {
  variables: {
    dark: {
      diffViewerBackground: '#0f172a',
      diffViewerColor: '#e2e8f0',
      addedBackground: '#064e3b40',
      addedColor: '#6ee7b7',
      removedBackground: '#7f1d1d40',
      removedColor: '#fca5a5',
      wordAddedBackground: '#065f4620',
      wordRemovedBackground: '#991b1b20',
      addedGutterBackground: '#064e3b30',
      removedGutterBackground: '#7f1d1d30',
      gutterBackground: '#1e293b',
      gutterBackgroundDark: '#0f172a',
      highlightBackground: '#1e293b',
      highlightGutterBackground: '#1e293b',
      codeFoldGutterBackground: '#1e293b',
      codeFoldBackground: '#1e293b',
      emptyLineBackground: '#0f172a',
      gutterColor: '#475569',
      addedGutterColor: '#34d399',
      removedGutterColor: '#f87171',
      codeFoldContentColor: '#64748b',
      diffViewerTitleBackground: '#1e293b',
      diffViewerTitleColor: '#e2e8f0',
      diffViewerTitleBorderColor: '#334155',
    },
  },
};

const BACKUPS_STORAGE_KEY = 'fortimanager-pro-backups';

function loadBackups(): Backup[] {
  try {
    const raw = localStorage.getItem(BACKUPS_STORAGE_KEY);
    if (!raw) return mockBackups;
    const parsed = JSON.parse(raw) as Backup[];
    return Array.isArray(parsed) ? parsed : mockBackups;
  } catch {
    return mockBackups;
  }
}

export default function Backups() {
  const location = useLocation();
  const { scope } = useScope();
  const selectedDeviceId = (location.state as { selectedDeviceId?: string } | null)?.selectedDeviceId;
  const [searchQuery, setSearchQuery] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [diffOpen, setDiffOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewContent, setViewContent] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDevice, setCreateDevice] = useState('');
  const [createVdom, setCreateVdom] = useState('full');
  const [createNotes, setCreateNotes] = useState('');
  const [backups, setBackups] = useState<Backup[]>(loadBackups);
  const [actionMessage, setActionMessage] = useState('');
  const [allDevices, setAllDevices] = useState<{ id: string; name: string; vdoms: string[] }[]>([]);

  // Load real devices from API for the device selector
  useEffect(() => {
    deviceService.getAll()
      .then((res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = res.data as any[];
        if (Array.isArray(list) && list.length > 0) {
          setAllDevices(list.map((d: any) => {
            const dev = mapBackendDevice(d);
            return {
              id: dev.id,
              name: dev.name,
              vdoms: Array.isArray(d.vdom_list) && d.vdom_list.length > 0
                ? d.vdom_list as string[]
                : ['root'],
            };
          }));
        }
      })
      .catch(() => { /* keep empty */ });
  }, []);

  // Device names from backups + all real devices (merged, unique)
  const devices = useMemo(() => {
    const fromBackups = backups.map((b) => b.device_name);
    const fromApi = allDevices.map((d) => d.name);
    return [...new Set([...fromApi, ...fromBackups])];
  }, [backups, allDevices]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    const matched = backups.find((b) => b.device_id === selectedDeviceId);
    if (matched) setDeviceFilter(matched.device_name);
    setCreateDevice(matched?.device_name || '');
  }, [selectedDeviceId, backups]);

  useEffect(() => {
    if (!selectedDeviceId && scope.deviceId !== 'all') {
      const matched = backups.find((b) => b.device_id === scope.deviceId);
      if (matched) setDeviceFilter(matched.device_name);
    }
  }, [scope.deviceId, selectedDeviceId, backups]);

  useEffect(() => {
    try {
      localStorage.setItem(BACKUPS_STORAGE_KEY, JSON.stringify(backups));
    } catch {
      // ignore localStorage errors
    }
  }, [backups]);

  const filtered = useMemo(() => {
    return backups.filter((b) => {
      const matchSearch = b.device_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.notes.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDevice = deviceFilter === 'all' || b.device_name === deviceFilter;
      const matchType = typeFilter === 'all' || b.backup_type === typeFilter;
      const matchVdom = scope.vdom === 'all' || b.vdom.toLowerCase() === scope.vdom.toLowerCase() || b.vdom === 'Full';
      return matchSearch && matchDevice && matchType && matchVdom;
    });
  }, [searchQuery, deviceFilter, typeFilter, scope.vdom, backups]);

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) setSelectedIds(selectedIds.filter((s) => s !== id));
    else if (selectedIds.length < 2) setSelectedIds([...selectedIds, id]);
  };

  const handleCompare = () => {
    if (selectedIds.length === 2) setDiffOpen(true);
  };

  const diffBackup1 = backups.find((b) => b.id === selectedIds[0]);
  const diffBackup2 = backups.find((b) => b.id === selectedIds[1]);

  const additions = 18;
  const deletions = 3;
  const modifications = 4;

  const handleCreateBackup = () => {
    const deviceName = createDevice.trim();
    if (!deviceName) {
      setActionMessage('יש לבחור פיירוול לפני שמירה');
      return;
    }
    const knownDevice = allDevices.find((d) => d.name === deviceName);
    const known = backups.find((b) => b.device_name === deviceName);
    const deviceId = knownDevice?.id || known?.device_id || `${Date.now()}`;
    const vdom = createVdom === 'full' ? 'Full' : createVdom;
    const newBackup: Backup = {
      id: `b${Date.now()}`,
      device_id: deviceId,
      device_name: deviceName,
      vdom,
      backup_type: createVdom === 'full' ? 'manual' : 'vdom',
      file_size: Math.floor(120000 + Math.random() * 140000),
      file_hash: `${Math.random().toString(16).slice(2, 14)}...`,
      config_content: createVdom === 'full' ? sampleConfig2 : sampleConfig1,
      notes: createNotes.trim(),
      created_at: new Date().toISOString(),
    };
    setBackups((prev) => [newBackup, ...prev]);
    setCreateOpen(false);
    setCreateVdom('full');
    setCreateNotes('');
    setSelectedIds([]);
    setActionMessage(`הקונפיגורציה נשמרה בהצלחה עבור ${deviceName}`);
    setTimeout(() => setActionMessage(''), 3000);
  };

  const handleDownloadBackup = (backup: Backup) => {
    try {
      const safeDevice = backup.device_name.replace(/[^a-zA-Z0-9-_]/g, '_');
      const safeVdom = backup.vdom.replace(/[^a-zA-Z0-9-_]/g, '_');
      const ts = new Date(backup.created_at).toISOString().replace(/[:.]/g, '-');
      const fileName = `${safeDevice}_${safeVdom}_${ts}.conf`;
      const blob = new Blob([backup.config_content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setActionMessage(`הקובץ ירד: ${fileName}`);
      setTimeout(() => setActionMessage(''), 2500);
    } catch {
      setActionMessage('הורדת הקובץ נכשלה');
      setTimeout(() => setActionMessage(''), 2500);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search backups..."
              className="input-dark pl-9"
            />
          </div>
          <select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)} className="input-dark w-auto text-sm">
            <option value="all">All Devices</option>
            {devices.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-dark w-auto text-sm">
            <option value="all">All Types</option>
            <option value="manual">Manual</option>
            <option value="scheduled">Scheduled</option>
            <option value="vdom">VDOM</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          {compareMode ? (
            <>
              <span className="text-xs text-slate-400">{selectedIds.length}/2 selected</span>
              <button
                onClick={handleCompare}
                disabled={selectedIds.length !== 2}
                className="btn-primary text-sm"
              >
                <GitCompareArrows className="w-4 h-4" /> Compare Selected
              </button>
              <button onClick={() => { setCompareMode(false); setSelectedIds([]); }} className="btn-secondary text-sm">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setCompareMode(true)} className="btn-secondary text-sm">
                <GitCompareArrows className="w-4 h-4" /> Compare
              </button>
              <button className="btn-secondary text-sm">
                <Clock className="w-4 h-4" /> Auto Backup
              </button>
              <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm">
                <Plus className="w-4 h-4" /> Backup Now
              </button>
            </>
          )}
        </div>
        {actionMessage && (
          <div className="text-xs text-emerald-400">{actionMessage}</div>
        )}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left">
                {compareMode && <th className="px-4 py-3 w-10" />}
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Device</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">VDOM</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Size</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Hash</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Notes</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((backup) => (
                <tr key={backup.id} className={clsx('border-b border-dark-700/50 table-row-hover', selectedIds.includes(backup.id) && 'bg-primary-500/5')}>
                  {compareMode && (
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelect(backup.id)}>
                        {selectedIds.includes(backup.id)
                          ? <CheckSquare className="w-4 h-4 text-primary-400" />
                          : <Square className="w-4 h-4 text-slate-500" />
                        }
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Server className="w-3.5 h-3.5 text-primary-400" />
                      <span className="text-slate-200">{backup.device_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{backup.vdom}</td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-xs text-slate-200">{format(new Date(backup.created_at), 'MMM d, yyyy HH:mm')}</p>
                      <p className="text-[10px] text-slate-500">{formatDistanceToNow(new Date(backup.created_at), { addSuffix: true })}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('inline-block px-2 py-0.5 text-xs rounded-full border', typeColors[backup.backup_type])}>
                      {backup.backup_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">{formatSize(backup.file_size)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">{backup.file_hash}</td>
                  <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px] truncate">{backup.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDownloadBackup(backup)}
                        className="p-1.5 text-slate-400 hover:text-primary-400 hover:bg-dark-700 rounded transition-colors"
                        title="Download configuration file"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setViewContent(backup.config_content); setViewOpen(true); }}
                        className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-dark-700 rounded transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-dark-700 rounded transition-colors">
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
            <DatabaseBackup className="w-12 h-12 mb-3 text-slate-600" />
            <p className="text-lg font-medium">No backups found</p>
            <p className="text-sm mt-1">Create your first backup or adjust filters</p>
          </div>
        )}
      </div>

      <Modal isOpen={diffOpen} onClose={() => setDiffOpen(false)} title="Configuration Comparison" size="full">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-emerald-400 font-medium">+{additions}</span> additions
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-red-400 font-medium">-{deletions}</span> deletions
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-amber-400 font-medium">~{modifications}</span> modifications
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {diffBackup1?.device_name} • {diffBackup1 && format(new Date(diffBackup1.created_at), 'MMM d, HH:mm')}
              {' vs '}
              {diffBackup2?.device_name} • {diffBackup2 && format(new Date(diffBackup2.created_at), 'MMM d, HH:mm')}
            </div>
          </div>
          <div className="border border-dark-700 rounded-lg overflow-hidden text-xs">
            <ReactDiffViewer
              oldValue={diffBackup2?.config_content || ''}
              newValue={diffBackup1?.config_content || ''}
              splitView={true}
              useDarkTheme={true}
              styles={diffStyles}
              compareMethod={DiffMethod.LINES}
              leftTitle={`${diffBackup2?.device_name} — ${diffBackup2 && format(new Date(diffBackup2.created_at), 'MMM d, yyyy HH:mm')}`}
              rightTitle={`${diffBackup1?.device_name} — ${diffBackup1 && format(new Date(diffBackup1.created_at), 'MMM d, yyyy HH:mm')}`}
            />
          </div>
        </div>
      </Modal>

      <Modal isOpen={viewOpen} onClose={() => setViewOpen(false)} title="Configuration View" size="xl">
        <div className="bg-dark-900 rounded-lg p-4 font-mono text-xs text-slate-300 whitespace-pre overflow-auto max-h-[60vh] leading-relaxed">
          {viewContent}
        </div>
      </Modal>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Backup"
        footer={
          <>
            <button onClick={() => setCreateOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleCreateBackup} className="btn-primary text-sm">
              <DatabaseBackup className="w-4 h-4" /> Create Backup
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Device</label>
            <select value={createDevice} onChange={(e) => setCreateDevice(e.target.value)} className="input-dark">
              <option value="">Select a device...</option>
              {devices.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Scope</label>
            <select value={createVdom} onChange={(e) => setCreateVdom(e.target.value)} className="input-dark">
              <option value="full">Full Configuration</option>
              {(allDevices.find((d) => d.name === createDevice)?.vdoms || ['root']).map((v) => (
                <option key={v} value={v}>VDOM: {v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Notes</label>
            <textarea
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
              rows={3}
              placeholder="Reason for backup..."
              className="input-dark resize-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
