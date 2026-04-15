import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from '@xyflow/react';
import {
  RefreshCw, LayoutTemplate, Shield, Wifi, WifiOff, Search,
  X, ArrowDownRight, ArrowUpRight, Lock, Key, Loader2,
  Network, Table2, Settings2,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import type { VPNTunnel } from '@/types';
import { clsx } from 'clsx';
import { useScope } from '@/hooks/useScope';
import { deviceService, tunnelService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';
import { useToast } from '@/components/Toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceNodeInfo {
  id: string;
  name: string;
  model: string;
  ip: string;
  status: 'online' | 'offline' | 'warning';
  role: string;
}

interface Phase1Entry {
  name: string;
  type: string;
  interface: string;
  'ike-version': string;
  'remote-gw': string;
  'local-gw': string;
  authmethod: string;
  proposal: string;
  dhgrp: string;
  nattraversal: string;
  dpd: string;
  keylife: number;
  comments: string;
}

interface Phase2Entry {
  name: string;
  phase1name: string;
  proposal: string;
  pfs: string;
  dhgrp: string;
  keylifeseconds: number;
  encapsulation: string;
  'src-subnet': string;
  'dst-subnet': string;
  comments: string;
}

// ---------------------------------------------------------------------------
// Smart Tab definition
// ---------------------------------------------------------------------------

const smartTabs = [
  { id: 'topology', label: 'Topology Map', icon: Network },
  { id: 'table', label: 'Tunnel Table', icon: Table2 },
  { id: 'ipsec', label: 'IPsec Config', icon: Settings2 },
] as const;
type TabId = (typeof smartTabs)[number]['id'];

// ---------------------------------------------------------------------------
// FortiGate Node Component (for ReactFlow)
// ---------------------------------------------------------------------------

function FortiGateNode({ data }: NodeProps) {
  const d = data as DeviceNodeInfo;
  const borderColor = d.status === 'online' ? 'border-emerald-500/30' : d.status === 'offline' ? 'border-red-500/30' : 'border-amber-500/30';
  const glowColor = d.status === 'online' ? 'shadow-emerald-500/10' : d.status === 'offline' ? 'shadow-red-500/10' : 'shadow-amber-500/10';

  return (
    <div className={clsx('bg-dark-800 border rounded-xl p-4 min-w-[180px] shadow-lg', borderColor, glowColor)}>
      <Handle type="target" position={Position.Top} id="top" className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-primary-400/10 rounded-lg">
          <Shield className="w-4 h-4 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{d.name}</p>
          <p className="text-[10px] text-slate-500">{d.role}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-slate-500">{d.model}</p>
          <p className="text-xs font-mono text-slate-400">{d.ip}</p>
        </div>
        <div className={clsx(
          'w-2.5 h-2.5 rounded-full',
          d.status === 'online' ? 'bg-emerald-400 animate-pulse-slow' : d.status === 'offline' ? 'bg-red-400' : 'bg-amber-400 animate-pulse-slow'
        )} />
      </div>
    </div>
  );
}

const nodeTypes = { fortigate: FortiGateNode };

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return 'N/A';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function TunnelMap() {
  const location = useLocation();
  const { scope } = useScope();
  const { addToast } = useToast();
  const routeDeviceId = (location.state as { selectedDeviceId?: string } | null)?.selectedDeviceId;
  const selectedDeviceId = routeDeviceId || (scope.deviceId === 'all' ? undefined : scope.deviceId);

  const [activeTab, setActiveTab] = useState<TabId>('topology');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTunnel, setSelectedTunnel] = useState<VPNTunnel | null>(null);
  const [deviceNodes, setDeviceNodes] = useState<DeviceNodeInfo[]>([]);
  const [tunnels, setTunnels] = useState<VPNTunnel[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // IPsec config state
  const [phase1List, setPhase1List] = useState<Phase1Entry[]>([]);
  const [phase2List, setPhase2List] = useState<Phase2Entry[]>([]);
  const [ipsecDevice, setIpsecDevice] = useState<string>('');
  const [ipsecLoading, setIpsecLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [devices, setDevices] = useState<any[]>([]);

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  const loadData = useCallback(async () => {
    const [devResult, tunnelResult] = await Promise.allSettled([
      deviceService.getAll(),
      tunnelService.getAll(),
    ]);

    if (devResult.status === 'fulfilled') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = devResult.value.data as any[];
      setDevices(list);
      if (Array.isArray(list) && list.length > 0) {
        setDeviceNodes(list.map((d) => {
          const dev = mapBackendDevice(d);
          return {
            id: dev.id,
            name: dev.name,
            model: dev.model,
            ip: dev.ip_address,
            status: dev.status as 'online' | 'offline' | 'warning',
            role: d.ha_status === 'active-passive' ? 'HA' : d.notes || 'Firewall',
          };
        }));
        if (!ipsecDevice) {
          setIpsecDevice(String(list[0].id));
        }
      }
    }

    if (tunnelResult.status === 'fulfilled') {
      const data = tunnelResult.value.data;
      const raw = Array.isArray(data) ? data : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTunnels(raw.map((t: any) => ({
        id: String(t.id),
        name: t.name || '',
        type: t.type || 'ipsec',
        status: t.status || 'down',
        source_device_id: String(t.source_device_id),
        source_device_name: t.source_device_name || '',
        dest_device_id: String(t.dest_device_id),
        dest_device_name: t.dest_device_name || '',
        source_ip: t.source_ip || '',
        dest_ip: t.dest_ip || '',
        local_subnet: t.local_subnet || '',
        remote_subnet: t.remote_subnet || '',
        incoming_bytes: t.incoming_bytes || 0,
        outgoing_bytes: t.outgoing_bytes || 0,
        phase1_status: t.phase1_status || 'down',
        phase2_status: t.phase2_status || 'down',
        uptime: t.uptime || 0,
        last_change: t.last_change || '',
        vdom_name: t.vdom_name || '',
      })));
    }

    setDataLoaded(true);
  }, [ipsecDevice]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await tunnelService.discover();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = res.data as any;
      addToast('success', `Discovery complete: ${result.tunnels_discovered ?? 0} new tunnels found across ${result.devices_scanned ?? 0} devices`);
      await loadData();
    } catch {
      addToast('error', 'Tunnel discovery failed');
    } finally {
      setDiscovering(false);
    }
  }, [loadData, addToast]);

  // Load IPsec Phase 1/2 config for selected device
  const loadIpsecConfig = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    setIpsecLoading(true);
    try {
      const [p1Res, p2Res] = await Promise.allSettled([
        tunnelService.getPhase1(deviceId),
        tunnelService.getPhase2(deviceId),
      ]);
      if (p1Res.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setPhase1List((p1Res.value.data as any).phase1_interfaces || []);
      }
      if (p2Res.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setPhase2List((p2Res.value.data as any).phase2_interfaces || []);
      }
    } catch {
      addToast('error', 'Failed to load IPsec configuration');
    } finally {
      setIpsecLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (activeTab === 'ipsec' && ipsecDevice) {
      loadIpsecConfig(ipsecDevice);
    }
  }, [activeTab, ipsecDevice, loadIpsecConfig]);

  // -----------------------------------------------------------------------
  // Filtered / scoped tunnels
  // -----------------------------------------------------------------------

  const activeTunnels = useMemo(
    () => scope.vdom === 'all'
      ? tunnels
      : tunnels.filter((t) => t.vdom_name === scope.vdom),
    [scope.vdom, tunnels]
  );

  const dedupedTunnels = useMemo(() => {
    const seen = new Set<string>();
    return activeTunnels.filter((t) => {
      const lo = Math.min(Number(t.source_device_id), Number(t.dest_device_id));
      const hi = Math.max(Number(t.source_device_id), Number(t.dest_device_id));
      const key = `${lo}-${hi}-${t.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeTunnels]);

  const visibleTunnels = selectedDeviceId
    ? dedupedTunnels.filter((t) => t.source_device_id === selectedDeviceId || t.dest_device_id === selectedDeviceId)
    : dedupedTunnels;
  const upCount = visibleTunnels.filter((t) => t.status === 'up').length;
  const downCount = visibleTunnels.filter((t) => t.status === 'down').length;

  // -----------------------------------------------------------------------
  // Topology graph helpers
  // -----------------------------------------------------------------------

  const buildNodesFromData = useCallback((): Node[] => {
    const count = deviceNodes.length;
    if (count === 0) return [];
    const cx = 500, cy = 300;
    const radius = Math.max(250, count * 40);
    return deviceNodes.map((d, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return {
        id: d.id,
        type: 'fortigate',
        position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
        data: d,
      };
    });
  }, [deviceNodes]);

  const buildEdgesFromData = useCallback((filter: string): Edge[] => {
    const filtered = filter === 'all' ? activeTunnels : activeTunnels.filter((t) => t.status === filter);

    const nodeIds = new Set(deviceNodes.map((d) => d.id));
    const validFiltered = filtered.filter(
      (t) =>
        t.dest_device_id &&
        t.dest_device_id.trim() !== '' &&
        nodeIds.has(t.source_device_id) &&
        nodeIds.has(t.dest_device_id),
    );

    const seen = new Set<string>();
    const deduped = validFiltered.filter((t) => {
      const lo = Math.min(Number(t.source_device_id), Number(t.dest_device_id));
      const hi = Math.max(Number(t.source_device_id), Number(t.dest_device_id));
      const key = `${lo}-${hi}-${t.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const pairCount: Record<string, number> = {};
    const pairIndex: Record<string, number> = {};
    for (const t of deduped) {
      const lo = Math.min(Number(t.source_device_id), Number(t.dest_device_id));
      const hi = Math.max(Number(t.source_device_id), Number(t.dest_device_id));
      const pk = `${lo}-${hi}`;
      pairCount[pk] = (pairCount[pk] || 0) + 1;
    }

    return deduped.map((t) => {
      const lo = Math.min(Number(t.source_device_id), Number(t.dest_device_id));
      const hi = Math.max(Number(t.source_device_id), Number(t.dest_device_id));
      const pk = `${lo}-${hi}`;
      const idx = pairIndex[pk] || 0;
      pairIndex[pk] = idx + 1;

      const isParallel = pairCount[pk] > 1;
      const handleProps = isParallel && idx > 0
        ? { sourceHandle: 'right', targetHandle: 'left' }
        : { sourceHandle: 'bottom', targetHandle: 'top' };
      const edgeType = isParallel && idx > 0 ? 'straight' : 'default';

      const vdom = t.vdom_name && t.vdom_name !== 'root' ? ` (${t.vdom_name})` : '';
      const edgeLabel = `${t.name}${vdom}`;

      return {
        id: `${lo}-${hi}-${t.name}`,
        source: t.source_device_id,
        target: t.dest_device_id,
        type: edgeType,
        ...handleProps,
        data: { tunnel: t },
        style: {
          stroke: t.status === 'up' ? '#34d399' : '#f87171',
          strokeWidth: 2,
          strokeDasharray: t.status === 'down' ? '8 4' : undefined,
        },
        animated: t.status === 'up',
        label: edgeLabel,
        labelStyle: { fill: '#94a3b8', fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: t.status === 'up' ? '#34d399' : '#f87171', width: 15, height: 15 },
      };
    });
  }, [activeTunnels, deviceNodes]);

  const initialNodes = useMemo(() => buildNodesFromData(), [buildNodesFromData]);
  const initialEdges = useMemo(() => buildEdgesFromData(statusFilter), [buildEdgesFromData, statusFilter]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const tunnel = (edge.data as { tunnel?: VPNTunnel })?.tunnel;
    if (tunnel) setSelectedTunnel(tunnel);
  }, []);

  const handleAutoLayout = useCallback(() => {
    setNodes(buildNodesFromData());
  }, [setNodes, buildNodesFromData]);

  const buildEdgesWithDeviceFilter = useCallback((filter: string) => {
    const byStatus = buildEdgesFromData(filter);
    if (!selectedDeviceId) return byStatus;
    return byStatus.filter((e) => {
      const t = e.data?.tunnel as VPNTunnel | undefined;
      if (!t) return false;
      return t.source_device_id === selectedDeviceId || t.dest_device_id === selectedDeviceId;
    });
  }, [selectedDeviceId, buildEdgesFromData]);

  useEffect(() => {
    setNodes(buildNodesFromData());
  }, [setNodes, buildNodesFromData]);

  useEffect(() => {
    setEdges(buildEdgesWithDeviceFilter(statusFilter));
  }, [statusFilter, selectedDeviceId, setEdges, buildEdgesWithDeviceFilter, scope.vdom]);

  // -----------------------------------------------------------------------
  // Tunnel table search
  // -----------------------------------------------------------------------

  const filteredTableTunnels = useMemo(() => {
    let list = visibleTunnels;
    if (statusFilter !== 'all') {
      list = list.filter((t) => t.status === statusFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        t.source_device_name.toLowerCase().includes(q) ||
        t.dest_device_name.toLowerCase().includes(q) ||
        t.source_ip.includes(q) ||
        t.dest_ip.includes(q)
      );
    }
    return list;
  }, [visibleTunnels, statusFilter, searchQuery]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 animate-fade-in">
      {/* Smart Tabs + Summary Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-dark-800 rounded-lg p-1 border border-dark-700">
            {smartTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                    activeTab === tab.id
                      ? 'bg-primary-500/20 text-primary-400 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-dark-700'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 font-medium">{upCount} Up</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1.5">
              <WifiOff className="w-4 h-4 text-red-400" />
              <span className="text-red-400 font-medium">{downCount} Down</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTab !== 'ipsec' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-dark w-auto text-sm"
            >
              <option value="all">All Tunnels</option>
              <option value="up">Up Only</option>
              <option value="down">Down Only</option>
            </select>
          )}
          {activeTab === 'topology' && (
            <button onClick={handleAutoLayout} className="btn-secondary text-sm">
              <LayoutTemplate className="w-4 h-4" /> Auto Layout
            </button>
          )}
          <button onClick={handleDiscover} disabled={discovering} className="btn-secondary text-sm">
            {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {discovering ? 'Discovering...' : 'Discover'}
          </button>
          <button onClick={() => loadData()} className="btn-primary text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'topology' && (
        <TopologyTab
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeClick={onEdgeClick}
          selectedTunnel={selectedTunnel}
          onCloseTunnel={() => setSelectedTunnel(null)}
          deviceNodes={deviceNodes}
        />
      )}

      {activeTab === 'table' && (
        <TunnelTableTab
          tunnels={filteredTableTunnels}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          dataLoaded={dataLoaded}
          onSelectTunnel={setSelectedTunnel}
          selectedTunnel={selectedTunnel}
          onCloseTunnel={() => setSelectedTunnel(null)}
        />
      )}

      {activeTab === 'ipsec' && (
        <IpsecConfigTab
          devices={devices}
          selectedDevice={ipsecDevice}
          onDeviceChange={setIpsecDevice}
          phase1List={phase1List}
          phase2List={phase2List}
          loading={ipsecLoading}
          onRefresh={() => loadIpsecConfig(ipsecDevice)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topology Sub-Tab
// ---------------------------------------------------------------------------

function TopologyTab({
  nodes, edges, onNodesChange, onEdgesChange, onEdgeClick,
  selectedTunnel, onCloseTunnel, deviceNodes,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge) => void;
  selectedTunnel: VPNTunnel | null;
  onCloseTunnel: () => void;
  deviceNodes: DeviceNodeInfo[];
}) {
  return (
    <div className="flex-1 glass-card overflow-hidden relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        <Controls className="!bg-dark-800 !border-dark-600 !rounded-lg !shadow-xl [&>button]:!bg-dark-700 [&>button]:!border-dark-600 [&>button]:!text-slate-300 [&>button:hover]:!bg-dark-600" />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as DeviceNodeInfo;
            if (d.status === 'online') return '#34d399';
            if (d.status === 'offline') return '#f87171';
            return '#fbbf24';
          }}
          maskColor="rgba(15, 23, 42, 0.8)"
          className="!bg-dark-900 !border-dark-700 !rounded-lg"
        />
      </ReactFlow>

      {selectedTunnel && (
        <TunnelDetailPanel tunnel={selectedTunnel} onClose={onCloseTunnel} />
      )}

      {deviceNodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-slate-500">
            <Network className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No devices found. Add devices and run Discover to build the topology.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tunnel Table Sub-Tab
// ---------------------------------------------------------------------------

function TunnelTableTab({
  tunnels, searchQuery, onSearchChange, dataLoaded,
  onSelectTunnel, selectedTunnel, onCloseTunnel,
}: {
  tunnels: VPNTunnel[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  dataLoaded: boolean;
  onSelectTunnel: (t: VPNTunnel) => void;
  selectedTunnel: VPNTunnel | null;
  onCloseTunnel: () => void;
}) {
  return (
    <div className="flex-1 flex gap-4 min-h-0">
      <div className="flex-1 glass-card overflow-hidden flex flex-col">
        <div className="p-3 border-b border-dark-700 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tunnels..."
              className="input-dark pl-10 w-full text-sm"
            />
          </div>
          <span className="text-xs text-slate-500">{tunnels.length} tunnel{tunnels.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="flex-1 overflow-auto">
          {!dataLoaded ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
            </div>
          ) : tunnels.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              No tunnels found. Run Discover to scan devices.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-dark-800/80 sticky top-0">
                <tr className="text-slate-400 text-left">
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Tunnel Name</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Destination</th>
                  <th className="px-3 py-2 font-medium">Remote GW</th>
                  <th className="px-3 py-2 font-medium">RX / TX</th>
                  <th className="px-3 py-2 font-medium">Uptime</th>
                  <th className="px-3 py-2 font-medium">VDOM</th>
                </tr>
              </thead>
              <tbody>
                {tunnels.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => onSelectTunnel(t)}
                    className={clsx(
                      'border-b border-dark-700/50 hover:bg-dark-700/30 cursor-pointer transition-colors',
                      selectedTunnel?.id === t.id && 'bg-primary-500/10'
                    )}
                  >
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} size="sm" />
                    </td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{t.name}</td>
                    <td className="px-3 py-2">
                      <span className="text-slate-300">{t.source_device_name}</span>
                      <span className="text-slate-500 ml-1 font-mono">{t.source_ip}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-slate-300">{t.dest_device_name || '—'}</span>
                      <span className="text-slate-500 ml-1 font-mono">{t.dest_ip}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-400">{t.dest_ip || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="text-primary-400">{formatBytes(t.incoming_bytes)}</span>
                      <span className="text-slate-600 mx-1">/</span>
                      <span className="text-purple-400">{formatBytes(t.outgoing_bytes)}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{formatUptime(t.uptime)}</td>
                    <td className="px-3 py-2 text-slate-500">{t.vdom_name || 'root'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedTunnel && (
        <div className="w-80 shrink-0">
          <TunnelDetailPanel tunnel={selectedTunnel} onClose={onCloseTunnel} inline />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IPsec Config Sub-Tab
// ---------------------------------------------------------------------------

function IpsecConfigTab({
  devices, selectedDevice, onDeviceChange,
  phase1List, phase2List, loading, onRefresh,
}: {
  devices: any[];
  selectedDevice: string;
  onDeviceChange: (id: string) => void;
  phase1List: Phase1Entry[];
  phase2List: Phase2Entry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [ipsecSubTab, setIpsecSubTab] = useState<'phase1' | 'phase2'>('phase1');

  return (
    <div className="flex-1 glass-card overflow-hidden flex flex-col">
      <div className="p-3 border-b border-dark-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={selectedDevice}
            onChange={(e) => onDeviceChange(e.target.value)}
            className="input-dark w-auto text-sm"
          >
            {devices.map((d) => (
              <option key={d.id} value={String(d.id)}>{d.name}</option>
            ))}
          </select>
          <div className="flex items-center bg-dark-900 rounded-lg p-0.5 border border-dark-700">
            <button
              onClick={() => setIpsecSubTab('phase1')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all',
                ipsecSubTab === 'phase1' ? 'bg-primary-500/20 text-primary-400' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Lock className="w-3.5 h-3.5" /> Phase 1 ({phase1List.length})
            </button>
            <button
              onClick={() => setIpsecSubTab('phase2')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all',
                ipsecSubTab === 'phase2' ? 'bg-primary-500/20 text-primary-400' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Key className="w-3.5 h-3.5" /> Phase 2 ({phase2List.length})
            </button>
          </div>
        </div>
        <button onClick={onRefresh} disabled={loading} className="btn-secondary text-sm">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
          </div>
        ) : ipsecSubTab === 'phase1' ? (
          phase1List.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              No Phase 1 interfaces configured on this device
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-dark-800/80 sticky top-0">
                <tr className="text-slate-400 text-left">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Interface</th>
                  <th className="px-3 py-2 font-medium">IKE</th>
                  <th className="px-3 py-2 font-medium">Remote GW</th>
                  <th className="px-3 py-2 font-medium">Auth</th>
                  <th className="px-3 py-2 font-medium">Proposal</th>
                  <th className="px-3 py-2 font-medium">DH Group</th>
                  <th className="px-3 py-2 font-medium">NAT-T</th>
                  <th className="px-3 py-2 font-medium">DPD</th>
                  <th className="px-3 py-2 font-medium">Key Life</th>
                </tr>
              </thead>
              <tbody>
                {phase1List.map((p) => (
                  <tr key={p.name} className="border-b border-dark-700/50 hover:bg-dark-700/30">
                    <td className="px-3 py-2 text-slate-200 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-slate-400">{p.type}</td>
                    <td className="px-3 py-2 text-slate-400">{p.interface}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 bg-primary-500/10 text-primary-400 rounded text-[10px] font-medium">
                        v{p['ike-version']}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300">{p['remote-gw']}</td>
                    <td className="px-3 py-2 text-slate-400">{p.authmethod}</td>
                    <td className="px-3 py-2 text-slate-400">{p.proposal}</td>
                    <td className="px-3 py-2 text-slate-400">{p.dhgrp}</td>
                    <td className="px-3 py-2">
                      <span className={p.nattraversal === 'enable' ? 'text-emerald-400' : 'text-slate-500'}>
                        {p.nattraversal}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{p.dpd}</td>
                    <td className="px-3 py-2 text-slate-400">{Math.floor(p.keylife / 3600)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          phase2List.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              No Phase 2 interfaces configured on this device
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-dark-800/80 sticky top-0">
                <tr className="text-slate-400 text-left">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Phase 1</th>
                  <th className="px-3 py-2 font-medium">Proposal</th>
                  <th className="px-3 py-2 font-medium">PFS</th>
                  <th className="px-3 py-2 font-medium">DH Group</th>
                  <th className="px-3 py-2 font-medium">Key Life</th>
                  <th className="px-3 py-2 font-medium">Encapsulation</th>
                  <th className="px-3 py-2 font-medium">Src Subnet</th>
                  <th className="px-3 py-2 font-medium">Dst Subnet</th>
                </tr>
              </thead>
              <tbody>
                {phase2List.map((p) => (
                  <tr key={p.name} className="border-b border-dark-700/50 hover:bg-dark-700/30">
                    <td className="px-3 py-2 text-slate-200 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-primary-400">{p.phase1name}</td>
                    <td className="px-3 py-2 text-slate-400">{p.proposal}</td>
                    <td className="px-3 py-2">
                      <span className={p.pfs === 'enable' ? 'text-emerald-400' : 'text-slate-500'}>
                        {p.pfs}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{p.dhgrp}</td>
                    <td className="px-3 py-2 text-slate-400">{Math.floor(p.keylifeseconds / 3600)}h</td>
                    <td className="px-3 py-2 text-slate-400">{p.encapsulation}</td>
                    <td className="px-3 py-2 font-mono text-slate-300">{p['src-subnet']}</td>
                    <td className="px-3 py-2 font-mono text-slate-300">{p['dst-subnet']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tunnel Detail Side Panel (shared between topology & table tabs)
// ---------------------------------------------------------------------------

function TunnelDetailPanel({
  tunnel, onClose, inline = false,
}: {
  tunnel: VPNTunnel;
  onClose: () => void;
  inline?: boolean;
}) {
  const wrapperClass = inline
    ? 'bg-dark-800/95 backdrop-blur-sm border border-dark-600 rounded-xl shadow-2xl h-full overflow-auto'
    : 'absolute top-4 right-4 w-80 bg-dark-800/95 backdrop-blur-sm border border-dark-600 rounded-xl shadow-2xl animate-slide-up z-10';

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
        <h3 className="text-sm font-semibold text-slate-100">Tunnel Details</h3>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">{tunnel.name}</span>
          <StatusBadge status={tunnel.status} size="sm" />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-dark-900/50 rounded-lg p-2">
            <p className="text-slate-500 mb-0.5">Type</p>
            <p className="text-slate-200 uppercase font-medium">{tunnel.type}</p>
          </div>
          <div className="bg-dark-900/50 rounded-lg p-2">
            <p className="text-slate-500 mb-0.5">Uptime</p>
            <p className="text-slate-200 font-medium">{formatUptime(tunnel.uptime)}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="bg-dark-900/50 rounded-lg p-2">
            <p className="text-[10px] text-slate-500 uppercase">Source</p>
            <p className="text-xs text-slate-200">{tunnel.source_device_name}</p>
            <p className="text-[10px] font-mono text-slate-400">{tunnel.source_ip} → {tunnel.local_subnet}</p>
          </div>
          <div className="bg-dark-900/50 rounded-lg p-2">
            <p className="text-[10px] text-slate-500 uppercase">Destination</p>
            <p className="text-xs text-slate-200">{tunnel.dest_device_name || 'Unknown'}</p>
            <p className="text-[10px] font-mono text-slate-400">{tunnel.dest_ip} → {tunnel.remote_subnet}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-dark-900/50 rounded-lg p-2 flex items-center gap-2">
            <ArrowDownRight className="w-3.5 h-3.5 text-primary-400" />
            <div>
              <p className="text-[10px] text-slate-500">Incoming</p>
              <p className="text-xs font-medium text-primary-400">{formatBytes(tunnel.incoming_bytes)}</p>
            </div>
          </div>
          <div className="bg-dark-900/50 rounded-lg p-2 flex items-center gap-2">
            <ArrowUpRight className="w-3.5 h-3.5 text-purple-400" />
            <div>
              <p className="text-[10px] text-slate-500">Outgoing</p>
              <p className="text-xs font-medium text-purple-400">{formatBytes(tunnel.outgoing_bytes)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-dark-900/50 rounded-lg p-2">
            <p className="text-slate-500 mb-0.5">Phase 1</p>
            <StatusBadge status={tunnel.phase1_status === 'up' ? 'up' : 'down'} size="sm" />
          </div>
          <div className="bg-dark-900/50 rounded-lg p-2">
            <p className="text-slate-500 mb-0.5">Phase 2</p>
            <StatusBadge status={tunnel.phase2_status === 'up' ? 'up' : 'down'} size="sm" />
          </div>
        </div>

        {tunnel.vdom_name && tunnel.vdom_name !== 'root' && (
          <div className="bg-dark-900/50 rounded-lg p-2 text-xs">
            <p className="text-slate-500 mb-0.5">VDOM</p>
            <p className="text-slate-200 font-medium">{tunnel.vdom_name}</p>
          </div>
        )}
      </div>
    </div>
  );
}
