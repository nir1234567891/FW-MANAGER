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
  getBgpNeighbors: (id: string) => api.get(`/devices/${id}/bgp`),
  getOspfNeighbors: (id: string) => api.get(`/devices/${id}/ospf`),
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
  autoBackup: (data: { device_ids: string[]; schedule: string }) =>
    api.post('/backups/auto', data),
};

export const tunnelService = {
  getAll: () => api.get<VPNTunnel[]>('/tunnels'),
  getTopology: () => api.get<TopologyData>('/tunnels/topology'),
  discover: () => api.post('/tunnels/discover'),
  getSummary: () => api.get('/tunnels/summary'),
  getByDevice: (deviceId: string) => api.get<VPNTunnel[]>(`/tunnels/device/${deviceId}`),
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
};

export const policyService = {
  getByDevice: (deviceId: string, vdom?: string) =>
    api.get<Policy[]>(`/policies/${deviceId}`, { params: { vdom } }),
  getSummary: (deviceId: string) => api.get(`/policies/${deviceId}/summary`),
  sync: (deviceId: string) => api.post(`/policies/${deviceId}/sync`),
};

export default api;
