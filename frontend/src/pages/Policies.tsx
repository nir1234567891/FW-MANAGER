import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Shield, Search, ChevronRight, X, CheckCircle2, XCircle, Ban,
  ToggleLeft, ToggleRight, Plus, AlertTriangle,
  TrendingDown, Layers, RefreshCw, Loader2, Download,
  Send, ChevronDown, Cpu,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useScope } from '@/hooks/useScope';
import { deviceService, policyService, objectService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';
import { useToast } from '@/components/Toast';

interface LocalPolicy {
  id: number;
  device_id: string;
  vdom: string;
  name: string;
  source_interface: string;
  dest_interface: string;
  source_address: string;
  dest_address: string;
  service: string;
  action: string;
  nat: boolean;
  log: boolean;
  status: string;
  hit_count: number;
  schedule: string;
  comments: string;
}

type ObjectKind = 'address' | 'service' | 'address-group' | 'service-group';

interface FirewallObject {
  name: string;
  kind: ObjectKind;
  value: string;
  comment: string;
}

interface DeviceInfo {
  id: string;
  name: string;
  vdoms: string[];
}

const smartTabs: { key: 'policies' | 'objects' | 'audit'; label: string; icon: React.ElementType }[] = [
  { key: 'policies', label: 'Policies', icon: Shield },
  { key: 'objects', label: 'Objects', icon: Layers },
  { key: 'audit', label: 'Policy Audit', icon: AlertTriangle },
];

function validateSubnet(v: string): string | null {
  v = v.trim();
  if (!v) return 'Subnet is required';
  if (v.includes('/')) {
    const [ip, prefix] = v.split('/');
    if (!isValidIp(ip)) return `Invalid IP address: ${ip}`;
    const p = parseInt(prefix, 10);
    if (isNaN(p) || p < 0 || p > 32) return `Invalid prefix length: ${prefix}`;
    return null;
  }
  const parts = v.split(/\s+/);
  if (parts.length === 2) {
    if (!isValidIp(parts[0])) return `Invalid IP: ${parts[0]}`;
    if (!isValidIp(parts[1])) return `Invalid mask: ${parts[1]}`;
    return null;
  }
  if (isValidIp(v)) return null;
  return 'Use CIDR (10.0.0.0/24) or IP MASK (10.0.0.0 255.255.255.0)';
}

function isValidIp(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

function validateFqdn(v: string): string | null {
  v = v.trim();
  if (!v) return 'FQDN is required';
  if (!/^[a-zA-Z0-9*]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(v)) return 'Invalid FQDN format';
  return null;
}

function validatePort(v: string): string | null {
  v = v.trim();
  if (!v) return null;
  for (const part of v.split(/\s+/)) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-');
      if (!lo || !hi || isNaN(+lo) || isNaN(+hi) || +lo < 1 || +hi > 65535 || +lo > +hi) return `Invalid port range: ${part}`;
    } else {
      if (isNaN(+part) || +part < 1 || +part > 65535) return `Invalid port: ${part}`;
    }
  }
  return null;
}

export default function Policies() {
  const { scope, setDeviceId: setGlobalDeviceId, setVdom: setGlobalVdom } = useScope();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'policies' | 'objects' | 'audit'>('policies');
  const [devices, setDevicesState] = useState<DeviceInfo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [policies, setPolicies] = useState<LocalPolicy[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(scope.deviceId === 'all' ? '' : scope.deviceId);
  const [selectedVdom, setSelectedVdom] = useState(scope.vdom === 'all' ? '' : scope.vdom);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPolicy, setSelectedPolicy] = useState<LocalPolicy | null>(null);

  // Objects tab state
  const [objectSearch, setObjectSearch] = useState('');
  const [objectFilter, setObjectFilter] = useState<ObjectKind | 'all'>('all');
  const [objects, setObjects] = useState<FirewallObject[]>([]);
  const [loadingObjects, setLoadingObjects] = useState(false);

  // Create address form
  const [newObjType, setNewObjType] = useState<'address' | 'service'>('address');
  const [addrName, setAddrName] = useState('');
  const [addrType, setAddrType] = useState<'ipmask' | 'iprange' | 'fqdn'>('ipmask');
  const [addrSubnet, setAddrSubnet] = useState('');
  const [addrStartIp, setAddrStartIp] = useState('');
  const [addrEndIp, setAddrEndIp] = useState('');
  const [addrFqdn, setAddrFqdn] = useState('');
  const [addrComment, setAddrComment] = useState('');
  // Create service form
  const [svcName, setSvcName] = useState('');
  const [svcTcp, setSvcTcp] = useState('');
  const [svcUdp, setSvcUdp] = useState('');
  const [svcComment, setSvcComment] = useState('');
  const [creating, setCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Multi-FW push state
  const [pushToMany, setPushToMany] = useState(false);
  // key = "deviceId::vdom"
  const [pushTargets, setPushTargets] = useState<Set<string>>(new Set());
  const [pushResultsOpen, setPushResultsOpen] = useState(false);
  const [pushResults, setPushResults] = useState<{ device_name: string; vdom: string; success: boolean; error?: string }[]>([]);
  const [pushSummary, setPushSummary] = useState('');

  // Load real devices
  useEffect(() => {
    deviceService.getAll()
      .then((res) => {
        const list = res.data as any[];
        if (Array.isArray(list) && list.length > 0) {
          const mapped: DeviceInfo[] = list.map((d: any) => {
            const dev = mapBackendDevice(d);
            return {
              id: dev.id,
              name: dev.name,
              vdoms: Array.isArray(d.vdom_list) && d.vdom_list.length > 0 ? d.vdom_list as string[] : ['root'],
            };
          });
          setDevicesState(mapped);
          if (!selectedDeviceId && mapped.length > 0) {
            setSelectedDeviceId(mapped[0].id);
            setSelectedVdom(mapped[0].vdoms[0] || 'root');
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load policies when device/vdom changes
  const loadPolicies = useCallback(async () => {
    if (!selectedDeviceId) return;
    setLoadingPolicies(true);
    try {
      const vdom = selectedVdom || undefined;
      const res = await policyService.getByDevice(selectedDeviceId, vdom);
      const data = res.data as any;
      const raw = data?.policies ?? data;
      if (Array.isArray(raw)) {
        const mapped: LocalPolicy[] = raw.map((p: any) => ({
          id: p.policyid ?? p.policy_id ?? p.id ?? 0,
          device_id: String(data?.device_id ?? selectedDeviceId),
          vdom: data?.vdom_name || selectedVdom || 'root',
          name: p.name || '',
          source_interface: p.srcintf || '',
          dest_interface: p.dstintf || '',
          source_address: p.srcaddr || '',
          dest_address: p.dstaddr || '',
          service: p.service || 'ALL',
          action: p.action || 'accept',
          nat: p.nat === 'enable' || p.nat === true,
          log: p.logtraffic !== 'disable',
          status: p.status === 'enable' || p.status === 'enabled' ? 'enabled' : 'disabled',
          hit_count: p.hit_count || 0,
          schedule: p.schedule || 'always',
          comments: p.comments || '',
        }));
        setPolicies(mapped);
      } else {
        setPolicies([]);
      }
    } catch {
      setPolicies([]);
    } finally {
      setLoadingPolicies(false);
    }
  }, [selectedDeviceId, selectedVdom]);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  // Load objects when device/vdom changes (for objects tab)
  const loadObjects = useCallback(async () => {
    if (!selectedDeviceId) return;
    setLoadingObjects(true);
    try {
      const vdom = selectedVdom || undefined;
      const [addrRes, svcRes, addrGrpRes, svcGrpRes] = await Promise.allSettled([
        objectService.getAddresses(selectedDeviceId, vdom),
        objectService.getServices(selectedDeviceId, vdom),
        objectService.getAddressGroups(selectedDeviceId, vdom),
        objectService.getServiceGroups(selectedDeviceId, vdom),
      ]);

      const items: FirewallObject[] = [];

      if (addrRes.status === 'fulfilled') {
        const addrs = (addrRes.value.data as any)?.addresses || [];
        for (const a of addrs) {
          let value = '';
          if (a.type === 'ipmask') value = a.subnet || '';
          else if (a.type === 'iprange') value = `${a.start_ip} - ${a.end_ip}`;
          else if (a.type === 'fqdn') value = a.fqdn || '';
          else value = a.type || '';
          items.push({ name: a.name, kind: 'address', value, comment: a.comment || '' });
        }
      }
      if (svcRes.status === 'fulfilled') {
        const svcs = (svcRes.value.data as any)?.services || [];
        for (const s of svcs) {
          const ports = [s.tcp_portrange && `TCP/${s.tcp_portrange}`, s.udp_portrange && `UDP/${s.udp_portrange}`].filter(Boolean).join(', ');
          items.push({ name: s.name, kind: 'service', value: ports || s.protocol || '', comment: s.comment || '' });
        }
      }
      if (addrGrpRes.status === 'fulfilled') {
        const grps = (addrGrpRes.value.data as any)?.groups || [];
        for (const g of grps) {
          items.push({ name: g.name, kind: 'address-group', value: (g.member || []).join(', '), comment: g.comment || '' });
        }
      }
      if (svcGrpRes.status === 'fulfilled') {
        const grps = (svcGrpRes.value.data as any)?.groups || [];
        for (const g of grps) {
          items.push({ name: g.name, kind: 'service-group', value: (g.member || []).join(', '), comment: g.comment || '' });
        }
      }

      setObjects(items);
    } catch {
      setObjects([]);
    } finally {
      setLoadingObjects(false);
    }
  }, [selectedDeviceId, selectedVdom]);

  useEffect(() => {
    if (activeTab === 'objects') loadObjects();
  }, [activeTab, loadObjects]);

  useEffect(() => {
    if (scope.deviceId !== 'all') setSelectedDeviceId(scope.deviceId);
    if (scope.vdom !== 'all') setSelectedVdom(scope.vdom);
  }, [scope.deviceId, scope.vdom]);

  const currentDevice = devices.find((d) => d.id === selectedDeviceId);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return policies.filter((p) => {
      return p.name.toLowerCase().includes(q) ||
        p.source_address.toLowerCase().includes(q) ||
        p.dest_address.toLowerCase().includes(q) ||
        p.service.toLowerCase().includes(q);
    });
  }, [policies, searchQuery]);

  const totalAccept = filtered.filter((p) => p.action === 'accept').length;
  const totalDeny = filtered.filter((p) => p.action === 'deny').length;
  const totalDisabled = filtered.filter((p) => p.status === 'disabled').length;

  const visibleObjects = useMemo(() => {
    const q = objectSearch.toLowerCase();
    return objects.filter((o) => {
      const textMatch = o.name.toLowerCase().includes(q) || o.kind.toLowerCase().includes(q) || o.value.toLowerCase().includes(q);
      const kindMatch = objectFilter === 'all' || o.kind === objectFilter;
      return textMatch && kindMatch;
    });
  }, [objectSearch, objects, objectFilter]);

  const handleSync = async () => {
    if (!selectedDeviceId) {
      addToast('warning', 'Select a device to sync');
      return;
    }
    setSyncing(true);
    try {
      const vdom = selectedVdom || undefined;
      const res = await policyService.sync(selectedDeviceId, vdom);
      const data = res.data as any;
      addToast('success', data?.message || 'Policies synced successfully');
      await loadPolicies();
    } catch {
      addToast('error', 'Failed to sync policies from FortiGate');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAllVdoms = async () => {
    if (!selectedDeviceId) {
      addToast('warning', 'Select a device');
      return;
    }
    setSyncing(true);
    try {
      const res = await policyService.syncAllVdoms(selectedDeviceId);
      const data = res.data as any;
      addToast('success', data?.message || 'All VDOMs synced');
      await loadPolicies();
    } catch {
      addToast('error', 'Failed to sync all VDOMs');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateObject = async () => {
    if (!selectedDeviceId) {
      addToast('warning', 'Select a device first');
      return;
    }
    setFormErrors({});
    const errors: Record<string, string> = {};

    if (newObjType === 'address') {
      if (!addrName.trim()) errors.addrName = 'Name is required';
      else if (!/^[A-Za-z0-9_. -]+$/.test(addrName)) errors.addrName = 'Only letters, numbers, dots, hyphens, underscores, spaces';

      if (addrType === 'ipmask') {
        const err = validateSubnet(addrSubnet);
        if (err) errors.addrSubnet = err;
      } else if (addrType === 'iprange') {
        if (!isValidIp(addrStartIp.trim())) errors.addrStartIp = 'Invalid IP';
        if (!isValidIp(addrEndIp.trim())) errors.addrEndIp = 'Invalid IP';
      } else if (addrType === 'fqdn') {
        const err = validateFqdn(addrFqdn);
        if (err) errors.addrFqdn = err;
      }

      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        return;
      }

      setCreating(true);
      try {
        const payload: Record<string, unknown> = {
          name: addrName.trim(),
          type: addrType,
          comment: addrComment.trim(),
        };
        if (addrType === 'ipmask') payload.subnet = addrSubnet.trim();
        else if (addrType === 'iprange') { payload['start-ip'] = addrStartIp.trim(); payload['end-ip'] = addrEndIp.trim(); }
        else if (addrType === 'fqdn') payload.fqdn = addrFqdn.trim();

        const vdom = selectedVdom || undefined;
        const res = await objectService.createAddress(selectedDeviceId, payload, vdom);
        const data = res.data as any;
        addToast('success', data?.message || 'Address created');
        setAddrName(''); setAddrSubnet(''); setAddrStartIp(''); setAddrEndIp(''); setAddrFqdn(''); setAddrComment('');
        await loadObjects();
      } catch (err: any) {
        const detail = err?.response?.data?.detail || 'Failed to create address';
        addToast('error', typeof detail === 'string' ? detail : JSON.stringify(detail));
      } finally {
        setCreating(false);
      }
    } else {
      if (!svcName.trim()) errors.svcName = 'Name is required';
      else if (!/^[A-Za-z0-9_. -]+$/.test(svcName)) errors.svcName = 'Only letters, numbers, dots, hyphens, underscores, spaces';
      const tcpErr = validatePort(svcTcp);
      if (tcpErr) errors.svcTcp = tcpErr;
      const udpErr = validatePort(svcUdp);
      if (udpErr) errors.svcUdp = udpErr;
      if (!svcTcp.trim() && !svcUdp.trim()) errors.svcTcp = 'At least one port range is required';

      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        return;
      }

      setCreating(true);
      try {
        const payload: Record<string, unknown> = {
          name: svcName.trim(),
          comment: svcComment.trim(),
        };
        if (svcTcp.trim()) payload['tcp-portrange'] = svcTcp.trim();
        if (svcUdp.trim()) payload['udp-portrange'] = svcUdp.trim();

        const vdom = selectedVdom || undefined;
        const res = await objectService.createService(selectedDeviceId, payload, vdom);
        const data = res.data as any;
        addToast('success', data?.message || 'Service created');
        setSvcName(''); setSvcTcp(''); setSvcUdp(''); setSvcComment('');
        await loadObjects();
      } catch (err: any) {
        const detail = err?.response?.data?.detail || 'Failed to create service';
        addToast('error', typeof detail === 'string' ? detail : JSON.stringify(detail));
      } finally {
        setCreating(false);
      }
    }
  };

  // Toggle a device/vdom combination in the multi-push target set
  const togglePushTarget = (deviceId: string, vdom: string) => {
    const key = `${deviceId}::${vdom}`;
    setPushTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePushToMany = async () => {
    if (pushTargets.size === 0) {
      addToast('warning', 'Select at least one target firewall');
      return;
    }
    setFormErrors({});
    const errors: Record<string, string> = {};

    // Build targets list
    const targets = Array.from(pushTargets).map((key) => {
      const [dId, vdom] = key.split('::');
      return { device_id: parseInt(dId, 10), vdom };
    });

    if (newObjType === 'address') {
      if (!addrName.trim()) errors.addrName = 'Name is required';
      else if (!/^[A-Za-z0-9_. -]+$/.test(addrName)) errors.addrName = 'Only letters, numbers, dots, hyphens, underscores, spaces';
      if (addrType === 'ipmask') { const e = validateSubnet(addrSubnet); if (e) errors.addrSubnet = e; }
      else if (addrType === 'iprange') {
        if (!isValidIp(addrStartIp.trim())) errors.addrStartIp = 'Invalid IP';
        if (!isValidIp(addrEndIp.trim())) errors.addrEndIp = 'Invalid IP';
      } else if (addrType === 'fqdn') { const e = validateFqdn(addrFqdn); if (e) errors.addrFqdn = e; }
      if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

      setCreating(true);
      try {
        const payload: Record<string, unknown> = { name: addrName.trim(), type: addrType, comment: addrComment.trim() };
        if (addrType === 'ipmask') payload.subnet = addrSubnet.trim();
        else if (addrType === 'iprange') { payload['start-ip'] = addrStartIp.trim(); payload['end-ip'] = addrEndIp.trim(); }
        else if (addrType === 'fqdn') payload.fqdn = addrFqdn.trim();

        const res = await objectService.pushAddressToMany(payload, targets);
        const data = res.data as any;
        setPushResults(data.results || []);
        setPushSummary(data.message || '');
        setPushResultsOpen(true);
        addToast('success', data.message || 'Push complete');
        setAddrName(''); setAddrSubnet(''); setAddrStartIp(''); setAddrEndIp(''); setAddrFqdn(''); setAddrComment('');
      } catch (err: any) {
        const detail = err?.response?.data?.detail || 'Push failed';
        addToast('error', typeof detail === 'string' ? detail : JSON.stringify(detail));
      } finally {
        setCreating(false);
      }
    } else {
      if (!svcName.trim()) errors.svcName = 'Name is required';
      else if (!/^[A-Za-z0-9_. -]+$/.test(svcName)) errors.svcName = 'Only letters, numbers, dots, hyphens, underscores, spaces';
      const tcpErr = validatePort(svcTcp); if (tcpErr) errors.svcTcp = tcpErr;
      const udpErr = validatePort(svcUdp); if (udpErr) errors.svcUdp = udpErr;
      if (!svcTcp.trim() && !svcUdp.trim()) errors.svcTcp = 'At least one port range is required';
      if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

      setCreating(true);
      try {
        const payload: Record<string, unknown> = { name: svcName.trim(), comment: svcComment.trim() };
        if (svcTcp.trim()) payload['tcp-portrange'] = svcTcp.trim();
        if (svcUdp.trim()) payload['udp-portrange'] = svcUdp.trim();

        const res = await objectService.pushServiceToMany(payload, targets);
        const data = res.data as any;
        setPushResults(data.results || []);
        setPushSummary(data.message || '');
        setPushResultsOpen(true);
        addToast('success', data.message || 'Push complete');
        setSvcName(''); setSvcTcp(''); setSvcUdp(''); setSvcComment('');
      } catch (err: any) {
        const detail = err?.response?.data?.detail || 'Push failed';
        addToast('error', typeof detail === 'string' ? detail : JSON.stringify(detail));
      } finally {
        setCreating(false);
      }
    }
  };

  const kindColors: Record<string, string> = {
    address: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
    service: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
    'address-group': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
    'service-group': 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-dark-800/50 rounded-lg border border-dark-700 p-1">
          {smartTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                  activeTab === tab.key
                    ? 'bg-primary-500/15 text-primary-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-dark-700/50'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'policies' && (
            <>
              <button onClick={handleSync} disabled={syncing || !selectedDeviceId} className="btn-secondary text-sm">
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Sync VDOM
              </button>
              <button onClick={handleSyncAllVdoms} disabled={syncing || !selectedDeviceId} className="btn-secondary text-sm">
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Sync All VDOMs
              </button>
            </>
          )}
          {activeTab === 'objects' && (
            <button onClick={loadObjects} disabled={loadingObjects || !selectedDeviceId} className="btn-secondary text-sm">
              {loadingObjects ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedDeviceId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedDeviceId(id);
              setGlobalDeviceId(id);
              const dev = devices.find((d) => d.id === id);
              const firstVdom = dev?.vdoms[0] || 'root';
              setSelectedVdom(firstVdom);
              setGlobalVdom(firstVdom);
            }}
            className="input-dark w-auto text-sm"
          >
            {devices.length === 0 && <option value="">Loading...</option>}
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
            {currentDevice?.vdoms.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={activeTab === 'policies' ? searchQuery : objectSearch}
              onChange={(e) => {
                if (activeTab === 'policies') setSearchQuery(e.target.value);
                else setObjectSearch(e.target.value);
              }}
              placeholder={activeTab === 'policies' ? 'Search policies...' : 'Search objects...'}
              className="input-dark pl-9"
            />
          </div>
          {activeTab === 'objects' && (
            <select value={objectFilter} onChange={(e) => setObjectFilter(e.target.value as ObjectKind | 'all')} className="input-dark w-auto text-sm">
              <option value="all">All Types</option>
              <option value="address">Addresses</option>
              <option value="service">Services</option>
              <option value="address-group">Address Groups</option>
              <option value="service-group">Service Groups</option>
            </select>
          )}
        </div>
      </div>

      {/* POLICIES TAB */}
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
            {loadingPolicies ? (
              <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Loading policies...</span>
              </div>
            ) : (
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
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((policy) => (
                      <tr
                        key={`${policy.device_id}-${policy.id}`}
                        className={clsx('border-b border-dark-700/50 table-row-hover cursor-pointer', policy.status === 'disabled' && 'opacity-50')}
                        onClick={() => setSelectedPolicy(policy)}
                      >
                        <td className="px-3 py-2.5 text-slate-500 font-mono text-xs">{policy.id}</td>
                        <td className="px-3 py-2.5"><span className="font-medium text-slate-200">{policy.name}</span></td>
                        <td className="px-3 py-2.5 text-xs text-slate-300 font-mono">{policy.source_interface}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-300 font-mono">{policy.dest_interface}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-300">{policy.source_address}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-300">{policy.dest_address}</td>
                        <td className="px-3 py-2.5"><span className="text-xs px-1.5 py-0.5 bg-dark-700 rounded text-slate-300">{policy.service}</span></td>
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
                          {policy.status === 'enabled' ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5 text-slate-500" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loadingPolicies && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Shield className="w-12 h-12 mb-3 text-slate-600" />
                <p className="text-lg font-medium">No policies found</p>
                <p className="text-sm mt-1">Click "Sync VDOM" to fetch policies from FortiGate</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* OBJECTS TAB */}
      {activeTab === 'objects' && (
        <div className="space-y-4">
          {/* Create Object Form */}
          <div className="glass-card p-4 space-y-3">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-sm font-semibold text-slate-200">Create New Object</h3>
              <div className="flex items-center gap-1 bg-dark-900 rounded-lg p-0.5">
                <button onClick={() => { setNewObjType('address'); setFormErrors({}); }} className={clsx('px-3 py-1 text-xs rounded-md', newObjType === 'address' ? 'bg-primary-500/20 text-primary-400' : 'text-slate-400')}>Address</button>
                <button onClick={() => { setNewObjType('service'); setFormErrors({}); }} className={clsx('px-3 py-1 text-xs rounded-md', newObjType === 'service' ? 'bg-primary-500/20 text-primary-400' : 'text-slate-400')}>Service</button>
              </div>
              <span className="ml-auto text-xs text-slate-500">
                Target: {currentDevice?.name || '—'} / {selectedVdom || 'root'}
              </span>
            </div>

            {newObjType === 'address' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <input value={addrName} onChange={(e) => setAddrName(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.addrName && 'border-red-500')} placeholder="Object name (e.g. HR_SUBNET)" />
                  {formErrors.addrName && <p className="text-red-400 text-xs mt-1">{formErrors.addrName}</p>}
                </div>
                <select value={addrType} onChange={(e) => setAddrType(e.target.value as any)} className="input-dark text-sm">
                  <option value="ipmask">IP/Mask (Subnet)</option>
                  <option value="iprange">IP Range</option>
                  <option value="fqdn">FQDN</option>
                </select>
                {addrType === 'ipmask' && (
                  <div className="md:col-span-2">
                    <input value={addrSubnet} onChange={(e) => setAddrSubnet(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.addrSubnet && 'border-red-500')} placeholder="Subnet (e.g. 10.0.0.0/24 or 10.0.0.0 255.255.255.0)" />
                    {formErrors.addrSubnet && <p className="text-red-400 text-xs mt-1">{formErrors.addrSubnet}</p>}
                  </div>
                )}
                {addrType === 'iprange' && (
                  <>
                    <div>
                      <input value={addrStartIp} onChange={(e) => setAddrStartIp(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.addrStartIp && 'border-red-500')} placeholder="Start IP (e.g. 10.0.0.1)" />
                      {formErrors.addrStartIp && <p className="text-red-400 text-xs mt-1">{formErrors.addrStartIp}</p>}
                    </div>
                    <div>
                      <input value={addrEndIp} onChange={(e) => setAddrEndIp(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.addrEndIp && 'border-red-500')} placeholder="End IP (e.g. 10.0.0.254)" />
                      {formErrors.addrEndIp && <p className="text-red-400 text-xs mt-1">{formErrors.addrEndIp}</p>}
                    </div>
                  </>
                )}
                {addrType === 'fqdn' && (
                  <div className="md:col-span-2">
                    <input value={addrFqdn} onChange={(e) => setAddrFqdn(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.addrFqdn && 'border-red-500')} placeholder="FQDN (e.g. *.google.com)" />
                    {formErrors.addrFqdn && <p className="text-red-400 text-xs mt-1">{formErrors.addrFqdn}</p>}
                  </div>
                )}
                <input value={addrComment} onChange={(e) => setAddrComment(e.target.value)} className="input-dark text-sm md:col-span-2" placeholder="Comment (optional)" />
              </div>
            )}

            {newObjType === 'service' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <input value={svcName} onChange={(e) => setSvcName(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.svcName && 'border-red-500')} placeholder="Service name (e.g. MY_WEB)" />
                  {formErrors.svcName && <p className="text-red-400 text-xs mt-1">{formErrors.svcName}</p>}
                </div>
                <div>
                  <input value={svcTcp} onChange={(e) => setSvcTcp(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.svcTcp && 'border-red-500')} placeholder="TCP ports (e.g. 80 443 8080-8090)" />
                  {formErrors.svcTcp && <p className="text-red-400 text-xs mt-1">{formErrors.svcTcp}</p>}
                </div>
                <div>
                  <input value={svcUdp} onChange={(e) => setSvcUdp(e.target.value)} className={clsx('input-dark text-sm w-full', formErrors.svcUdp && 'border-red-500')} placeholder="UDP ports (e.g. 53 123)" />
                  {formErrors.svcUdp && <p className="text-red-400 text-xs mt-1">{formErrors.svcUdp}</p>}
                </div>
                <input value={svcComment} onChange={(e) => setSvcComment(e.target.value)} className="input-dark text-sm" placeholder="Comment (optional)" />
              </div>
            )}

            {/* Multi-FW push toggle */}
            <div className="border-t border-dark-700 pt-3 mt-1">
              <button
                type="button"
                onClick={() => { setPushToMany((v) => !v); setPushTargets(new Set()); }}
                className={clsx(
                  'flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all',
                  pushToMany
                    ? 'text-amber-400 bg-amber-400/10 border-amber-400/30'
                    : 'text-slate-400 bg-dark-800 border-dark-600 hover:border-dark-500'
                )}
              >
                <Send className="w-3.5 h-3.5" />
                {pushToMany ? 'Multi-FW Push: ON' : 'Push to multiple firewalls'}
                <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', pushToMany && 'rotate-180')} />
              </button>

              {pushToMany && (
                <div className="mt-3 p-3 bg-dark-900/60 rounded-lg border border-dark-700 space-y-2">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider mb-2">Select target firewalls</p>
                  {devices.map((dev) => (
                    <div key={dev.id} className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                        <Cpu className="w-3 h-3 text-primary-400" />
                        {dev.name}
                      </div>
                      <div className="ml-4 flex flex-wrap gap-1.5">
                        {dev.vdoms.map((vdom) => {
                          const key = `${dev.id}::${vdom}`;
                          const checked = pushTargets.has(key);
                          return (
                            <label key={key} className={clsx(
                              'flex items-center gap-1.5 px-2 py-1 rounded-md border cursor-pointer text-[11px] transition-all select-none',
                              checked
                                ? 'text-primary-400 bg-primary-400/10 border-primary-400/40'
                                : 'text-slate-400 bg-dark-800 border-dark-600 hover:border-dark-500'
                            )}>
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={checked}
                                onChange={() => togglePushTarget(dev.id, vdom)}
                              />
                              <span className={clsx('w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0',
                                checked ? 'bg-primary-500 border-primary-500' : 'border-slate-600'
                              )}>
                                {checked && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                              </span>
                              {vdom}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {pushTargets.size > 0 && (
                    <p className="text-[11px] text-amber-400 mt-1">{pushTargets.size} target{pushTargets.size > 1 ? 's' : ''} selected</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!pushToMany ? (
                <button onClick={handleCreateObject} disabled={creating || !selectedDeviceId} className="btn-primary text-sm">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create & Push to {currentDevice?.name || 'FW'} / {selectedVdom || 'root'}
                </button>
              ) : (
                <button onClick={handlePushToMany} disabled={creating || pushTargets.size === 0} className="btn-primary text-sm bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Push to {pushTargets.size || '?'} target{pushTargets.size !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>

          {/* Push Results Modal */}
          {pushResultsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60" onClick={() => setPushResultsOpen(false)} />
              <div className="relative bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-lg animate-fade-in overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-amber-400" />
                    <h3 className="font-semibold text-slate-100">Push Results</h3>
                  </div>
                  <button onClick={() => setPushResultsOpen(false)} className="p-1 text-slate-400 hover:text-slate-200 hover:bg-dark-700 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-sm text-slate-300">{pushSummary}</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {pushResults.map((r, i) => (
                      <div key={i} className={clsx(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg border',
                        r.success
                          ? 'bg-emerald-400/5 border-emerald-400/20'
                          : 'bg-red-400/5 border-red-400/20'
                      )}>
                        {r.success
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-200">{r.device_name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 bg-dark-700 rounded text-primary-400">{r.vdom}</span>
                          </div>
                          {!r.success && r.error && (
                            <p className="text-xs text-red-400 mt-0.5 truncate">{r.error}</p>
                          )}
                        </div>
                        <span className={clsx('text-[11px] font-bold', r.success ? 'text-emerald-400' : 'text-red-400')}>
                          {r.success ? 'OK' : 'FAILED'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-5 pb-4">
                  <button onClick={() => setPushResultsOpen(false)} className="btn-secondary text-sm w-full">Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Objects Table */}
          <div className="glass-card overflow-hidden">
            {loadingObjects ? (
              <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" /> Loading objects from FortiGate...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-700 text-left">
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Value</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleObjects.map((o, idx) => (
                      <tr key={`${o.kind}-${o.name}-${idx}`} className="border-b border-dark-700/50 table-row-hover">
                        <td className="px-3 py-2.5 text-slate-200 font-medium">{o.name}</td>
                        <td className="px-3 py-2.5">
                          <span className={clsx('px-2 py-0.5 text-[11px] rounded border', kindColors[o.kind] || 'text-slate-400 bg-slate-400/10 border-slate-400/30')}>
                            {o.kind}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-300 font-mono text-xs max-w-xs truncate">{o.value}</td>
                        <td className="px-3 py-2.5 text-slate-400 text-xs">{o.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loadingObjects && visibleObjects.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Layers className="w-12 h-12 mb-3 text-slate-600" />
                <p className="text-lg font-medium">No objects found</p>
                <p className="text-sm mt-1">Objects are loaded live from the selected FortiGate</p>
              </div>
            )}
            {!loadingObjects && objects.length > 0 && (
              <div className="px-3 py-2 border-t border-dark-700 text-xs text-slate-500">
                {objects.filter(o => o.kind === 'address').length} addresses, {objects.filter(o => o.kind === 'service').length} services, {objects.filter(o => o.kind === 'address-group').length} address groups, {objects.filter(o => o.kind === 'service-group').length} service groups
              </div>
            )}
          </div>
        </div>
      )}

      {/* AUDIT TAB */}
      {activeTab === 'audit' && (() => {
        const scopedPolicies = policies;
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
            if (a.source_interface === b.source_interface && a.dest_interface === b.dest_interface &&
              a.source_address === b.source_address && a.dest_address === b.dest_address && a.service === b.service)
              duplicateCandidates.push([a, b]);
          }
        }

        type AuditFinding = { severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; category: string; description: string; policies: LocalPolicy[]; recommendation: string };
        const findings: AuditFinding[] = [];
        if (broadPolicies.length > 0) findings.push({ severity: 'critical', category: 'Security Risk', description: `${broadPolicies.length} overly permissive rule(s)`, policies: broadPolicies, recommendation: 'Restrict source addresses and services' });
        if (zeroHit.length > 0) findings.push({ severity: 'high', category: 'Unused Rules', description: `${zeroHit.length} enabled rule(s) with zero hits`, policies: zeroHit, recommendation: 'Consider disabling or removing' });
        if (disabledPolicies.length > 0) findings.push({ severity: 'medium', category: 'Disabled Rules', description: `${disabledPolicies.length} disabled rule(s)`, policies: disabledPolicies, recommendation: 'Clean up disabled rules' });
        if (noLogPolicies.length > 0) findings.push({ severity: 'medium', category: 'No Logging', description: `${noLogPolicies.length} rule(s) without logging`, policies: noLogPolicies, recommendation: 'Enable logging' });
        if (lowHit.length > 0) findings.push({ severity: 'low', category: 'Low Usage', description: `${lowHit.length} rule(s) with < 100 hits`, policies: lowHit, recommendation: 'Review if still needed' });
        if (duplicateCandidates.length > 0) findings.push({ severity: 'medium', category: 'Potential Duplicates', description: `${duplicateCandidates.length} pair(s) with identical criteria`, policies: duplicateCandidates.flat(), recommendation: 'Consolidate duplicate rules' });
        if (denyAllPolicies.length > 0) findings.push({ severity: 'info', category: 'Deny-All Rules', description: `${denyAllPolicies.length} explicit deny-all rule(s)`, policies: denyAllPolicies, recommendation: 'Good practice — ensure at bottom' });

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

            {scopedPolicies.length === 0 && (
              <div className="glass-card p-12 text-center">
                <Shield className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-lg font-medium text-slate-300">No policies to audit</p>
                <p className="text-sm text-slate-400 mt-1">Sync policies first, then come back to audit</p>
              </div>
            )}

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
                        <p className="text-[10px] text-slate-500 mt-1">{finding.recommendation}</p>
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
                              <th className="px-2 py-1.5 text-[10px] text-slate-500 uppercase">Service</th>
                            </tr>
                          </thead>
                          <tbody>
                            {finding.policies.slice(0, 10).map((p, pi) => (
                              <tr key={`${p.device_id}-${p.id}-${pi}`} className="border-b border-dark-700/30 hover:bg-dark-800/30">
                                <td className="px-2 py-1.5 text-slate-500 font-mono">{p.id}</td>
                                <td className="px-2 py-1.5 text-slate-200">{p.name}</td>
                                <td className="px-2 py-1.5">
                                  <span className={clsx('px-1.5 py-0.5 rounded text-[10px] border',
                                    p.action === 'accept' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' : 'text-red-400 bg-red-400/10 border-red-400/30')}>{p.action}</span>
                                </td>
                                <td className="px-2 py-1.5 text-slate-300 font-mono">{p.source_address}</td>
                                <td className="px-2 py-1.5 text-slate-300">{p.service}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {findings.length === 0 && scopedPolicies.length > 0 && (
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

      {/* Policy Detail Slide-in */}
      {selectedPolicy && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md z-50 animate-slide-in-right">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedPolicy(null)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-dark-800 border-l border-dark-700 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-dark-800/95 backdrop-blur-sm border-b border-dark-700 px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary-400" />
                <h3 className="font-semibold text-slate-100">Policy #{selectedPolicy.id}</h3>
              </div>
              <button onClick={() => setSelectedPolicy(null)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-dark-700 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <h4 className="text-lg font-bold text-slate-100">{selectedPolicy.name}</h4>
                <p className="text-sm text-slate-400 mt-1">{selectedPolicy.comments}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-sm border',
                  selectedPolicy.action === 'accept' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' : 'text-red-400 bg-red-400/10 border-red-400/30'
                )}>
                  {selectedPolicy.action === 'accept' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {selectedPolicy.action.toUpperCase()}
                </span>
                {selectedPolicy.status === 'enabled' ? <span className="inline-flex items-center gap-1 text-sm text-emerald-400"><ToggleRight className="w-5 h-5" /> Enabled</span>
                  : <span className="inline-flex items-center gap-1 text-sm text-slate-400"><ToggleLeft className="w-5 h-5" /> Disabled</span>}
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
