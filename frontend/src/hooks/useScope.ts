import { useCallback, useEffect, useState } from 'react';
import { deviceService } from '@/services/api';
import { mapBackendDevice } from '@/utils/mapDevice';

export interface ScopeDevice {
  id: string;
  name: string;
  vdoms: string[];
}

export interface GlobalScopeState {
  deviceId: string; // "all" or device id
  vdom: string; // "all" or vdom name
}

const SCOPE_KEY = 'fortimanager-pro-global-scope';

const fallbackScopeDevices: ScopeDevice[] = [
  { id: '1', name: 'FG-HQ-DC1', vdoms: ['root', 'DMZ', 'Guest'] },
  { id: '2', name: 'FG-HQ-DC2', vdoms: ['root', 'DMZ', 'Guest'] },
  { id: '3', name: 'FG-BRANCH-NYC', vdoms: ['root'] },
  { id: '4', name: 'FG-BRANCH-LON', vdoms: ['root'] },
  { id: '5', name: 'FG-BRANCH-TKY', vdoms: ['root'] },
  { id: '6', name: 'FG-BRANCH-SYD', vdoms: ['root'] },
];

// Shared mutable state for devices loaded from API
let _scopeDevices: ScopeDevice[] = fallbackScopeDevices;
let _loaded = false;

export { _scopeDevices as scopeDevices };

const defaultScope: GlobalScopeState = { deviceId: 'all', vdom: 'all' };

function loadScope(): GlobalScopeState {
  try {
    const raw = localStorage.getItem(SCOPE_KEY);
    if (!raw) return defaultScope;
    return { ...defaultScope, ...JSON.parse(raw) };
  } catch {
    return defaultScope;
  }
}

function saveScope(state: GlobalScopeState) {
  try {
    localStorage.setItem(SCOPE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}

export function useScope() {
  const [scope, setScopeState] = useState<GlobalScopeState>(loadScope);
  const [devices, setDevices] = useState<ScopeDevice[]>(_scopeDevices);

  useEffect(() => {
    const refresh = () => setScopeState(loadScope());
    listeners.add(refresh);
    return () => void listeners.delete(refresh);
  }, []);

  // Load real devices from API once
  useEffect(() => {
    if (_loaded) {
      setDevices(_scopeDevices);
      return;
    }
    deviceService.getAll()
      .then((res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = res.data as any[];
        if (Array.isArray(list) && list.length > 0) {
          const mapped: ScopeDevice[] = list.map((d: any) => {
            const dev = mapBackendDevice(d);
            return {
              id: dev.id,
              name: dev.name,
              vdoms: Array.isArray(d.vdom_list) && d.vdom_list.length > 0
                ? d.vdom_list as string[]
                : ['root'],
            };
          });
          _scopeDevices = mapped;
          _loaded = true;
          setDevices(mapped);
        }
      })
      .catch(() => { /* keep fallback */ });
  }, []);

  const setScope = useCallback((next: GlobalScopeState) => {
    saveScope(next);
    setScopeState(next);
    notify();
  }, []);

  const setDeviceId = useCallback((deviceId: string) => {
    const prev = loadScope();
    const next: GlobalScopeState = {
      deviceId,
      vdom: deviceId === 'all' ? 'all' : prev.vdom === 'all' ? 'root' : prev.vdom,
    };
    saveScope(next);
    setScopeState(next);
    notify();
  }, []);

  const setVdom = useCallback((vdom: string) => {
    const next = { ...loadScope(), vdom };
    saveScope(next);
    setScopeState(next);
    notify();
  }, []);

  const selectedDevice = devices.find((d) => d.id === scope.deviceId) || null;
  const availableVdoms = scope.deviceId === 'all'
    ? ['all']
    : ['all', ...(selectedDevice?.vdoms || ['root'])];

  return {
    scope,
    setScope,
    setDeviceId,
    setVdom,
    selectedDevice,
    devices,
    availableVdoms,
  };
}

