import type { Device } from '@/types';

/**
 * Parse backend uptime string like "142 days 7:23:15" or "56 days 3:12:45" to seconds.
 * Also handles null, undefined, and numeric values.
 */
function parseUptime(uptime: unknown): number {
  if (typeof uptime === 'number') return uptime;
  if (!uptime || typeof uptime !== 'string') return 0;
  const match = uptime.match(/(\d+)\s*days?\s*(?:(\d+):(\d+):(\d+))?/i);
  if (match) {
    const days = parseInt(match[1], 10) || 0;
    const hours = parseInt(match[2], 10) || 0;
    const minutes = parseInt(match[3], 10) || 0;
    const seconds = parseInt(match[4], 10) || 0;
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
}

/**
 * Map a backend device API response to the frontend Device type.
 * Handles null/undefined/empty fields with safe defaults.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapBackendDevice(d: any): Device {
  return {
    id: String(d.id ?? ''),
    name: d.name || 'Unknown',
    ip_address: d.ip_address || '',
    port: d.port || 443,
    api_key: d.api_key || '',
    hostname: d.hostname || d.name || '',
    model: d.model || 'Unknown Model',
    firmware: d.firmware_version || d.firmware || 'Unknown',
    serial_number: d.serial_number || 'N/A',
    status: (['online', 'offline', 'warning', 'unknown'].includes(d.status) ? d.status : 'unknown') as Device['status'],
    cpu_usage: typeof d.cpu_usage === 'number' ? d.cpu_usage : 0,
    memory_usage: typeof d.memory_usage === 'number' ? d.memory_usage : 0,
    disk_usage: typeof d.disk_usage === 'number' ? d.disk_usage : 0,
    session_count: typeof d.session_count === 'number' ? d.session_count : 0,
    uptime: parseUptime(d.uptime),
    vdom_count: Array.isArray(d.vdom_list) && d.vdom_list.length > 0 ? d.vdom_list.length : 1,
    last_seen: d.last_seen || new Date().toISOString(),
    notes: d.notes || '',
    created_at: d.created_at || '',
    updated_at: d.updated_at || '',
  };
}
