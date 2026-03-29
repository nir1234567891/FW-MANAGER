import { useCallback, useEffect, useState } from 'react';

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

export const scopeDevices: ScopeDevice[] = [
  { id: '1', name: 'FG-HQ-DC1', vdoms: ['root', 'DMZ', 'Guest'] },
  { id: '2', name: 'FG-HQ-DC2', vdoms: ['root', 'DMZ', 'Guest'] },
  { id: '3', name: 'FG-BRANCH-NYC', vdoms: ['root'] },
  { id: '4', name: 'FG-BRANCH-LON', vdoms: ['root'] },
  { id: '5', name: 'FG-BRANCH-TKY', vdoms: ['root'] },
  { id: '6', name: 'FG-BRANCH-SYD', vdoms: ['root'] },
];

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

  useEffect(() => {
    const refresh = () => setScopeState(loadScope());
    listeners.add(refresh);
    return () => void listeners.delete(refresh);
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

  const selectedDevice = scopeDevices.find((d) => d.id === scope.deviceId) || null;
  const availableVdoms = scope.deviceId === 'all'
    ? ['all']
    : ['all', ...(selectedDevice?.vdoms || ['root'])];

  return {
    scope,
    setScope,
    setDeviceId,
    setVdom,
    selectedDevice,
    devices: scopeDevices,
    availableVdoms,
  };
}

