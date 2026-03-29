import { useState, useMemo, useEffect } from 'react';
import {
  Shield, Search, ChevronRight, X, CheckCircle2, XCircle, Ban,
  ToggleLeft, ToggleRight, Plus, AlertTriangle, Eye, Trash2, Copy,
  TrendingDown, Clock, Layers,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { Policy } from '@/types';
import { useScope } from '@/hooks/useScope';

type LocalPolicy = Policy & {
  device_id: string;
  vdom: string;
};

type ObjectKind = 'address' | 'service' | 'group';
type UserStatus = 'active' | 'disabled';

interface FirewallObject {
  id: string;
  name: string;
  kind: ObjectKind;
  value: string;
  comment: string;
  devices: string[];
}

interface FirewallUser {
  id: string;
  username: string;
  auth_type: 'local' | 'ldap' | 'radius';
  status: UserStatus;
  groups: string[];
  devices: string[];
  last_login: string;
}

const devices = [
  { id: '1', name: 'FG-HQ-DC1', vdoms: ['root', 'DMZ', 'Guest'] },
  { id: '2', name: 'FG-HQ-DC2', vdoms: ['root', 'DMZ', 'Guest'] },
  { id: '3', name: 'FG-BRANCH-NYC', vdoms: ['root'] },
  { id: '4', name: 'FG-BRANCH-LON', vdoms: ['root'] },
  { id: '6', name: 'FG-BRANCH-SYD', vdoms: ['root'] },
];

const mockPolicies: LocalPolicy[] = [
  { id: 1, device_id: '1', vdom: 'root', name: 'allow-internet', source_interface: 'port2 (LAN)', dest_interface: 'port1 (WAN)', source_address: 'LAN_SUBNET', dest_address: 'all', service: 'ALL', action: 'accept', nat: true, log: true, status: 'enabled', hit_count: 1842956, schedule: 'always', comments: 'Allow LAN to Internet with NAT' },
  { id: 2, device_id: '1', vdom: 'root', name: 'allow-dns', source_interface: 'port2 (LAN)', dest_interface: 'port1 (WAN)', source_address: 'LAN_SUBNET', dest_address: 'DNS_SERVERS', service: 'DNS', action: 'accept', nat: true, log: false, status: 'enabled', hit_count: 5621340, schedule: 'always', comments: 'DNS resolution for LAN' },
  { id: 3, device_id: '1', vdom: 'root', name: 'vpn-hq-to-nyc', source_interface: 'port2 (LAN)', dest_interface: 'HQ-NYC-VPN', source_address: 'HQ_SUBNET', dest_address: 'NYC_SUBNET', service: 'ALL', action: 'accept', nat: false, log: true, status: 'enabled', hit_count: 892451, schedule: 'always', comments: 'Site-to-site VPN traffic to NYC' },
  { id: 4, device_id: '1', vdom: 'root', name: 'vpn-hq-to-lon', source_interface: 'port2 (LAN)', dest_interface: 'HQ-LON-VPN', source_address: 'HQ_SUBNET', dest_address: 'LON_SUBNET', service: 'ALL', action: 'accept', nat: false, log: true, status: 'enabled', hit_count: 645832, schedule: 'always', comments: 'Site-to-site VPN traffic to London' },
  { id: 5, device_id: '1', vdom: 'DMZ', name: 'allow-mgmt', source_interface: 'port2 (LAN)', dest_interface: 'any', source_address: 'MGMT_HOSTS', dest_address: 'FORTIGATE_MGMT', service: 'HTTPS SSH', action: 'accept', nat: false, log: true, status: 'enabled', hit_count: 45230, schedule: 'always', comments: 'Management access from trusted hosts' },
  { id: 6, device_id: '1', vdom: 'Guest', name: 'deny-guest-internal', source_interface: 'port4 (Guest)', dest_interface: 'port2 (LAN)', source_address: 'GUEST_SUBNET', dest_address: 'LAN_SUBNET', service: 'ALL', action: 'deny', nat: false, log: true, status: 'enabled', hit_count: 128943, schedule: 'always', comments: 'Block guest access to internal LAN' },
  { id: 7, device_id: '2', vdom: 'Guest', name: 'guest-internet', source_interface: 'port4 (Guest)', dest_interface: 'port1 (WAN)', source_address: 'GUEST_SUBNET', dest_address: 'all', service: 'HTTP HTTPS DNS', action: 'accept', nat: true, log: true, status: 'enabled', hit_count: 342198, schedule: 'always', comments: 'Guest internet access (restricted services)' },
  { id: 8, device_id: '2', vdom: 'DMZ', name: 'dmz-web-servers', source_interface: 'port1 (WAN)', dest_interface: 'port3 (DMZ)', source_address: 'all', dest_address: 'DMZ_WEB_SERVERS', service: 'HTTP HTTPS', action: 'accept', nat: false, log: true, status: 'enabled', hit_count: 2341567, schedule: 'always', comments: 'Inbound web traffic to DMZ servers' },
  { id: 9, device_id: '3', vdom: 'root', name: 'legacy-ftp-access', source_interface: 'port1 (WAN)', dest_interface: 'port3 (DMZ)', source_address: 'PARTNER_IPS', dest_address: 'FTP_SERVER', service: 'FTP', action: 'accept', nat: false, log: true, status: 'disabled', hit_count: 1205, schedule: 'always', comments: 'Legacy FTP access (scheduled for removal)' },
  { id: 10, device_id: '4', vdom: 'root', name: 'block-tor-exit-nodes', source_interface: 'any', dest_interface: 'any', source_address: 'TOR_EXIT_NODES', dest_address: 'all', service: 'ALL', action: 'deny', nat: false, log: true, status: 'enabled', hit_count: 89432, schedule: 'always', comments: 'Block known Tor exit nodes' },
  { id: 11, device_id: '6', vdom: 'root', name: 'voip-traffic', source_interface: 'port2 (LAN)', dest_interface: 'port1 (WAN)', source_address: 'VOIP_PHONES', dest_address: 'SIP_PROVIDER', service: 'SIP H323', action: 'accept', nat: true, log: false, status: 'enabled', hit_count: 156789, schedule: 'always', comments: 'VoIP traffic to SIP provider' },
  { id: 12, device_id: '6', vdom: 'root', name: 'deny-all', source_interface: 'any', dest_interface: 'any', source_address: 'all', dest_address: 'all', service: 'ALL', action: 'deny', nat: false, log: true, status: 'enabled', hit_count: 3452910, schedule: 'always', comments: 'Implicit deny all' },
];

const mockObjects: FirewallObject[] = [
  { id: 'o1', name: 'HQ_SUBNET', kind: 'address', value: '10.0.0.0/16', comment: 'HQ LAN', devices: ['1', '2'] },
  { id: 'o2', name: 'NYC_SUBNET', kind: 'address', value: '10.1.0.0/16', comment: 'Branch NYC', devices: ['1', '2', '3'] },
  { id: 'o3', name: 'LON_SUBNET', kind: 'address', value: '10.2.0.0/16', comment: 'Branch London', devices: ['1', '2', '4'] },
  { id: 'o4', name: 'SSH_HTTPS', kind: 'service', value: 'TCP/22,443', comment: 'Admin services', devices: ['1', '2', '3', '4', '6'] },
  { id: 'o5', name: 'WEB_PORTS', kind: 'service', value: 'TCP/80,443', comment: 'Web access', devices: ['1', '2', '3', '4', '6'] },
  { id: 'o6', name: 'BRANCH_OFFICES', kind: 'group', value: 'NYC_SUBNET, LON_SUBNET', comment: 'All branch networks', devices: ['1', '2'] },
];

const mockUsers: FirewallUser[] = [
  { id: 'u1', username: 'netadmin', auth_type: 'local', status: 'active', groups: ['super_admin'], devices: ['1', '2'], last_login: '2026-03-25T09:12:00Z' },
  { id: 'u2', username: 'soc_analyst_1', auth_type: 'ldap', status: 'active', groups: ['read_only', 'soc_team'], devices: ['1', '2', '3', '4'], last_login: '2026-03-25T08:01:00Z' },
  { id: 'u3', username: 'branch_it_london', auth_type: 'radius', status: 'active', groups: ['branch_admin'], devices: ['4'], last_login: '2026-03-24T15:42:00Z' },
  { id: 'u4', username: 'legacy_admin', auth_type: 'local', status: 'disabled', groups: ['super_admin'], devices: ['6'], last_login: '2026-02-10T10:30:00Z' },
];

const OBJECTS_STORAGE_KEY = 'fortimanager-pro-objects';

function loadObjects(): FirewallObject[] {
  try {
    const raw = localStorage.getItem(OBJECTS_STORAGE_KEY);
    if (!raw) return mockObjects;
    const parsed = JSON.parse(raw) as FirewallObject[];
    return Array.isArray(parsed) ? parsed : mockObjects;
  } catch {
    return mockObjects;
  }
}

export default function Policies() {
  const { scope, setDeviceId: setGlobalDeviceId, setVdom: setGlobalVdom } = useScope();
  const [activeTab, setActiveTab] = useState<'policies' | 'objects' | 'users' | 'audit'>('policies');
  const [selectedDeviceId, setSelectedDeviceId] = useState(scope.deviceId === 'all' ? '1' : scope.deviceId);
  const [selectedVdom, setSelectedVdom] = useState(scope.vdom === 'all' ? 'root' : scope.vdom);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPolicy, setSelectedPolicy] = useState<LocalPolicy | null>(null);
  const [objectSearch, setObjectSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [targetDevices, setTargetDevices] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState('');
  const [objects, setObjects] = useState<FirewallObject[]>(loadObjects);
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectKind, setNewObjectKind] = useState<ObjectKind>('address');
  const [newObjectValue, setNewObjectValue] = useState('');
  const [newObjectComment, setNewObjectComment] = useState('');
  const [newObjectTargets, setNewObjectTargets] = useState<string[]>([]);

  useEffect(() => {
    if (scope.deviceId !== 'all') setSelectedDeviceId(scope.deviceId);
    if (scope.vdom !== 'all') setSelectedVdom(scope.vdom);
  }, [scope.deviceId, scope.vdom]);

  useEffect(() => {
    try {
      localStorage.setItem(OBJECTS_STORAGE_KEY, JSON.stringify(objects));
    } catch {
      // ignore localStorage errors
    }
  }, [objects]);

  const currentDevice = devices.find((d) => d.id === selectedDeviceId);

  const filtered = useMemo(() => {
    return mockPolicies.filter((p) => {
      const q = searchQuery.toLowerCase();
      const deviceMatch = selectedDeviceId === 'all' || p.device_id === selectedDeviceId;
      const vdomMatch = selectedVdom === 'all' || p.vdom === selectedVdom;
      const textMatch = p.name.toLowerCase().includes(q) ||
        p.source_address.toLowerCase().includes(q) ||
        p.dest_address.toLowerCase().includes(q) ||
        p.service.toLowerCase().includes(q);
      return deviceMatch && vdomMatch && textMatch;
    });
  }, [searchQuery, selectedDeviceId, selectedVdom]);

  const totalAccept = filtered.filter((p) => p.action === 'accept').length;
  const totalDeny = filtered.filter((p) => p.action === 'deny').length;
  const totalDisabled = filtered.filter((p) => p.status === 'disabled').length;

  const visibleObjects = useMemo(() => {
    const q = objectSearch.toLowerCase();
    return objects.filter((o) => {
      const text = o.name.toLowerCase().includes(q) ||
        o.kind.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q);
      const scopeMatch = selectedDeviceId === 'all' || o.devices.includes(selectedDeviceId);
      return text && scopeMatch;
    });
  }, [objectSearch, objects, selectedDeviceId]);

  const visibleUsers = useMemo(() => {
    const q = userSearch.toLowerCase();
    return mockUsers.filter((u) => {
      const text = u.username.toLowerCase().includes(q) ||
        u.auth_type.toLowerCase().includes(q) ||
        u.groups.join(',').toLowerCase().includes(q);
      const scopeMatch = selectedDeviceId === 'all' || u.devices.includes(selectedDeviceId);
      return text && scopeMatch;
    });
  }, [userSearch, selectedDeviceId]);

  const handleApplyObject = (mode: 'all' | 'selected') => {
    const obj = objects.find((o) => o.id === selectedObjectId);
    if (!obj) {
      setActionMessage('בחר אובייקט להפצה');
      return;
    }
    const targetIds = mode === 'all' ? devices.map((d) => d.id) : targetDevices;
    const deviceNames = devices.filter((d) => targetIds.includes(d.id)).map((d) => d.name);
    if (deviceNames.length === 0) {
      setActionMessage('לא נבחרו פיירוולים להפצה');
      return;
    }
    setObjects((prev) => prev.map((o) => (
      o.id !== obj.id
        ? o
        : { ...o, devices: Array.from(new Set([...o.devices, ...targetIds])) }
    )));
    setActionMessage(`בוצע Apply לאובייקט "${obj.name}" עבור: ${deviceNames.join(', ')}`);
  };

  const handleCreateObject = () => {
    if (!newObjectName.trim() || !newObjectValue.trim()) {
      setActionMessage('יש למלא שם וערך לאובייקט החדש');
      return;
    }
    const targets = newObjectTargets.length ? newObjectTargets : (selectedDeviceId === 'all' ? [] : [selectedDeviceId]);
    if (targets.length === 0) {
      setActionMessage('בחר לפחות פיירוול אחד ליצירת האובייקט');
      return;
    }
    const item: FirewallObject = {
      id: `o${Date.now()}`,
      name: newObjectName.trim(),
      kind: newObjectKind,
      value: newObjectValue.trim(),
      comment: newObjectComment.trim(),
      devices: targets,
    };
    setObjects((prev) => [item, ...prev]);
    setSelectedObjectId(item.id);
    setNewObjectName('');
    setNewObjectValue('');
    setNewObjectComment('');
    setNewObjectTargets([]);
    setActionMessage(`האובייקט "${item.name}" נוצר בהצלחה`);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab('policies')}
          className={clsx('btn-secondary text-sm', activeTab === 'policies' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
        >
          Policies
        </button>
        <button
          onClick={() => setActiveTab('objects')}
          className={clsx('btn-secondary text-sm', activeTab === 'objects' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
        >
          Objects / Services / Groups
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={clsx('btn-secondary text-sm', activeTab === 'users' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
        >
          Users
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={clsx('btn-secondary text-sm', activeTab === 'audit' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
        >
          <Eye className="w-3.5 h-3.5" /> Policy Audit
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedDeviceId}
            onChange={(e) => {
              setSelectedDeviceId(e.target.value);
              setGlobalDeviceId(e.target.value);
              setSelectedVdom('all');
              setGlobalVdom('all');
            }}
            className="input-dark w-auto text-sm"
          >
            <option value="all">All Firewalls</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select
            value={selectedVdom}
            onChange={(e) => {
              setSelectedVdom(e.target.value);
              setGlobalVdom(e.target.value);
            }}
            className="input-dark w-auto text-sm"
          >
            <option value="all">All VDOMs</option>
            {currentDevice?.vdoms.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={activeTab === 'policies' ? searchQuery : activeTab === 'objects' ? objectSearch : userSearch}
              onChange={(e) => {
                if (activeTab === 'policies') setSearchQuery(e.target.value);
                if (activeTab === 'objects') setObjectSearch(e.target.value);
                if (activeTab === 'users') setUserSearch(e.target.value);
              }}
              placeholder={activeTab === 'policies' ? 'Search policies...' : activeTab === 'objects' ? 'Search objects/services/groups...' : 'Search users...'}
              className="input-dark pl-9"
            />
          </div>
        </div>
      </div>

      {activeTab === 'policies' && (
        <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-primary-400/10 rounded-lg"><Shield className="w-4 h-4 text-primary-400" /></div>
          <div>
            <p className="text-xl font-bold text-slate-100">{filtered.length}</p>
            <p className="text-xs text-slate-400">Total Policies</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-emerald-400/10 rounded-lg"><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>
          <div>
            <p className="text-xl font-bold text-emerald-400">{totalAccept}</p>
            <p className="text-xs text-slate-400">Accept</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-red-400/10 rounded-lg"><Ban className="w-4 h-4 text-red-400" /></div>
          <div>
            <p className="text-xl font-bold text-red-400">{totalDeny}</p>
            <p className="text-xs text-slate-400">Deny</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-slate-400/10 rounded-lg"><ToggleLeft className="w-4 h-4 text-slate-400" /></div>
          <div>
            <p className="text-xl font-bold text-slate-400">{totalDisabled}</p>
            <p className="text-xs text-slate-400">Disabled</p>
          </div>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700 text-left">
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider w-12">ID</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Src Intf</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Dst Intf</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Source</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Destination</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Service</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Action</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider w-12">NAT</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider w-12">Log</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Hit Count</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((policy) => (
                <tr
                  key={policy.id}
                  className={clsx(
                    'border-b border-dark-700/50 table-row-hover',
                    policy.status === 'disabled' && 'opacity-50'
                  )}
                  onClick={() => setSelectedPolicy(policy)}
                >
                  <td className="px-3 py-2.5 text-slate-500 font-mono text-xs">{policy.id}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-slate-200">{policy.name}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-300 font-mono">{policy.source_interface}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-300 font-mono">{policy.dest_interface}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-300">{policy.source_address}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-300">{policy.dest_address}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs px-1.5 py-0.5 bg-dark-700 rounded text-slate-300">{policy.service}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={clsx(
                      'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border',
                      policy.action === 'accept' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' :
                      policy.action === 'deny' ? 'text-red-400 bg-red-400/10 border-red-400/30' :
                      'text-amber-400 bg-amber-400/10 border-amber-400/30'
                    )}>
                      {policy.action === 'accept' && <CheckCircle2 className="w-3 h-3" />}
                      {policy.action === 'deny' && <XCircle className="w-3 h-3" />}
                      {policy.action}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {policy.nat ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto" /> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {policy.log ? <CheckCircle2 className="w-3.5 h-3.5 text-primary-400 mx-auto" /> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {policy.status === 'enabled' ? (
                      <ToggleRight className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-slate-500" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono text-slate-300">
                    {policy.hit_count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <Shield className="w-12 h-12 mb-3 text-slate-600" />
            <p className="text-lg font-medium">No policies found</p>
            <p className="text-sm mt-1">Try adjusting your search query</p>
          </div>
        )}
      </div>
      </>
      )}

      {activeTab === 'objects' && (
        <div className="space-y-4">
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">יצירת אובייקט חדש</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={newObjectName} onChange={(e) => setNewObjectName(e.target.value)} className="input-dark text-sm" placeholder="Object name (e.g. HR_SUBNET)" />
              <select value={newObjectKind} onChange={(e) => setNewObjectKind(e.target.value as ObjectKind)} className="input-dark text-sm">
                <option value="address">Address</option>
                <option value="service">Service</option>
                <option value="group">Group</option>
              </select>
              <input value={newObjectValue} onChange={(e) => setNewObjectValue(e.target.value)} className="input-dark text-sm md:col-span-2" placeholder="Value (CIDR / ports / members)" />
              <input value={newObjectComment} onChange={(e) => setNewObjectComment(e.target.value)} className="input-dark text-sm md:col-span-2" placeholder="Comment (optional)" />
            </div>
            <div className="flex flex-wrap gap-2">
              {devices.map((d) => (
                <button
                  key={`new-${d.id}`}
                  onClick={() => setNewObjectTargets((prev) => prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id])}
                  className={clsx('px-2.5 py-1 text-xs rounded border transition-colors',
                    newObjectTargets.includes(d.id)
                      ? 'bg-primary-500/20 text-primary-300 border-primary-500/30'
                      : 'bg-dark-900 text-slate-300 border-dark-600 hover:border-primary-500/30')}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <button onClick={handleCreateObject} className="btn-primary text-sm">
              <Plus className="w-4 h-4" /> Create Object
            </button>
          </div>

          <div className="glass-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">הפצה מהירה של אובייקט/סרביס/גרופ</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select value={selectedObjectId} onChange={(e) => setSelectedObjectId(e.target.value)} className="input-dark text-sm">
                <option value="">בחר אובייקט...</option>
                {objects.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({o.kind})</option>
                ))}
              </select>
              <div className="md:col-span-2 flex flex-wrap gap-2">
                {devices.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setTargetDevices((prev) => prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id])}
                    className={clsx('px-2.5 py-1 text-xs rounded border transition-colors',
                      targetDevices.includes(d.id)
                        ? 'bg-primary-500/20 text-primary-300 border-primary-500/30'
                        : 'bg-dark-900 text-slate-300 border-dark-600 hover:border-primary-500/30')}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleApplyObject('all')} className="btn-primary text-sm">Apply To All</button>
              <button onClick={() => handleApplyObject('selected')} className="btn-secondary text-sm">Apply To Selected</button>
            </div>
            {actionMessage && <p className="text-xs text-emerald-400">{actionMessage}</p>}
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700 text-left">
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Value</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Exists On Firewalls</th>
                    <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleObjects.map((o) => (
                    <tr key={o.id} className="border-b border-dark-700/50 table-row-hover">
                      <td className="px-3 py-2.5 text-slate-200 font-medium">{o.name}</td>
                      <td className="px-3 py-2.5 text-slate-300">{o.kind}</td>
                      <td className="px-3 py-2.5 text-slate-300 font-mono text-xs">{o.value}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {o.devices.map((id) => {
                            const d = devices.find((x) => x.id === id);
                            return <span key={`${o.id}-${id}`} className="px-2 py-0.5 text-[11px] rounded bg-dark-900 text-slate-300 border border-dark-600">{d?.name || id}</span>;
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{o.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700 text-left">
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Username</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Auth Type</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Groups</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Firewalls</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id} className="border-b border-dark-700/50 table-row-hover">
                    <td className="px-3 py-2.5 text-slate-200 font-medium">{u.username}</td>
                    <td className="px-3 py-2.5 text-slate-300">{u.auth_type.toUpperCase()}</td>
                    <td className="px-3 py-2.5 text-slate-300 text-xs">{u.groups.join(', ')}</td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('px-2 py-0.5 text-xs rounded border',
                        u.status === 'active'
                          ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
                          : 'text-red-400 bg-red-400/10 border-red-400/30')}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {u.devices.map((id) => {
                          const d = devices.find((x) => x.id === id);
                          return <span key={`${u.id}-${id}`} className="px-2 py-0.5 text-[11px] rounded bg-dark-900 text-slate-300 border border-dark-600">{d?.name || id}</span>;
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{new Date(u.last_login).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (() => {
        const scopedPolicies = mockPolicies.filter((p) => {
          const devMatch = selectedDeviceId === 'all' || p.device_id === selectedDeviceId;
          const vdomMatch = selectedVdom === 'all' || p.vdom === selectedVdom;
          return devMatch && vdomMatch;
        });

        const zeroHit = scopedPolicies.filter((p) => p.hit_count === 0 && p.status === 'enabled');
        const disabledPolicies = scopedPolicies.filter((p) => p.status === 'disabled');
        const lowHit = scopedPolicies.filter((p) => p.hit_count > 0 && p.hit_count < 100 && p.status === 'enabled');
        const denyAllPolicies = scopedPolicies.filter((p) => p.action === 'deny' && p.source_address === 'all' && p.dest_address === 'all');
        const noLogPolicies = scopedPolicies.filter((p) => !p.log && p.status === 'enabled');
        const broadPolicies = scopedPolicies.filter((p) =>
          p.status === 'enabled' && p.action === 'accept' && p.service === 'ALL' && p.source_address === 'all'
        );

        const duplicateCandidates: LocalPolicy[][] = [];
        for (let i = 0; i < scopedPolicies.length; i++) {
          for (let j = i + 1; j < scopedPolicies.length; j++) {
            const a = scopedPolicies[i], b = scopedPolicies[j];
            if (a.device_id === b.device_id && a.vdom === b.vdom &&
              a.source_interface === b.source_interface && a.dest_interface === b.dest_interface &&
              a.source_address === b.source_address && a.dest_address === b.dest_address &&
              a.service === b.service) {
              duplicateCandidates.push([a, b]);
            }
          }
        }

        type AuditFinding = { severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; category: string; description: string; policies: LocalPolicy[]; recommendation: string };
        const findings: AuditFinding[] = [];

        if (broadPolicies.length > 0)
          findings.push({ severity: 'critical', category: 'Security Risk', description: `${broadPolicies.length} overly permissive rule(s) — source "all", service "ALL", action "accept"`, policies: broadPolicies, recommendation: 'Restrict source addresses and services to follow least-privilege principle' });
        if (zeroHit.length > 0)
          findings.push({ severity: 'high', category: 'Unused Rules', description: `${zeroHit.length} enabled rule(s) with zero hits`, policies: zeroHit, recommendation: 'Consider disabling or removing these rules after verification' });
        if (disabledPolicies.length > 0)
          findings.push({ severity: 'medium', category: 'Disabled Rules', description: `${disabledPolicies.length} disabled rule(s) in policy table`, policies: disabledPolicies, recommendation: 'Clean up disabled rules to reduce policy complexity' });
        if (noLogPolicies.length > 0)
          findings.push({ severity: 'medium', category: 'No Logging', description: `${noLogPolicies.length} enabled rule(s) without logging`, policies: noLogPolicies, recommendation: 'Enable logging for traffic visibility and compliance' });
        if (lowHit.length > 0)
          findings.push({ severity: 'low', category: 'Low Usage', description: `${lowHit.length} rule(s) with very few hits (< 100)`, policies: lowHit, recommendation: 'Review if these rules are still needed' });
        if (duplicateCandidates.length > 0)
          findings.push({ severity: 'medium', category: 'Potential Duplicates', description: `${duplicateCandidates.length} pair(s) of rules with identical match criteria`, policies: duplicateCandidates.flat(), recommendation: 'Consolidate duplicate rules to simplify policy' });
        if (denyAllPolicies.length > 0)
          findings.push({ severity: 'info', category: 'Deny-All Rules', description: `${denyAllPolicies.length} explicit deny-all rule(s) found`, policies: denyAllPolicies, recommendation: 'This is good practice. Ensure these are at the bottom of the policy list' });

        const totalIssues = findings.filter((f) => f.severity !== 'info').reduce((s, f) => s + f.policies.length, 0);
        const score = scopedPolicies.length > 0 ? Math.max(0, Math.round(100 - (totalIssues / scopedPolicies.length) * 60)) : 100;

        const sevColors: Record<string, string> = {
          critical: 'text-red-400 bg-red-400/10 border-red-400/20',
          high: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
          medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
          low: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
          info: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
        };
        const sevIcons: Record<string, React.ReactNode> = {
          critical: <XCircle className="w-4 h-4 text-red-400" />,
          high: <AlertTriangle className="w-4 h-4 text-orange-400" />,
          medium: <AlertTriangle className="w-4 h-4 text-amber-400" />,
          low: <TrendingDown className="w-4 h-4 text-blue-400" />,
          info: <CheckCircle2 className="w-4 h-4 text-slate-400" />,
        };

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="glass-card p-4 text-center">
                <div className="relative w-16 h-16 mx-auto mb-2">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#1e293b" strokeWidth="3" />
                    <circle cx="18" cy="18" r="16" fill="none"
                      stroke={score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171'}
                      strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={`${score} ${100 - score}`} />
                  </svg>
                  <span className={clsx('absolute inset-0 flex items-center justify-center text-lg font-bold',
                    score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400')}>
                    {score}
                  </span>
                </div>
                <p className="text-xs text-slate-400">Policy Score</p>
              </div>
              <div className="glass-card p-4 flex items-center gap-3">
                <div className="p-2 bg-primary-400/10 rounded-lg"><Layers className="w-4 h-4 text-primary-400" /></div>
                <div><p className="text-xl font-bold text-slate-100">{scopedPolicies.length}</p><p className="text-xs text-slate-400">Total Rules</p></div>
              </div>
              <div className="glass-card p-4 flex items-center gap-3">
                <div className="p-2 bg-red-400/10 rounded-lg"><XCircle className="w-4 h-4 text-red-400" /></div>
                <div><p className="text-xl font-bold text-red-400">{zeroHit.length}</p><p className="text-xs text-slate-400">Zero-Hit</p></div>
              </div>
              <div className="glass-card p-4 flex items-center gap-3">
                <div className="p-2 bg-amber-400/10 rounded-lg"><ToggleLeft className="w-4 h-4 text-amber-400" /></div>
                <div><p className="text-xl font-bold text-amber-400">{disabledPolicies.length}</p><p className="text-xs text-slate-400">Disabled</p></div>
              </div>
              <div className="glass-card p-4 flex items-center gap-3">
                <div className="p-2 bg-orange-400/10 rounded-lg"><AlertTriangle className="w-4 h-4 text-orange-400" /></div>
                <div><p className="text-xl font-bold text-orange-400">{findings.filter((f) => f.severity !== 'info').length}</p><p className="text-xs text-slate-400">Findings</p></div>
              </div>
            </div>

            <div className="space-y-3">
              {findings.map((finding, idx) => (
                <div key={idx} className={clsx('glass-card overflow-hidden border-l-2', finding.severity === 'critical' ? 'border-l-red-500' : finding.severity === 'high' ? 'border-l-orange-500' : finding.severity === 'medium' ? 'border-l-amber-500' : finding.severity === 'low' ? 'border-l-blue-500' : 'border-l-slate-500')}>
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      {sevIcons[finding.severity]}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={clsx('text-[10px] uppercase font-bold px-2 py-0.5 rounded border', sevColors[finding.severity])}>{finding.severity}</span>
                          <span className="text-xs font-semibold text-slate-200">{finding.category}</span>
                        </div>
                        <p className="text-xs text-slate-300">{finding.description}</p>
                        <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                          <Layers className="w-3 h-3" /> Recommendation: {finding.recommendation}
                        </p>
                      </div>
                    </div>
                    {finding.policies.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-dark-700 text-left">
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase">ID</th>
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase">Name</th>
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase">Action</th>
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase">Source</th>
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase">Destination</th>
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase">Service</th>
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase text-right">Hit Count</th>
                            </tr>
                          </thead>
                          <tbody>
                            {finding.policies.slice(0, 10).map((p) => (
                              <tr key={`${p.device_id}-${p.id}`} className="border-b border-dark-700/30 hover:bg-dark-800/30">
                                <td className="px-2 py-1.5 text-slate-500 font-mono">{p.id}</td>
                                <td className="px-2 py-1.5 text-slate-200">{p.name}</td>
                                <td className="px-2 py-1.5">
                                  <span className={clsx('px-1.5 py-0.5 rounded text-[10px] border',
                                    p.action === 'accept' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' :
                                    'text-red-400 bg-red-400/10 border-red-400/30')}>{p.action}</span>
                                </td>
                                <td className="px-2 py-1.5 text-slate-300 font-mono">{p.source_address}</td>
                                <td className="px-2 py-1.5 text-slate-300 font-mono">{p.dest_address}</td>
                                <td className="px-2 py-1.5 text-slate-300">{p.service}</td>
                                <td className="px-2 py-1.5 text-slate-300 font-mono text-right">{p.hit_count.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {findings.length === 0 && (
                <div className="glass-card p-12 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                  <p className="text-lg font-medium text-slate-200">No audit findings</p>
                  <p className="text-sm text-slate-400 mt-1">All policies look clean</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {selectedPolicy && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md z-50 animate-slide-in-right">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedPolicy(null)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-dark-800 border-l border-dark-700 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-dark-800/95 backdrop-blur-sm border-b border-dark-700 px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary-400" />
                <h3 className="font-semibold text-slate-100">Policy #{selectedPolicy.id}</h3>
              </div>
              <button onClick={() => setSelectedPolicy(null)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-dark-700 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <h4 className="text-lg font-bold text-slate-100">{selectedPolicy.name}</h4>
                <p className="text-sm text-slate-400 mt-1">{selectedPolicy.comments}</p>
              </div>

              <div className="flex items-center gap-3">
                <span className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-sm border',
                  selectedPolicy.action === 'accept' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' :
                  'text-red-400 bg-red-400/10 border-red-400/30'
                )}>
                  {selectedPolicy.action === 'accept' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {selectedPolicy.action.toUpperCase()}
                </span>
                {selectedPolicy.status === 'enabled' ? (
                  <span className="inline-flex items-center gap-1 text-sm text-emerald-400"><ToggleRight className="w-5 h-5" /> Enabled</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm text-slate-400"><ToggleLeft className="w-5 h-5" /> Disabled</span>
                )}
              </div>

              <div className="space-y-3">
                {[
                  { label: 'Source Interface', value: selectedPolicy.source_interface },
                  { label: 'Destination Interface', value: selectedPolicy.dest_interface },
                  { label: 'Source Address', value: selectedPolicy.source_address },
                  { label: 'Destination Address', value: selectedPolicy.dest_address },
                  { label: 'Service', value: selectedPolicy.service },
                  { label: 'Schedule', value: selectedPolicy.schedule },
                  { label: 'NAT', value: selectedPolicy.nat ? 'Enabled' : 'Disabled' },
                  { label: 'Logging', value: selectedPolicy.log ? 'All Sessions' : 'Disabled' },
                  { label: 'Hit Count', value: selectedPolicy.hit_count.toLocaleString() },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-center bg-dark-900/50 rounded-lg px-4 py-2.5">
                    <span className="text-xs text-slate-500">{item.label}</span>
                    <span className="text-sm text-slate-200 font-mono">{item.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-dark-900/50 rounded-lg p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Traffic Flow</p>
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex-1 bg-dark-800 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-500">Source</p>
                    <p className="text-xs text-slate-200 font-mono mt-0.5">{selectedPolicy.source_address}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{selectedPolicy.source_interface}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-primary-400 shrink-0" />
                  <div className="flex-1 bg-dark-800 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-slate-500">Destination</p>
                    <p className="text-xs text-slate-200 font-mono mt-0.5">{selectedPolicy.dest_address}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{selectedPolicy.dest_interface}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
