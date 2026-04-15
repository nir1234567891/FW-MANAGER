import axios from 'axios';
import type {
  Device,
  DeviceInterface,
  Route,
  VDOM,
  VPNTunnel,
  Backup,
  Policy,
  Alert,
  PerformanceData,
  TopologyData,
  DiffResult,
  MonitoringOverview,
  TrafficData,
} from '@/types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const dashboardService = {
  getOverview: () => api.get('/dashboard/overview'),
};

export const deviceService = {
  getAll: () => api.get<Device[]>('/devices'),
  getById: (id: string) => api.get<Device>(`/devices/${id}`),
  create: (data: Partial<Device>) => api.post<Device>('/devices', data),
  update: (id: string, data: Partial<Device>) => api.put<Device>(`/devices/${id}`, data),
  delete: (id: string) => api.delete(`/devices/${id}`),
  refresh: (id: string) => api.post(`/devices/${id}/refresh`),
  getInterfaces: (id: string) => api.get<DeviceInterface[]>(`/devices/${id}/interfaces`),
  getRoutes: (id: string) => api.get<Route[]>(`/devices/${id}/routes`),
  getVdoms: (id: string) => api.get<VDOM[]>(`/devices/${id}/vdoms`),
  getPerformance: (id: string) => api.get<PerformanceData[]>(`/devices/${id}/performance`),
  getDashboard: (id: string) => api.get(`/devices/${id}/dashboard`),
  getInterfaceTraffic: (id: string) => api.get(`/devices/${id}/interfaces/traffic`),
  getInterfaceStats: (id: string) => api.get(`/devices/${id}/interfaces/statistics`),
  getRoutingSummary: (id: string) => api.get(`/devices/${id}/routes/summary`),
  getBgpNeighbors: (id: string) => api.get(`/devices/${id}/bgp`),
  getOspfNeighbors: (id: string) => api.get(`/devices/${id}/ospf`),
  getSystemGlobal: (id: string) => api.get(`/devices/${id}/system-global`),
};

export const backupService = {
  getAll: (params?: { device_id?: string; backup_type?: string }) =>
    api.get<Backup[]>('/backups', { params }),
  create: (data: { device_id: string; vdom?: string; notes?: string; backup_type?: string }) =>
    api.post<Backup>(`/backups/${data.device_id}`, {
      vdom_name: data.vdom,
      backup_type: data.backup_type || 'manual',
      notes: data.notes,
    }),
  download: (id: string) => api.get(`/backups/${id}/download`, { responseType: 'blob' }),
  getContent: (id: string) => api.get<{ content: string }>(`/backups/${id}/content`),
  compare: (id1: string, id2: string) =>
    api.get<DiffResult>(`/backups/compare?backup1=${id1}&backup2=${id2}`),
  delete: (id: string) => api.delete(`/backups/${id}`),
  autoBackup: () => api.post('/backups/auto'),
  backupAll: () => api.post('/backups/backup-all'),
};

export const tunnelService = {
  getAll: () => api.get<VPNTunnel[]>('/tunnels'),
  getTopology: () => api.get<TopologyData>('/tunnels/topology'),
  discover: () => api.post('/tunnels/discover'),
  getSummary: () => api.get('/tunnels/summary'),
  getByDevice: (deviceId: string) => api.get<VPNTunnel[]>(`/tunnels/${deviceId}`),
  getLive: (deviceId: string, vdom?: string) =>
    api.get(`/tunnels/${deviceId}/live`, { params: { vdom } }),
  getPhase1: (deviceId: string, vdom?: string) =>
    api.get(`/tunnels/${deviceId}/phase1`, { params: { vdom } }),
  getPhase2: (deviceId: string, vdom?: string) =>
    api.get(`/tunnels/${deviceId}/phase2`, { params: { vdom } }),
};

export const monitoringService = {
  getPerformance: (deviceId: string, period?: string) =>
    api.get<PerformanceData[]>(`/monitoring/${deviceId}/performance`, { params: { period } }),
  getTraffic: (deviceId: string, period?: string) =>
    api.get<TrafficData[]>(`/monitoring/${deviceId}/traffic`, { params: { period } }),
  getOverview: () => api.get<MonitoringOverview>('/monitoring/overview'),
  getAlerts: (params?: { severity?: string; acknowledged?: boolean }) =>
    api.get<Alert[]>('/monitoring/alerts', { params }),
  acknowledgeAlert: (id: string) => api.post(`/monitoring/alerts/${id}/acknowledge`),
  deleteAlert: (id: string) => api.delete(`/monitoring/alerts/${id}`),
  bulkAcknowledge: (params?: { severity?: string; device_id?: string }) =>
    api.post('/monitoring/alerts/bulk-acknowledge', null, { params }),
  deleteAcknowledged: () => api.delete('/monitoring/alerts/acknowledged'),
  evaluate: (deviceId?: string) =>
    api.post('/monitoring/evaluate', null, { params: deviceId ? { device_id: deviceId } : {} }),
};

export const policyService = {
  getByDevice: (deviceId: string, vdom?: string) =>
    api.get<Policy[]>(`/policies/${deviceId}`, { params: { vdom } }),
  getLive: (deviceId: string, vdom?: string) =>
    api.get(`/policies/${deviceId}/live`, { params: { vdom } }),
  getSummary: (deviceId: string) => api.get(`/policies/${deviceId}/summary`),
  sync: (deviceId: string, vdom?: string) =>
    api.post(`/policies/${deviceId}/sync`, null, { params: { vdom } }),
  syncAllVdoms: (deviceId: string) =>
    api.post(`/objects/${deviceId}/sync-all`),
};

export const cliService = {
  execute: (deviceId: string, command: string, vdom?: string) =>
    api.post(`/cli/${deviceId}/execute`, { command, vdom: vdom || 'root' }),
};

export const objectService = {
  getAddresses: (deviceId: string, vdom?: string) =>
    api.get(`/objects/${deviceId}/addresses`, { params: { vdom } }),
  getServices: (deviceId: string, vdom?: string) =>
    api.get(`/objects/${deviceId}/services`, { params: { vdom } }),
  getAddressGroups: (deviceId: string, vdom?: string) =>
    api.get(`/objects/${deviceId}/address-groups`, { params: { vdom } }),
  getServiceGroups: (deviceId: string, vdom?: string) =>
    api.get(`/objects/${deviceId}/service-groups`, { params: { vdom } }),
  createAddress: (deviceId: string, data: Record<string, unknown>, vdom?: string) =>
    api.post(`/objects/${deviceId}/addresses`, data, { params: { vdom } }),
  createService: (deviceId: string, data: Record<string, unknown>, vdom?: string) =>
    api.post(`/objects/${deviceId}/services`, data, { params: { vdom } }),
  pushAddressToMany: (address: Record<string, unknown>, targets: { device_id: number; vdom: string }[]) =>
    api.post('/objects/push-to-many/addresses', { address, targets }),
  pushServiceToMany: (service: Record<string, unknown>, targets: { device_id: number; vdom: string }[]) =>
    api.post('/objects/push-to-many/services', { service, targets }),
};

export default api;
