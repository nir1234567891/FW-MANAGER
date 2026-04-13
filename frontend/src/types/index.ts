export interface Device {
  id: string;
  name: string;
  ip_address: string;
  port: number;
  api_key: string;
  hostname: string;
  model: string;
  firmware: string;
  serial_number: string;
  status: 'online' | 'offline' | 'warning' | 'unknown';
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
  session_count: number;
  uptime: number;
  vdom_count: number;
  last_seen: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface VDOM {
  name: string;
  status: string;
  type: string;
  policy_count: number;
  interface_count: number;
}

export interface DeviceInterface {
  name: string;
  ip: string;
  status: 'up' | 'down';
  speed: string;
  type: string;
  vdom: string;
  rx_bytes: number;
  tx_bytes: number;
}

export interface Route {
  destination: string;
  gateway: string;
  interface: string;
  distance: number;
  metric: number;
  type: string;
}

export interface VPNTunnel {
  id: string;
  name: string;
  type: 'ipsec' | 'ssl';
  status: 'up' | 'down';
  source_device_id: string;
  source_device_name: string;
  dest_device_id: string;
  dest_device_name: string;
  source_ip: string;
  dest_ip: string;
  local_subnet: string;
  remote_subnet: string;
  incoming_bytes: number;
  outgoing_bytes: number;
  phase1_status: string;
  phase2_status: string;
  uptime: number;
  last_change: string;
  vdom_name?: string;
}

export interface Backup {
  id: string;
  device_id: string;
  device_name: string;
  vdom: string;
  backup_type: 'full' | 'vdom' | 'scheduled' | 'manual';
  file_size: number;
  file_hash: string;
  config_content: string;
  notes: string;
  created_at: string;
}

export interface Policy {
  id: number;
  name: string;
  source_interface: string;
  dest_interface: string;
  source_address: string;
  dest_address: string;
  service: string;
  action: 'accept' | 'deny' | 'ipsec';
  nat: boolean;
  log: boolean;
  status: 'enabled' | 'disabled';
  hit_count: number;
  schedule: string;
  comments: string;
}

export interface Alert {
  id: string;
  device_id: string;
  device_name: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  type: string;
  message: string;
  acknowledged: boolean;
  created_at: string;
}

export interface TopologyNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    device: Device;
  };
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  data: {
    tunnel: VPNTunnel;
  };
}

export interface TopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface PerformanceData {
  timestamp: string;
  cpu: number;
  memory: number;
  sessions: number;
  bandwidth_in: number;
  bandwidth_out: number;
}

export interface TrafficData {
  timestamp: string;
  incoming: number;
  outgoing: number;
}

export interface DiffResult {
  additions: number;
  deletions: number;
  modifications: number;
  old_content: string;
  new_content: string;
}

export interface MonitoringOverview {
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  active_tunnels: number;
  down_tunnels: number;
  total_policies: number;
  active_alerts: number;
  critical_alerts: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  status: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
