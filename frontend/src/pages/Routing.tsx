import { useState, useMemo, useEffect } from 'react';
import {
  Network, Search, CheckCircle2, XCircle, ArrowRightLeft, Router,
  Info, ChevronDown, ChevronRight, Monitor, RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useScope, scopeDevices } from '@/hooks/useScope';
import { deviceService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';

type ProtocolType = 'bgp' | 'ospf';
type NeighborState = 'established' | 'active' | 'idle' | 'connect' | 'opensent' | 'openconfirm' | 'full' | 'loading' | '2-way' | 'down';

interface BGPNeighbor {
  id: string;
  device_id: string;
  device_name: string;
  vdom: string;
  neighbor_ip: string;
  remote_as: number;
  local_as: number;
  state: NeighborState;
  uptime: string;
  prefixes_received: number;
  prefixes_sent: number;
  description: string;
}

interface OSPFNeighbor {
  id: string;
  device_id: string;
  device_name: string;
  vdom: string;
  neighbor_id: string;
  neighbor_ip: string;
  area: string;
  state: NeighborState;
  interface_name: string;
  priority: number;
  dead_timer: string;
  uptime: string;
}

interface InterfaceDetail {
  name: string;
  ip: string;
  mask: string;
  status: 'up' | 'down' | 'admin-down';
  speed: string;
  duplex: string;
  type: string;
  vdom: string;
  vlan_id?: number;
  mtu: number;
  description: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_errors: number;
  tx_errors: number;
  media: string;
  zone?: string;
  allowaccess: string;
  connected_to?: string;
}

const mockBGPNeighbors: BGPNeighbor[] = [
  { id: 'bgp1', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'root', neighbor_ip: '10.0.1.2', remote_as: 65001, local_as: 65000, state: 'established', uptime: '45d 12h', prefixes_received: 156, prefixes_sent: 142, description: 'iBGP to DC2' },
  { id: 'bgp2', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'root', neighbor_ip: '203.0.113.1', remote_as: 64512, local_as: 65000, state: 'established', uptime: '30d 8h', prefixes_received: 524000, prefixes_sent: 28, description: 'ISP-A upstream' },
  { id: 'bgp3', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'root', neighbor_ip: '198.51.100.1', remote_as: 64513, local_as: 65000, state: 'idle', uptime: '0', prefixes_received: 0, prefixes_sent: 0, description: 'ISP-B upstream (down)' },
  { id: 'bgp4', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'DMZ', neighbor_ip: '192.168.1.254', remote_as: 65100, local_as: 65000, state: 'established', uptime: '12d 3h', prefixes_received: 8, prefixes_sent: 12, description: 'DMZ edge router' },
  { id: 'bgp5', device_id: '2', device_name: 'FG-HQ-DC2', vdom: 'root', neighbor_ip: '10.0.1.1', remote_as: 65000, local_as: 65001, state: 'established', uptime: '45d 12h', prefixes_received: 142, prefixes_sent: 156, description: 'iBGP to DC1' },
  { id: 'bgp6', device_id: '2', device_name: 'FG-HQ-DC2', vdom: 'root', neighbor_ip: '203.0.113.5', remote_as: 64514, local_as: 65001, state: 'established', uptime: '28d 5h', prefixes_received: 523800, prefixes_sent: 28, description: 'ISP-C upstream' },
  { id: 'bgp7', device_id: '3', device_name: 'FG-BRANCH-NYC', vdom: 'root', neighbor_ip: '10.1.1.254', remote_as: 65200, local_as: 65010, state: 'established', uptime: '60d 2h', prefixes_received: 24, prefixes_sent: 6, description: 'NYC PE router' },
  { id: 'bgp8', device_id: '4', device_name: 'FG-BRANCH-LON', vdom: 'root', neighbor_ip: '10.2.1.254', remote_as: 65300, local_as: 65020, state: 'established', uptime: '22d 18h', prefixes_received: 18, prefixes_sent: 4, description: 'LON PE router' },
  { id: 'bgp9', device_id: '4', device_name: 'FG-BRANCH-LON', vdom: 'root', neighbor_ip: '10.2.2.1', remote_as: 65301, local_as: 65020, state: 'active', uptime: '0', prefixes_received: 0, prefixes_sent: 0, description: 'LON backup link (flapping)' },
  { id: 'bgp10', device_id: '6', device_name: 'FG-BRANCH-SYD', vdom: 'root', neighbor_ip: '10.4.1.254', remote_as: 65400, local_as: 65040, state: 'established', uptime: '7d 4h', prefixes_received: 12, prefixes_sent: 3, description: 'SYD PE router' },
];

const mockOSPFNeighbors: OSPFNeighbor[] = [
  { id: 'ospf1', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'root', neighbor_id: '10.0.1.2', neighbor_ip: '10.0.1.2', area: '0.0.0.0', state: 'full', interface_name: 'port2', priority: 1, dead_timer: '00:00:35', uptime: '45d 12h' },
  { id: 'ospf2', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'root', neighbor_id: '10.0.2.1', neighbor_ip: '10.0.2.1', area: '0.0.0.0', state: 'full', interface_name: 'port3', priority: 0, dead_timer: '00:00:32', uptime: '40d 6h' },
  { id: 'ospf3', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'DMZ', neighbor_id: '192.168.1.254', neighbor_ip: '192.168.1.254', area: '0.0.0.1', state: 'full', interface_name: 'port5', priority: 1, dead_timer: '00:00:38', uptime: '12d 3h' },
  { id: 'ospf4', device_id: '1', device_name: 'FG-HQ-DC1', vdom: 'root', neighbor_id: '10.0.3.1', neighbor_ip: '10.0.3.1', area: '0.0.0.2', state: 'down', interface_name: 'port6', priority: 1, dead_timer: '00:00:00', uptime: '0' },
  { id: 'ospf5', device_id: '2', device_name: 'FG-HQ-DC2', vdom: 'root', neighbor_id: '10.0.1.1', neighbor_ip: '10.0.1.1', area: '0.0.0.0', state: 'full', interface_name: 'port2', priority: 1, dead_timer: '00:00:33', uptime: '45d 12h' },
  { id: 'ospf6', device_id: '2', device_name: 'FG-HQ-DC2', vdom: 'root', neighbor_id: '10.0.2.2', neighbor_ip: '10.0.2.2', area: '0.0.0.0', state: '2-way', interface_name: 'port3', priority: 0, dead_timer: '00:00:28', uptime: '5d 1h' },
  { id: 'ospf7', device_id: '3', device_name: 'FG-BRANCH-NYC', vdom: 'root', neighbor_id: '10.1.1.254', neighbor_ip: '10.1.1.254', area: '0.0.0.10', state: 'full', interface_name: 'port1', priority: 1, dead_timer: '00:00:36', uptime: '60d 2h' },
  { id: 'ospf8', device_id: '4', device_name: 'FG-BRANCH-LON', vdom: 'root', neighbor_id: '10.2.1.254', neighbor_ip: '10.2.1.254', area: '0.0.0.20', state: 'full', interface_name: 'port1', priority: 1, dead_timer: '00:00:34', uptime: '22d 18h' },
  { id: 'ospf9', device_id: '6', device_name: 'FG-BRANCH-SYD', vdom: 'root', neighbor_id: '10.4.1.254', neighbor_ip: '10.4.1.254', area: '0.0.0.40', state: 'loading', interface_name: 'port1', priority: 1, dead_timer: '00:00:22', uptime: '0d 0h' },
];

const mockInterfaces: Record<string, InterfaceDetail[]> = {
  '1': [
    { name: 'port1', ip: '10.0.1.1', mask: '255.255.255.0', status: 'up', speed: '10Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'WAN1 - ISP-A', rx_bytes: 1284901200, tx_bytes: 982340100, rx_errors: 0, tx_errors: 0, media: 'SFP+ 10GBASE-SR', zone: 'WAN', allowaccess: 'ping https ssh', connected_to: 'ISP-A PE (203.0.113.1)' },
    { name: 'port2', ip: '172.16.0.1', mask: '255.255.255.0', status: 'up', speed: '10Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'LAN - Core Switch', rx_bytes: 502930000, tx_bytes: 401230000, rx_errors: 2, tx_errors: 0, media: 'SFP+ 10GBASE-SR', zone: 'LAN', allowaccess: 'ping https ssh', connected_to: 'Core-SW1 (Gi0/1)' },
    { name: 'port3', ip: '192.168.1.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'DMZ', mtu: 1500, description: 'DMZ Segment', rx_bytes: 128490000, tx_bytes: 98234000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'DMZ', allowaccess: 'ping https', connected_to: 'DMZ-SW1 (Gi0/24)' },
    { name: 'port4', ip: '192.168.10.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'Guest', mtu: 1500, description: 'Guest WiFi', rx_bytes: 42840000, tx_bytes: 31200000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'Guest', allowaccess: 'ping', connected_to: 'AP Controller' },
    { name: 'port5', ip: '10.0.10.1', mask: '255.255.255.252', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'HA Heartbeat', rx_bytes: 1073741824, tx_bytes: 1073741824, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', allowaccess: '', connected_to: 'FG-HQ-DC2 (port5)' },
    { name: 'port6', ip: '', mask: '', status: 'down', speed: '1Gbps', duplex: 'N/A', type: 'physical', vdom: 'root', mtu: 1500, description: 'Spare / Unused', rx_bytes: 0, tx_bytes: 0, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', allowaccess: '' },
    { name: 'port7', ip: '10.99.0.1', mask: '255.255.255.0', status: 'admin-down', speed: '1Gbps', duplex: 'N/A', type: 'physical', vdom: 'root', mtu: 1500, description: 'OOB Management (disabled)', rx_bytes: 0, tx_bytes: 0, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', allowaccess: 'ssh' },
    { name: 'ssl.root', ip: '10.212.134.200', mask: '255.255.255.0', status: 'up', speed: 'N/A', duplex: 'N/A', type: 'tunnel', vdom: 'root', mtu: 1500, description: 'SSL-VPN Interface', rx_bytes: 12049000, tx_bytes: 8042000, rx_errors: 0, tx_errors: 0, media: 'Virtual', allowaccess: '' },
    { name: 'HQ-NYC', ip: '10.255.1.1', mask: '255.255.255.255', status: 'up', speed: 'N/A', duplex: 'N/A', type: 'tunnel', vdom: 'root', mtu: 1420, description: 'IPSec VPN to NYC', rx_bytes: 524288000, tx_bytes: 312475648, rx_errors: 0, tx_errors: 0, media: 'IPSec', allowaccess: '', connected_to: 'FG-BRANCH-NYC' },
    { name: 'VLAN100', ip: '10.100.0.1', mask: '255.255.255.0', status: 'up', speed: 'N/A', duplex: 'N/A', type: 'vlan', vdom: 'root', vlan_id: 100, mtu: 1500, description: 'Server VLAN', rx_bytes: 248000000, tx_bytes: 192000000, rx_errors: 0, tx_errors: 0, media: 'VLAN on port2', allowaccess: 'ping' },
  ],
  '2': [
    { name: 'port1', ip: '10.0.1.2', mask: '255.255.255.0', status: 'up', speed: '10Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'WAN1 - ISP-C', rx_bytes: 720000000, tx_bytes: 450000000, rx_errors: 0, tx_errors: 0, media: 'SFP+ 10GBASE-SR', zone: 'WAN', allowaccess: 'ping https ssh', connected_to: 'ISP-C PE (203.0.113.5)' },
    { name: 'port2', ip: '172.16.0.2', mask: '255.255.255.0', status: 'up', speed: '10Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'LAN - Core Switch', rx_bytes: 398000000, tx_bytes: 312000000, rx_errors: 0, tx_errors: 0, media: 'SFP+ 10GBASE-SR', zone: 'LAN', allowaccess: 'ping https ssh', connected_to: 'Core-SW2 (Gi0/1)' },
    { name: 'port3', ip: '192.168.1.2', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'DMZ', mtu: 1500, description: 'DMZ Segment', rx_bytes: 98000000, tx_bytes: 72000000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'DMZ', allowaccess: 'ping https' },
    { name: 'port4', ip: '192.168.10.2', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'Guest', mtu: 1500, description: 'Guest WiFi', rx_bytes: 38000000, tx_bytes: 28000000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'Guest', allowaccess: 'ping' },
    { name: 'port5', ip: '10.0.10.2', mask: '255.255.255.252', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'HA Heartbeat', rx_bytes: 1073741824, tx_bytes: 1073741824, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', allowaccess: '', connected_to: 'FG-HQ-DC1 (port5)' },
  ],
  '3': [
    { name: 'port1', ip: '10.1.1.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'WAN - MPLS', rx_bytes: 320000000, tx_bytes: 180000000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'WAN', allowaccess: 'ping https ssh', connected_to: 'NYC PE (10.1.1.254)' },
    { name: 'port2', ip: '172.17.0.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'LAN - Office Switch', rx_bytes: 210000000, tx_bytes: 145000000, rx_errors: 1, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'LAN', allowaccess: 'ping https ssh', connected_to: 'NYC-SW1' },
    { name: 'port3', ip: '', mask: '', status: 'down', speed: '1Gbps', duplex: 'N/A', type: 'physical', vdom: 'root', mtu: 1500, description: 'Unused', rx_bytes: 0, tx_bytes: 0, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', allowaccess: '' },
  ],
  '4': [
    { name: 'port1', ip: '10.2.1.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'WAN - MPLS', rx_bytes: 280000000, tx_bytes: 160000000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'WAN', allowaccess: 'ping https ssh', connected_to: 'LON PE (10.2.1.254)' },
    { name: 'port2', ip: '172.18.0.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'LAN - Office Switch', rx_bytes: 195000000, tx_bytes: 128000000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'LAN', allowaccess: 'ping https ssh', connected_to: 'LON-SW1' },
    { name: 'port3', ip: '10.2.2.1', mask: '255.255.255.0', status: 'down', speed: '1Gbps', duplex: 'N/A', type: 'physical', vdom: 'root', mtu: 1500, description: 'WAN2 backup (cable unplugged)', rx_bytes: 14000000, tx_bytes: 8200000, rx_errors: 42, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'WAN', allowaccess: 'ping', connected_to: 'LON ISP-B' },
  ],
  '6': [
    { name: 'port1', ip: '10.4.1.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'WAN - Internet', rx_bytes: 450000000, tx_bytes: 280000000, rx_errors: 0, tx_errors: 0, media: 'RJ45 1000BASE-T', zone: 'WAN', allowaccess: 'ping https ssh', connected_to: 'SYD PE (10.4.1.254)' },
    { name: 'port2', ip: '172.20.0.1', mask: '255.255.255.0', status: 'up', speed: '1Gbps', duplex: 'full', type: 'physical', vdom: 'root', mtu: 1500, description: 'LAN - Office Switch', rx_bytes: 320000000, tx_bytes: 210000000, rx_errors: 8, tx_errors: 3, media: 'RJ45 1000BASE-T', zone: 'LAN', allowaccess: 'ping https ssh', connected_to: 'SYD-SW1' },
  ],
};

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function isNeighborUp(state: NeighborState): boolean {
  return state === 'established' || state === 'full';
}

function stateColor(state: NeighborState): string {
  if (state === 'established' || state === 'full') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
  if (state === '2-way' || state === 'loading' || state === 'openconfirm' || state === 'opensent') return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
  return 'text-red-400 bg-red-400/10 border-red-400/30';
}

function InterfacePort({ iface, index }: { iface: InterfaceDetail; index: number }) {
  const [hover, setHover] = useState(false);
  const linkColor = iface.status === 'up' ? 'bg-emerald-400' : iface.status === 'admin-down' ? 'bg-slate-500' : 'bg-red-400';
  const borderColor = iface.status === 'up' ? 'border-emerald-500/40' : iface.status === 'admin-down' ? 'border-slate-600' : 'border-red-500/40';
  const isPhysical = iface.type === 'physical';
  const bgGlow = iface.status === 'up' ? 'shadow-emerald-500/20' : iface.status === 'down' ? 'shadow-red-500/20' : '';

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={clsx(
        'flex flex-col items-center gap-1 p-2 rounded-lg border transition-all cursor-pointer',
        borderColor, bgGlow,
        isPhysical ? 'bg-dark-900/80' : 'bg-dark-800/60 border-dashed',
        hover && 'scale-105 z-10'
      )}>
        <div className={clsx('w-3 h-3 rounded-full', linkColor, iface.status === 'up' && 'animate-pulse')} />
        <span className="text-[10px] font-mono text-slate-300 leading-tight text-center">{iface.name}</span>
        {iface.ip && <span className="text-[9px] font-mono text-slate-500">{iface.ip}</span>}
      </div>

      {hover && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl p-3 z-50 text-xs animate-fade-in pointer-events-none">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-slate-100">{iface.name}</span>
            <span className={clsx('px-2 py-0.5 rounded-full border text-[10px] font-medium', stateColor(iface.status === 'up' ? 'established' : iface.status === 'admin-down' ? 'idle' : 'down'))}>
              {iface.status.toUpperCase()}
            </span>
          </div>
          {iface.description && <p className="text-slate-400 mb-2 italic">{iface.description}</p>}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-slate-500">IP:</span>
            <span className="text-slate-200 font-mono">{iface.ip ? `${iface.ip}/${iface.mask}` : 'N/A'}</span>
            <span className="text-slate-500">Type:</span>
            <span className="text-slate-200">{iface.type}{iface.vlan_id ? ` (VLAN ${iface.vlan_id})` : ''}</span>
            <span className="text-slate-500">VDOM:</span>
            <span className="text-primary-400">{iface.vdom}</span>
            <span className="text-slate-500">Speed:</span>
            <span className="text-slate-200">{iface.speed} / {iface.duplex}</span>
            <span className="text-slate-500">Media:</span>
            <span className="text-slate-200">{iface.media}</span>
            <span className="text-slate-500">MTU:</span>
            <span className="text-slate-200">{iface.mtu}</span>
            {iface.zone && <>
              <span className="text-slate-500">Zone:</span>
              <span className="text-amber-400">{iface.zone}</span>
            </>}
            {iface.allowaccess && <>
              <span className="text-slate-500">Access:</span>
              <span className="text-slate-200">{iface.allowaccess}</span>
            </>}
            {iface.connected_to && <>
              <span className="text-slate-500">Connected:</span>
              <span className="text-cyan-400">{iface.connected_to}</span>
            </>}
          </div>
          <div className="flex gap-4 mt-2 pt-2 border-t border-dark-700">
            <div>
              <span className="text-slate-500">RX: </span>
              <span className="text-primary-400">{formatBytes(iface.rx_bytes)}</span>
              {iface.rx_errors > 0 && <span className="text-red-400 ml-1">({iface.rx_errors} err)</span>}
            </div>
            <div>
              <span className="text-slate-500">TX: </span>
              <span className="text-purple-400">{formatBytes(iface.tx_bytes)}</span>
              {iface.tx_errors > 0 && <span className="text-red-400 ml-1">({iface.tx_errors} err)</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Routing() {
  const { scope } = useScope();
  const [protocol, setProtocol] = useState<ProtocolType>('bgp');
  const [search, setSearch] = useState('');
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [realBGP, setRealBGP] = useState<BGPNeighbor[]>([]);
  const [realOSPF, setRealOSPF] = useState<OSPFNeighbor[]>([]);
  const [realDevices, setRealDevices] = useState<typeof scopeDevices>([]);
  const [loading, setLoading] = useState(false);

  // Load real devices and routing data from API
  const loadRoutingData = async () => {
    setLoading(true);
    try {
      const res = await deviceService.getAll();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = res.data as any[];
      if (!Array.isArray(list) || list.length === 0) { setLoading(false); return; }

      const devs = list.map((d) => {
        const dev = mapBackendDevice(d);
        return { id: dev.id, name: dev.name, vdoms: Array.isArray(d.vdom_list) ? d.vdom_list : ['root'] };
      });
      setRealDevices(devs);

      const bgpAll: BGPNeighbor[] = [];
      const ospfAll: OSPFNeighbor[] = [];

      await Promise.allSettled(devs.map(async (dev) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bgpRes = await deviceService.getBgpNeighbors(dev.id) as any;
          const neighbors = bgpRes.data?.bgp_neighbors || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          neighbors.forEach((n: any, i: number) => {
            bgpAll.push({
              id: `real-bgp-${dev.id}-${i}`,
              device_id: dev.id,
              device_name: dev.name,
              vdom: n.vdom || 'root',
              neighbor_ip: n.neighbor_ip || '',
              remote_as: n.remote_as || 0,
              local_as: n.local_as || 0,
              state: (n.state || 'down').toLowerCase() as NeighborState,
              uptime: n.uptime || '—',
              prefixes_received: n.prefixes_received || 0,
              prefixes_sent: n.prefixes_sent || 0,
              description: n.description || '',
            });
          });
        } catch { /* skip */ }

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ospfRes = await deviceService.getOspfNeighbors(dev.id) as any;
          const neighbors = ospfRes.data?.ospf_neighbors || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          neighbors.forEach((n: any, i: number) => {
            ospfAll.push({
              id: `real-ospf-${dev.id}-${i}`,
              device_id: dev.id,
              device_name: dev.name,
              vdom: n.vdom || 'root',
              neighbor_id: n.neighbor_id || n.neighbor_ip || '',
              neighbor_ip: n.neighbor_ip || '',
              area: n.area || '0.0.0.0',
              state: (n.state || 'down').toLowerCase() as NeighborState,
              interface_name: n.interface_name || n.interface || '',
              priority: n.priority || 0,
              dead_timer: n.dead_timer || '—',
              uptime: n.uptime || '—',
            });
          });
        } catch { /* skip */ }
      }));

      if (bgpAll.length > 0) setRealBGP(bgpAll);
      if (ospfAll.length > 0) setRealOSPF(ospfAll);
    } catch {
      // Ignore errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoutingData();
  }, []);

  // Use real data if available, fallback to mock
  const activeBGP = realBGP.length > 0 ? realBGP : mockBGPNeighbors;
  const activeOSPF = realOSPF.length > 0 ? realOSPF : mockOSPFNeighbors;

  const deviceId = scope.deviceId;
  const vdom = scope.vdom;

  const bgpFiltered = useMemo(() => {
    const q = search.toLowerCase();
    return activeBGP.filter((n) => {
      const devMatch = deviceId === 'all' || n.device_id === deviceId;
      const vdomMatch = vdom === 'all' || n.vdom === vdom;
      const textMatch = n.neighbor_ip.includes(q) || n.description.toLowerCase().includes(q) || n.device_name.toLowerCase().includes(q);
      return devMatch && vdomMatch && textMatch;
    });
  }, [deviceId, vdom, search, activeBGP]);

  const ospfFiltered = useMemo(() => {
    const q = search.toLowerCase();
    return activeOSPF.filter((n) => {
      const devMatch = deviceId === 'all' || n.device_id === deviceId;
      const vdomMatch = vdom === 'all' || n.vdom === vdom;
      const textMatch = n.neighbor_ip.includes(q) || n.neighbor_id.includes(q) || n.device_name.toLowerCase().includes(q);
      return devMatch && vdomMatch && textMatch;
    });
  }, [deviceId, vdom, search, activeOSPF]);

  const bgpUp = bgpFiltered.filter((n) => isNeighborUp(n.state)).length;
  const bgpDown = bgpFiltered.length - bgpUp;
  const ospfUp = ospfFiltered.filter((n) => isNeighborUp(n.state)).length;
  const ospfDown = ospfFiltered.length - ospfUp;

  const interfaceDevices = useMemo(() => {
    // Use realDevices if available, otherwise fallback to scopeDevices
    const devices = realDevices.length > 0 ? realDevices : scopeDevices;
    if (deviceId !== 'all') {
      const dev = devices.find((d) => d.id === deviceId);
      if (!dev) return [];
      return [dev];
    }
    return devices;
  }, [deviceId, realDevices]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setProtocol('bgp')}
            className={clsx('btn-secondary text-sm', protocol === 'bgp' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
          >
            <ArrowRightLeft className="w-4 h-4" /> BGP Neighbors
          </button>
          <button
            onClick={() => setProtocol('ospf')}
            className={clsx('btn-secondary text-sm', protocol === 'ospf' && 'bg-primary-500/20 text-primary-300 border-primary-500/30')}
          >
            <Router className="w-4 h-4" /> OSPF Neighbors
          </button>
          <button
            onClick={loadRoutingData}
            disabled={loading}
            className="btn-secondary text-sm"
            title="Refresh routing data"
          >
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
        <div className="relative max-w-xs w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search neighbors..."
            className="input-dark pl-9 w-full"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-primary-400/10 rounded-lg"><Network className="w-4 h-4 text-primary-400" /></div>
          <div>
            <p className="text-xl font-bold text-slate-100">{protocol === 'bgp' ? bgpFiltered.length : ospfFiltered.length}</p>
            <p className="text-xs text-slate-400">Total Neighbors</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-emerald-400/10 rounded-lg"><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div>
          <div>
            <p className="text-xl font-bold text-emerald-400">{protocol === 'bgp' ? bgpUp : ospfUp}</p>
            <p className="text-xs text-slate-400">{protocol === 'bgp' ? 'Established' : 'Full'}</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-red-400/10 rounded-lg"><XCircle className="w-4 h-4 text-red-400" /></div>
          <div>
            <p className="text-xl font-bold text-red-400">{protocol === 'bgp' ? bgpDown : ospfDown}</p>
            <p className="text-xs text-slate-400">Down / Other</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2 bg-purple-400/10 rounded-lg"><Info className="w-4 h-4 text-purple-400" /></div>
          <div>
            <p className="text-xl font-bold text-purple-400">{protocol === 'bgp' ? bgpFiltered.reduce((s, n) => s + n.prefixes_received, 0).toLocaleString() : ospfFiltered.filter((n) => n.state === 'full').length}</p>
            <p className="text-xs text-slate-400">{protocol === 'bgp' ? 'Prefixes RX' : 'Full Adjacencies'}</p>
          </div>
        </div>
      </div>

      {/* BGP Table */}
      {protocol === 'bgp' && (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700 text-left">
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Device</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">VDOM</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Neighbor IP</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Remote AS</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Local AS</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">State</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Uptime</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase text-right">Prefixes RX</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase text-right">Prefixes TX</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Description</th>
                </tr>
              </thead>
              <tbody>
                {bgpFiltered.map((n) => (
                  <tr key={n.id} className="border-b border-dark-700/50 table-row-hover">
                    <td className="px-3 py-2.5 text-slate-200 font-medium">{n.device_name}</td>
                    <td className="px-3 py-2.5 text-primary-400 text-xs">{n.vdom}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{n.neighbor_ip}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{n.remote_as}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{n.local_as}</td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border', stateColor(n.state))}>
                        {isNeighborUp(n.state) ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {n.state}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-300">{n.uptime || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-right font-mono text-slate-300">{n.prefixes_received.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-xs text-right font-mono text-slate-300">{n.prefixes_sent.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400 max-w-[180px] truncate">{n.description}</td>
                  </tr>
                ))}
                {bgpFiltered.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-12 text-slate-500">No BGP neighbors found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* OSPF Table */}
      {protocol === 'ospf' && (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700 text-left">
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Device</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">VDOM</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Neighbor ID</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Neighbor IP</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Area</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Interface</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">State</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Priority</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Dead Timer</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-400 uppercase">Uptime</th>
                </tr>
              </thead>
              <tbody>
                {ospfFiltered.map((n) => (
                  <tr key={n.id} className="border-b border-dark-700/50 table-row-hover">
                    <td className="px-3 py-2.5 text-slate-200 font-medium">{n.device_name}</td>
                    <td className="px-3 py-2.5 text-primary-400 text-xs">{n.vdom}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{n.neighbor_id}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{n.neighbor_ip}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{n.area}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-cyan-400">{n.interface_name}</td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border', stateColor(n.state))}>
                        {isNeighborUp(n.state) ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {n.state}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-300 text-center">{n.priority}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{n.dead_timer}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-300">{n.uptime || '—'}</td>
                  </tr>
                ))}
                {ospfFiltered.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-12 text-slate-500">No OSPF neighbors found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interface / Port Map */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary-400" /> Interface Port Map
          <span className="text-slate-500 font-normal ml-2">Hover any port to see full details</span>
        </h3>
        {interfaceDevices.map((dev) => {
          const ifaces = mockInterfaces[dev.id] || [];
          if (ifaces.length === 0) return null;
          const physical = ifaces.filter((i) => i.type === 'physical');
          const virtual = ifaces.filter((i) => i.type !== 'physical');
          const isExpanded = expandedDevice === dev.id || deviceId !== 'all';

          return (
            <div key={dev.id} className="glass-card overflow-hidden">
              <button
                onClick={() => setExpandedDevice(expandedDevice === dev.id ? null : dev.id)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-dark-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Network className="w-4 h-4 text-primary-400" />
                  <span className="text-sm font-semibold text-slate-100">{dev.name}</span>
                  <span className="text-xs text-slate-500">{ifaces.length} interfaces</span>
                  <span className="text-xs text-emerald-400">{ifaces.filter((i) => i.status === 'up').length} up</span>
                  <span className="text-xs text-red-400">{ifaces.filter((i) => i.status === 'down').length} down</span>
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              </button>
              {isExpanded && (
                <div className="px-5 pb-5 space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Physical Ports</p>
                    <div className="flex flex-wrap gap-2">
                      {physical.map((iface, i) => (
                        <InterfacePort key={iface.name} iface={iface} index={i} />
                      ))}
                    </div>
                  </div>
                  {virtual.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Virtual / Tunnel / VLAN</p>
                      <div className="flex flex-wrap gap-2">
                        {virtual.map((iface, i) => (
                          <InterfacePort key={iface.name} iface={iface} index={i} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
