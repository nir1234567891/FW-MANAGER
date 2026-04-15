import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Download, Trash2, Eye, GitCompareArrows, DatabaseBackup, Plus, Clock,
  Search, CheckSquare, Square, Server, RefreshCw, Loader2, HardDrive,
} from 'lucide-react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import Modal from '@/components/Modal';
import type { Backup } from '@/types';
import { format, formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';
import { useScope } from '@/hooks/useScope';
import { deviceService, backupService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';
import { useToast } from '@/components/Toast';

function formatSize(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const typeColors: Record<string, string> = {
  manual: 'text-primary-400 bg-primary-400/10 border-primary-400/30',
  scheduled: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  auto: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
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

export default function Backups() {
  const location = useLocation();
  const { scope } = useScope();
  const { addToast } = useToast();
  const selectedDeviceId = (location.state as { selectedDeviceId?: string } | null)?.selectedDeviceId;

  const [searchQuery, setSearchQuery] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffContent1, setDiffContent1] = useState('');
  const [diffContent2, setDiffContent2] = useState('');
  const [viewOpen, setViewOpen] = useState(false);
  const [viewContent, setViewContent] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createDevice, setCreateDevice] = useState('');
  const [createVdom, setCreateVdom] = useState('full');
  const [createNotes, setCreateNotes] = useState('');
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [allDevices, setAllDevices] = useState<{ id: string; name: string; vdoms: string[] }[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [devRes, bkpRes] = await Promise.allSettled([
        deviceService.getAll(),
        backupService.getAll(),
      ]);

      if (devRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = devRes.value.data as any[];
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
      }

      if (bkpRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = bkpRes.value.data as any[];
        if (Array.isArray(list)) {
          setBackups(list.map((b: any) => ({
            id: String(b.id),
            device_id: String(b.device_id),
            device_name: b.device_name || `Device ${b.device_id}`,
            vdom: b.vdom_name || 'Full',
            backup_type: b.backup_type || 'manual',
            file_size: b.file_size || 0,
            file_hash: b.config_hash || '',
            config_content: '',
            notes: b.notes || '',
            created_at: b.created_at || new Date().toISOString(),
          })));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const deviceNames = useMemo(() => {
    const fromApi = allDevices.map((d) => d.name);
    const fromBackups = backups.map((b) => b.device_name);
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

  const loadBackupContent = async (backup: Backup): Promise<string> => {
    if (backup.config_content) return backup.config_content;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await backupService.getContent(backup.id) as any;
      const content = res.data?.content || '';
      setBackups((prev) =>
        prev.map((b) => (b.id === backup.id ? { ...b, config_content: content } : b))
      );
      return content;
    } catch {
      return 'Failed to load backup content from server';
    }
  };

  const handleCompare = async () => {
    if (selectedIds.length !== 2) return;
    const b1 = backups.find((b) => b.id === selectedIds[0]);
    const b2 = backups.find((b) => b.id === selectedIds[1]);
    if (!b1 || !b2) return;

    setActionLoading(true);
    try {
      const [c1, c2] = await Promise.all([
        loadBackupContent(b1),
        loadBackupContent(b2),
      ]);
      setDiffContent1(c1);
      setDiffContent2(c2);
      setDiffOpen(true);
    } catch {
      addToast('error', 'Failed to load backup content for comparison');
    } finally {
      setActionLoading(false);
    }
  };

  const diffBackup1 = backups.find((b) => b.id === selectedIds[0]);
  const diffBackup2 = backups.find((b) => b.id === selectedIds[1]);

  const handleCreateBackup = async () => {
    const deviceName = createDevice.trim();
    if (!deviceName) {
      addToast('warning', 'Please select a device');
      return;
    }
    const knownDevice = allDevices.find((d) => d.name === deviceName);
    if (!knownDevice) {
      addToast('error', 'Device not found');
      return;
    }

    setActionLoading(true);
    try {
      const vdomValue = createVdom === 'full' ? undefined : createVdom;
      await backupService.create({
        device_id: knownDevice.id,
        vdom: vdomValue,
        notes: createNotes.trim(),
      });
      addToast('success', `Backup created for ${deviceName}`);
      setCreateOpen(false);
      setCreateVdom('full');
      setCreateNotes('');
      await fetchData();
    } catch {
      addToast('error', 'Failed to create backup');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (backup: Backup) => {
    try {
      await backupService.delete(backup.id);
      setBackups((prev) => prev.filter((b) => b.id !== backup.id));
      addToast('success', `Backup deleted: ${backup.filename || backup.id}`);
    } catch {
      addToast('error', 'Failed to delete backup');
    }
  };

  const handleAutoBackup = async () => {
    setActionLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await backupService.autoBackup() as any;
      const data = res.data;
      addToast(
        data?.failed > 0 ? 'warning' : 'success',
        data?.message || 'Auto-backup complete',
      );
      await fetchData();
    } catch {
      addToast('error', 'Auto-backup failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBackupAll = async () => {
    setActionLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await backupService.backupAll() as any;
      const data = res.data;
      addToast(
        data?.failed > 0 ? 'warning' : 'success',
        data?.message || 'Bulk backup complete',
      );
      await fetchData();
    } catch {
      addToast('error', 'Bulk backup failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadBackup = async (backup: Backup) => {
    try {
      const content = await loadBackupContent(backup);
      const safeDevice = backup.device_name.replace(/[^a-zA-Z0-9-_]/g, '_');
      const safeVdom = backup.vdom.replace(/[^a-zA-Z0-9-_]/g, '_');
      const ts = new Date(backup.created_at).toISOString().replace(/[:.]/g, '-');
      const fileName = `${safeDevice}_${safeVdom}_${ts}.conf`;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast('success', `Downloaded: ${fileName}`);
    } catch {
      addToast('error', 'Download failed');
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
            {deviceNames.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-dark w-auto text-sm">
            <option value="all">All Types</option>
            <option value="manual">Manual</option>
            <option value="scheduled">Scheduled</option>
            <option value="auto">Auto</option>
            <option value="vdom">VDOM</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          {compareMode ? (
            <>
              <span className="text-xs text-slate-400">{selectedIds.length}/2 selected</span>
              <button
                onClick={handleCompare}
                disabled={selectedIds.length !== 2 || actionLoading}
                className="btn-primary text-sm"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompareArrows className="w-4 h-4" />} Compare
              </button>
              <button onClick={() => { setCompareMode(false); setSelectedIds([]); }} className="btn-secondary text-sm">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => fetchData()} className="btn-secondary text-sm">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
              <button onClick={() => setCompareMode(true)} className="btn-secondary text-sm">
                <GitCompareArrows className="w-4 h-4" /> Compare
              </button>
              <button onClick={handleAutoBackup} className="btn-secondary text-sm" disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Auto Backup
              </button>
              <button onClick={handleBackupAll} className="btn-secondary text-sm" disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />} Backup All
              </button>
              <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm">
                <Plus className="w-4 h-4" /> Backup Now
              </button>
            </>
          )}
        </div>
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
                    <span className={clsx('inline-block px-2 py-0.5 text-xs rounded-full border', typeColors[backup.backup_type] || typeColors.manual)}>
                      {backup.backup_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">{formatSize(backup.file_size)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">{backup.file_hash ? backup.file_hash.slice(0, 12) + '...' : '—'}</td>
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
                        onClick={async () => {
                          const content = await loadBackupContent(backup);
                          setViewContent(content);
                          setViewOpen(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-dark-700 rounded transition-colors"
                        title="View configuration"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(backup)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-dark-700 rounded transition-colors"
                        title="Delete backup"
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
            <DatabaseBackup className="w-12 h-12 mb-3 text-slate-600" />
            <p className="text-lg font-medium">No backups found</p>
            <p className="text-sm mt-1">Create your first backup or adjust filters</p>
          </div>
        )}
      </div>

      <Modal isOpen={diffOpen} onClose={() => setDiffOpen(false)} title="Configuration Comparison" size="full">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              {diffBackup1?.device_name} • {diffBackup1 && format(new Date(diffBackup1.created_at), 'MMM d, HH:mm')}
              {' vs '}
              {diffBackup2?.device_name} • {diffBackup2 && format(new Date(diffBackup2.created_at), 'MMM d, HH:mm')}
            </div>
          </div>
          <div className="border border-dark-700 rounded-lg overflow-hidden text-xs">
            <ReactDiffViewer
              oldValue={diffContent2}
              newValue={diffContent1}
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
          {viewContent || 'No content available'}
        </div>
      </Modal>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Backup"
        footer={
          <>
            <button onClick={() => setCreateOpen(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleCreateBackup} className="btn-primary text-sm" disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <DatabaseBackup className="w-4 h-4" />} Create Backup
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Device</label>
            <select value={createDevice} onChange={(e) => setCreateDevice(e.target.value)} className="input-dark">
              <option value="">Select a device...</option>
              {allDevices.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
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
