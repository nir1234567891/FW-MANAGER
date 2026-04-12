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
  RefreshCw, LayoutTemplate, Filter, Shield, Wifi, WifiOff,
  X, ArrowDownRight, ArrowUpRight, Clock,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import type { VPNTunnel } from '@/types';
import { clsx } from 'clsx';
import { useScope } from '@/hooks/useScope';
import { deviceService, tunnelService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';

const mockTunnels: VPNTunnel[] = [
  { id: 't1', name: 'HQ-DC1-to-NYC', type: 'ipsec', status: 'up', source_device_id: '1', source_device_name: 'FG-HQ-DC1', dest_device_id: '3', dest_device_name: 'FG-BRANCH-NYC', source_ip: '10.0.1.1', dest_ip: '10.1.1.1', local_subnet: '10.0.0.0/16', remote_subnet: '10.1.0.0/16', incoming_bytes: 524288000, outgoing_bytes: 312475648, phase1_status: 'up', phase2_status: 'up', uptime: 2592000, last_change: new Date(Date.now() - 2592000000).toISOString() },
  { id: 't2', name: 'HQ-DC1-to-LON', type: 'ipsec', status: 'up', source_device_id: '1', source_device_name: 'FG-HQ-DC1', dest_device_id: '4', dest_device_name: 'FG-BRANCH-LON', source_ip: '10.0.1.1', dest_ip: '10.2.1.1', local_subnet: '10.0.0.0/16', remote_subnet: '10.2.0.0/16', incoming_bytes: 418381824, outgoing_bytes: 256901120, phase1_status: 'up', phase2_status: 'up', uptime: 1728000, last_change: new Date(Date.now() - 1728000000).toISOString() },
  { id: 't3', name: 'HQ-DC1-to-TKY', type: 'ipsec', status: 'down', source_device_id: '1', source_device_name: 'FG-HQ-DC1', dest_device_id: '5', dest_device_name: 'FG-BRANCH-TKY', source_ip: '10.0.1.1', dest_ip: '10.3.1.1', local_subnet: '10.0.0.0/16', remote_subnet: '10.3.0.0/16', incoming_bytes: 0, outgoing_bytes: 0, phase1_status: 'down', phase2_status: 'down', uptime: 0, last_change: new Date(Date.now() - 3600000).toISOString() },
  { id: 't4', name: 'HQ-DC1-to-SYD', type: 'ipsec', status: 'up', source_device_id: '1', source_device_name: 'FG-HQ-DC1', dest_device_id: '6', dest_device_name: 'FG-BRANCH-SYD', source_ip: '10.0.1.1', dest_ip: '10.4.1.1', local_subnet: '10.0.0.0/16', remote_subnet: '10.4.0.0/16', incoming_bytes: 209715200, outgoing_bytes: 157286400, phase1_status: 'up', phase2_status: 'up', uptime: 604800, last_change: new Date(Date.now() - 604800000).toISOString() },
  { id: 't5', name: 'HQ-DC2-to-NYC', type: 'ipsec', status: 'up', source_device_id: '2', source_device_name: 'FG-HQ-DC2', dest_device_id: '3', dest_device_name: 'FG-BRANCH-NYC', source_ip: '10.0.1.2', dest_ip: '10.1.1.1', local_subnet: '10.0.0.0/16', remote_subnet: '10.1.0.0/16', incoming_bytes: 104857600, outgoing_bytes: 78643200, phase1_status: 'up', phase2_status: 'up', uptime: 2592000, last_change: new Date(Date.now() - 2592000000).toISOString() },
  { id: 't6', name: 'HQ-DC2-to-LON', type: 'ipsec', status: 'up', source_device_id: '2', source_device_name: 'FG-HQ-DC2', dest_device_id: '4', dest_device_name: 'FG-BRANCH-LON', source_ip: '10.0.1.2', dest_ip: '10.2.1.1', local_subnet: '10.0.0.0/16', remote_subnet: '10.2.0.0/16', incoming_bytes: 83886080, outgoing_bytes: 62914560, phase1_status: 'up', phase2_status: 'up', uptime: 1728000, last_change: new Date(Date.now() - 1728000000).toISOString() },
  { id: 't7', name: 'DC1-to-DC2-HA', type: 'ipsec', status: 'up', source_device_id: '1', source_device_name: 'FG-HQ-DC1', dest_device_id: '2', dest_device_name: 'FG-HQ-DC2', source_ip: '10.0.1.1', dest_ip: '10.0.1.2', local_subnet: '10.0.1.0/24', remote_subnet: '10.0.1.0/24', incoming_bytes: 1073741824, outgoing_bytes: 1073741824, phase1_status: 'up', phase2_status: 'up', uptime: 8640000, last_change: new Date(Date.now() - 8640000000).toISOString() },
  { id: 't8', name: 'NYC-to-LON-Direct', type: 'ipsec', status: 'up', source_device_id: '3', source_device_name: 'FG-BRANCH-NYC', dest_device_id: '4', dest_device_name: 'FG-BRANCH-LON', source_ip: '10.1.1.1', dest_ip: '10.2.1.1', local_subnet: '10.1.0.0/16', remote_subnet: '10.2.0.0/16', incoming_bytes: 52428800, outgoing_bytes: 41943040, phase1_status: 'up', phase2_status: 'up', uptime: 864000, last_change: new Date(Date.now() - 864000000).toISOString() },
];

const deviceNodeData = [
  { id: '1', name: 'FG-HQ-DC1', model: 'FortiGate 600E', ip: '10.0.1.1', status: 'online' as const, role: 'HQ Primary' },
  { id: '2', name: 'FG-HQ-DC2', model: 'FortiGate 600E', ip: '10.0.1.2', status: 'online' as const, role: 'HQ Secondary' },
  { id: '3', name: 'FG-BRANCH-NYC', model: 'FortiGate 200F', ip: '10.1.1.1', status: 'online' as const, role: 'Branch' },
  { id: '4', name: 'FG-BRANCH-LON', model: 'FortiGate 200F', ip: '10.2.1.1', status: 'online' as const, role: 'Branch' },
  { id: '5', name: 'FG-BRANCH-TKY', model: 'FortiGate 100F', ip: '10.3.1.1', status: 'offline' as const, role: 'Branch' },
  { id: '6', name: 'FG-BRANCH-SYD', model: 'FortiGate 100F', ip: '10.4.1.1', status: 'warning' as const, role: 'Branch' },
];

function FortiGateNode({ data }: NodeProps) {
  const d = data as (typeof deviceNodeData)[0];
  const borderColor = d.status === 'online' ? 'border-emerald-500/30' : d.status === 'offline' ? 'border-red-500/30' : 'border-amber-500/30';
  const glowColor = d.status === 'online' ? 'shadow-emerald-500/10' : d.status === 'offline' ? 'shadow-red-500/10' : 'shadow-amber-500/10';

  return (
    <div className={clsx('bg-dark-800 border rounded-xl p-4 min-w-[180px] shadow-lg', borderColor, glowColor)}>
      <Handle type="target" position={Position.Top} className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
      <Handle type="source" position={Position.Bottom} className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
      <Handle type="target" position={Position.Left} className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
      <Handle type="source" position={Position.Right} className="!bg-primary-500 !w-2 !h-2 !border-dark-800" />
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

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatUptime(seconds: number): string {
  if (seconds === 0) return 'Down';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function buildNodes(): Node[] {
  const cx = 500, cy = 300;
  const positions: Record<string, { x: number; y: number }> = {
    '1': { x: cx - 120, y: cy - 40 },
    '2': { x: cx + 120, y: cy - 40 },
    '3': { x: cx - 350, y: cy - 200 },
    '4': { x: cx + 350, y: cy - 200 },
    '5': { x: cx - 350, y: cy + 160 },
    '6': { x: cx + 350, y: cy + 160 },
  };
  return deviceNodeData.map((d) => ({
    id: d.id,
    type: 'fortigate',
    position: positions[d.id],
    data: d,
  }));
}

function buildEdges(filter: string): Edge[] {
  const filtered = filter === 'all' ? mockTunnels : mockTunnels.filter((t) => t.status === filter);
  return filtered.map((t) => ({
    id: t.id,
    source: t.source_device_id,
    target: t.dest_device_id,
    data: { tunnel: t },
    style: {
      stroke: t.status === 'up' ? '#34d399' : '#f87171',
      strokeWidth: 2,
      strokeDasharray: t.status === 'down' ? '8 4' : undefined,
    },
    animated: t.status === 'up',
    label: t.name,
    labelStyle: { fill: '#94a3b8', fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, color: t.status === 'up' ? '#34d399' : '#f87171', width: 15, height: 15 },
  }));
}

export default function TunnelMap() {
  const location = useLocation();
  const { scope } = useScope();
  const routeDeviceId = (location.state as { selectedDeviceId?: string } | null)?.selectedDeviceId;
  const selectedDeviceId = routeDeviceId || (scope.deviceId === 'all' ? undefined : scope.deviceId);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTunnel, setSelectedTunnel] = useState<VPNTunnel | null>(null);
  const [realDeviceNodes, setRealDeviceNodes] = useState<typeof deviceNodeData>([]);
  const [realTunnels, setRealTunnels] = useState<VPNTunnel[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  // Load real devices and tunnels from API
  const loadData = useCallback(() => {
    Promise.allSettled([
      deviceService.getAll(),
      tunnelService.getAll(),
    ]).then(([devResult, tunnelResult]) => {
      // Devices → nodes
      if (devResult.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = devResult.value.data as any[];
        if (Array.isArray(list) && list.length > 0) {
          setRealDeviceNodes(list.map((d: any) => {
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
        }
      }
      // Tunnels
      if (tunnelResult.status === 'fulfilled') {
        const data = tunnelResult.value.data;
        const tunnels = Array.isArray(data) ? data : [];
        if (tunnels.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setRealTunnels(tunnels.map((t: any) => ({
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
          })));
        }
      }
      setDataLoaded(true);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    try {
      await tunnelService.discover();
      loadData();
    } catch (err) {
      console.error('Tunnel discovery failed:', err);
    } finally {
      setDiscovering(false);
    }
  }, [loadData]);

  // Use real data if loaded, fall back to mock
  const activeDeviceNodes = realDeviceNodes.length > 0 ? realDeviceNodes : deviceNodeData;
  const activeTunnels = dataLoaded && realTunnels.length > 0 ? realTunnels : mockTunnels;

  function buildNodesFromData(): Node[] {
    const count = activeDeviceNodes.length;
    const cx = 500, cy = 300;
    const radius = Math.max(250, count * 40);
    return activeDeviceNodes.map((d, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return {
        id: d.id,
        type: 'fortigate',
        position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
        data: d,
      };
    });
  }

  function buildEdgesFromData(filter: string): Edge[] {
    const filtered = filter === 'all' ? activeTunnels : activeTunnels.filter((t) => t.status === filter);
    return filtered.map((t) => ({
      id: t.id,
      source: t.source_device_id,
      target: t.dest_device_id,
      data: { tunnel: t },
      style: {
        stroke: t.status === 'up' ? '#34d399' : '#f87171',
        strokeWidth: 2,
        strokeDasharray: t.status === 'down' ? '8 4' : undefined,
      },
      animated: t.status === 'up',
      label: t.name,
      labelStyle: { fill: '#94a3b8', fontSize: 10, fontWeight: 500 },
      labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, color: t.status === 'up' ? '#34d399' : '#f87171', width: 15, height: 15 },
    }));
  }

  const initialNodes = useMemo(() => buildNodesFromData(), [activeDeviceNodes]);
  const initialEdges = useMemo(() => buildEdgesFromData(statusFilter), [statusFilter, activeTunnels]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const tunnel = activeTunnels.find((t) => t.id === edge.id);
    if (tunnel) setSelectedTunnel(tunnel);
  }, [activeTunnels]);

  const handleAutoLayout = useCallback(() => {
    setNodes(buildNodesFromData());
  }, [setNodes, activeDeviceNodes]);

  const buildEdgesWithDeviceFilter = useCallback((filter: string) => {
    const byStatus = buildEdgesFromData(filter);
    if (!selectedDeviceId) return byStatus;
    return byStatus.filter((e) => {
      const t = e.data?.tunnel as VPNTunnel | undefined;
      if (!t) return false;
      return t.source_device_id === selectedDeviceId || t.dest_device_id === selectedDeviceId;
    });
  }, [selectedDeviceId, activeTunnels]);

  const handleRefresh = useCallback(() => {
    setEdges(buildEdgesWithDeviceFilter(statusFilter));
  }, [statusFilter, setEdges, buildEdgesWithDeviceFilter]);

  useEffect(() => {
    setNodes(buildNodesFromData());
    setEdges(buildEdgesWithDeviceFilter(statusFilter));
  }, [statusFilter, selectedDeviceId, setEdges, setNodes, buildEdgesWithDeviceFilter, activeDeviceNodes]);

  const visibleTunnels = selectedDeviceId
    ? activeTunnels.filter((t) => t.source_device_id === selectedDeviceId || t.dest_device_id === selectedDeviceId)
    : activeTunnels;
  const upCount = visibleTunnels.filter((t) => t.status === 'up').length;
  const downCount = visibleTunnels.filter((t) => t.status === 'down').length;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-2 ml-4">
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-5 h-0.5 bg-emerald-400 rounded" /> Active
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-5 h-0.5 bg-red-400 rounded border-dashed border-t border-red-400" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #f87171 0, #f87171 4px, transparent 4px, transparent 8px)' }} /> Down
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setEdges(buildEdgesWithDeviceFilter(e.target.value)); }}
            className="input-dark w-auto text-sm"
          >
            <option value="all">All Tunnels</option>
            <option value="up">Up Only</option>
            <option value="down">Down Only</option>
          </select>
          {selectedDeviceId && (
            <button
              onClick={() => window.history.back()}
              className="btn-secondary text-sm"
            >
              Back To Device
            </button>
          )}
          <button onClick={handleAutoLayout} className="btn-secondary text-sm">
            <LayoutTemplate className="w-4 h-4" /> Auto Layout
          </button>
          <button onClick={handleDiscover} disabled={discovering} className="btn-secondary text-sm">
            <Wifi className="w-4 h-4" /> {discovering ? 'Discovering...' : 'Discover Tunnels'}
          </button>
          <button onClick={handleRefresh} className="btn-primary text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

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
          <Controls
            className="!bg-dark-800 !border-dark-600 !rounded-lg !shadow-xl [&>button]:!bg-dark-700 [&>button]:!border-dark-600 [&>button]:!text-slate-300 [&>button:hover]:!bg-dark-600"
          />
          <MiniMap
            nodeColor={(n) => {
              const d = n.data as (typeof deviceNodeData)[0];
              if (d.status === 'online') return '#34d399';
              if (d.status === 'offline') return '#f87171';
              return '#fbbf24';
            }}
            maskColor="rgba(15, 23, 42, 0.8)"
            className="!bg-dark-900 !border-dark-700 !rounded-lg"
          />
        </ReactFlow>

        {selectedTunnel && (
          <div className="absolute top-4 right-4 w-80 bg-dark-800/95 backdrop-blur-sm border border-dark-600 rounded-xl shadow-2xl animate-slide-up z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
              <h3 className="text-sm font-semibold text-slate-100">Tunnel Details</h3>
              <button onClick={() => setSelectedTunnel(null)} className="p-1 text-slate-400 hover:text-slate-200 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">{selectedTunnel.name}</span>
                <StatusBadge status={selectedTunnel.status} size="sm" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-dark-900/50 rounded-lg p-2">
                  <p className="text-slate-500 mb-0.5">Type</p>
                  <p className="text-slate-200 uppercase font-medium">{selectedTunnel.type}</p>
                </div>
                <div className="bg-dark-900/50 rounded-lg p-2">
                  <p className="text-slate-500 mb-0.5">Uptime</p>
                  <p className="text-slate-200 font-medium">{formatUptime(selectedTunnel.uptime)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="bg-dark-900/50 rounded-lg p-2">
                  <p className="text-[10px] text-slate-500 uppercase">Source</p>
                  <p className="text-xs text-slate-200">{selectedTunnel.source_device_name}</p>
                  <p className="text-[10px] font-mono text-slate-400">{selectedTunnel.source_ip} → {selectedTunnel.local_subnet}</p>
                </div>
                <div className="bg-dark-900/50 rounded-lg p-2">
                  <p className="text-[10px] text-slate-500 uppercase">Destination</p>
                  <p className="text-xs text-slate-200">{selectedTunnel.dest_device_name}</p>
                  <p className="text-[10px] font-mono text-slate-400">{selectedTunnel.dest_ip} → {selectedTunnel.remote_subnet}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-dark-900/50 rounded-lg p-2 flex items-center gap-2">
                  <ArrowDownRight className="w-3.5 h-3.5 text-primary-400" />
                  <div>
                    <p className="text-[10px] text-slate-500">Incoming</p>
                    <p className="text-xs font-medium text-primary-400">{formatBytes(selectedTunnel.incoming_bytes)}</p>
                  </div>
                </div>
                <div className="bg-dark-900/50 rounded-lg p-2 flex items-center gap-2">
                  <ArrowUpRight className="w-3.5 h-3.5 text-purple-400" />
                  <div>
                    <p className="text-[10px] text-slate-500">Outgoing</p>
                    <p className="text-xs font-medium text-purple-400">{formatBytes(selectedTunnel.outgoing_bytes)}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-dark-900/50 rounded-lg p-2">
                  <p className="text-slate-500 mb-0.5">Phase 1</p>
                  <StatusBadge status={selectedTunnel.phase1_status === 'up' ? 'up' : 'down'} size="sm" />
                </div>
                <div className="bg-dark-900/50 rounded-lg p-2">
                  <p className="text-slate-500 mb-0.5">Phase 2</p>
                  <StatusBadge status={selectedTunnel.phase2_status === 'up' ? 'up' : 'down'} size="sm" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
