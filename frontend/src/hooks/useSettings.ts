import { useState, useEffect, useCallback } from 'react';

export interface AppSettings {
  appName: string;
  refreshInterval: string;
  timezone: string;
  autoBackupSchedule: string;
  retentionDays: string;
  backupDir: string;
  emailAlerts: boolean;
  snmpAlerts: boolean;
  syslogAlerts: boolean;
  smtpServer: string;
  alertRecipient: string;
  defaultPort: string;
  connTimeout: string;
  sslVerify: boolean;
  darkMode: boolean;
  accentColor: string;
}

const STORAGE_KEY = 'fortimanager-pro-settings';

export const defaultSettings: AppSettings = {
  appName: 'FortiManager Pro',
  refreshInterval: '30',
  timezone: 'UTC',
  autoBackupSchedule: 'daily',
  retentionDays: '30',
  backupDir: '/var/backups/fortimanager',
  emailAlerts: true,
  snmpAlerts: false,
  syslogAlerts: true,
  smtpServer: 'smtp.company.com',
  alertRecipient: 'netops@company.com',
  defaultPort: '443',
  connTimeout: '10',
  sslVerify: true,
  darkMode: true,
  accentColor: '#06b6d4',
};

// Derived shades from a hex color
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return null;
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount));
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount));
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, Math.round(rgb.r * (1 - amount)));
  const g = Math.max(0, Math.round(rgb.g * (1 - amount)));
  const b = Math.max(0, Math.round(rgb.b * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Apply all visual settings to the DOM immediately
export function applyTheme(settings: AppSettings) {
  const root = document.documentElement;

  // ── Dark / Light mode ─────────────────────────────────
  if (settings.darkMode) {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
  }

  // ── Accent color CSS variables ─────────────────────────
  const accent = settings.accentColor;
  const rgb = hexToRgb(accent);
  const rgbStr = rgb ? `${rgb.r} ${rgb.g} ${rgb.b}` : '6 182 212';

  root.style.setProperty('--accent',         accent);
  root.style.setProperty('--accent-rgb',     rgbStr);
  root.style.setProperty('--accent-light',   lighten(accent, 0.15));
  root.style.setProperty('--accent-dark',    darken(accent, 0.15));
  root.style.setProperty('--accent-darker',  darken(accent, 0.30));
  root.style.setProperty('--accent-subtle',  `rgba(${rgbStr} / 0.10)`);
  root.style.setProperty('--accent-border',  `rgba(${rgbStr} / 0.30)`);
  root.style.setProperty('--accent-glow',    `rgba(${rgbStr} / 0.15)`);

  // ── Page title ─────────────────────────────────────────
  document.title = settings.appName;
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultSettings };
}

function persistSettings(s: AppSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Global listener bus so every component that calls useSettings() stays in sync
const listeners = new Set<() => void>();
function notifyAll() { listeners.forEach((fn) => fn()); }

export function useSettings() {
  const [settings, setLocal] = useState<AppSettings>(loadSettings);

  // Re-sync when another component calls setSettings()
  useEffect(() => {
    const refresh = () => setLocal(loadSettings());
    listeners.add(refresh);
    return () => { listeners.delete(refresh); };
  }, []);

  // Apply theme on first mount
  useEffect(() => {
    applyTheme(settings);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSettings = useCallback((next: AppSettings) => {
    persistSettings(next);
    setLocal(next);
    applyTheme(next);
    notifyAll();
  }, []);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...loadSettings(), [key]: value };
    persistSettings(updated);
    setLocal(updated);
    applyTheme(updated);
    notifyAll();
  }, []);

  const resetSettings = useCallback(() => {
    persistSettings(defaultSettings);
    setLocal({ ...defaultSettings });
    applyTheme(defaultSettings);
    notifyAll();
  }, []);

  return { settings, setSettings, updateSetting, resetSettings, defaultSettings };
}
