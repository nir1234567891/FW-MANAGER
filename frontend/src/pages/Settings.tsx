import { useState, useEffect } from 'react';
import {
  Save, Settings as SettingsIcon, DatabaseBackup, Bell, Globe,
  Palette, Info, RotateCcw, Check, Sun, Moon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettings, applyTheme, type AppSettings } from '../hooks/useSettings';

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative w-11 h-6 rounded-full transition-colors duration-200',
          checked ? 'bg-primary-500' : 'bg-dark-600'
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200',
            checked && 'translate-x-5'
          )}
        />
      </button>
    </div>
  );
}

function SettingsSection({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="glass-card p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-4">
        <Icon className="w-4 h-4 text-primary-400" />
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SettingsInput({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-slate-300 mb-1.5">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-dark" />
    </div>
  );
}

function SettingsSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm text-slate-300 mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-dark">
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </div>
  );
}

export default function Settings() {
  const { settings: savedSettings, setSettings, resetSettings, defaultSettings } = useSettings();

  const [draft, setDraft] = useState<AppSettings>(savedSettings);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(savedSettings);
  }, [savedSettings]);

  useEffect(() => {
    const changed = JSON.stringify(draft) !== JSON.stringify(savedSettings);
    setDirty(changed);
  }, [draft, savedSettings]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    // Apply visual changes (dark mode, accent) immediately as live preview
    if (key === 'darkMode' || key === 'accentColor') {
      applyTheme(next);
    }
  };

  const handleSave = () => {
    setSettings(draft);
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setDraft({ ...defaultSettings });
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Settings</h2>
          <p className="text-sm text-slate-400 mt-0.5">Configure application preferences and defaults</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="text-xs text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-full">
              Unsaved changes
            </span>
          )}
          <button onClick={handleReset} className="btn-secondary text-sm" title="Reset to defaults">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty && !saved}
            className={clsx(
              'btn-primary text-sm transition-all',
              saved && 'bg-emerald-500 hover:bg-emerald-600',
              !dirty && !saved && 'opacity-50 cursor-not-allowed'
            )}
          >
            {saved ? <><Check className="w-4 h-4" /> Saved!</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </button>
        </div>
      </div>

      <SettingsSection title="General Settings" icon={SettingsIcon}>
        <SettingsInput label="Application Name" value={draft.appName} onChange={(v) => update('appName', v)} />
        <SettingsSelect
          label="Auto-Refresh Interval"
          value={draft.refreshInterval}
          onChange={(v) => update('refreshInterval', v)}
          options={[
            { value: '5', label: '5 seconds' },
            { value: '10', label: '10 seconds' },
            { value: '30', label: '30 seconds' },
            { value: '60', label: '1 minute' },
            { value: '300', label: '5 minutes' },
          ]}
        />
        <SettingsSelect
          label="Timezone"
          value={draft.timezone}
          onChange={(v) => update('timezone', v)}
          options={[
            { value: 'UTC', label: 'UTC' },
            { value: 'Asia/Jerusalem', label: 'Asia/Jerusalem (IST)' },
            { value: 'US/Eastern', label: 'US/Eastern (EST/EDT)' },
            { value: 'US/Central', label: 'US/Central (CST/CDT)' },
            { value: 'US/Pacific', label: 'US/Pacific (PST/PDT)' },
            { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
            { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
            { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
            { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Backup Settings" icon={DatabaseBackup}>
        <SettingsSelect
          label="Auto-Backup Schedule"
          value={draft.autoBackupSchedule}
          onChange={(v) => update('autoBackupSchedule', v)}
          options={[
            { value: 'disabled', label: 'Disabled' },
            { value: 'hourly', label: 'Every Hour' },
            { value: 'daily', label: 'Daily (02:00 AM)' },
            { value: 'weekly', label: 'Weekly (Sunday 02:00 AM)' },
            { value: 'monthly', label: 'Monthly (1st, 02:00 AM)' },
          ]}
        />
        <SettingsSelect
          label="Retention Period"
          value={draft.retentionDays}
          onChange={(v) => update('retentionDays', v)}
          options={[
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: '30', label: '30 days' },
            { value: '60', label: '60 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '1 year' },
          ]}
        />
        <SettingsInput label="Backup Directory" value={draft.backupDir} onChange={(v) => update('backupDir', v)} placeholder="/var/backups/fortimanager" />
      </SettingsSection>

      <SettingsSection title="Notification Settings" icon={Bell}>
        <Toggle label="Email Alerts" description="Send alert notifications via email" checked={draft.emailAlerts} onChange={(v) => update('emailAlerts', v)} />
        {draft.emailAlerts && (
          <div className="pl-4 border-l-2 border-dark-600 space-y-3 ml-2">
            <SettingsInput label="SMTP Server" value={draft.smtpServer} onChange={(v) => update('smtpServer', v)} placeholder="smtp.company.com" />
            <SettingsInput label="Recipient" value={draft.alertRecipient} onChange={(v) => update('alertRecipient', v)} placeholder="netops@company.com" type="email" />
          </div>
        )}
        <Toggle label="SNMP Traps" description="Send SNMP trap notifications to monitoring systems" checked={draft.snmpAlerts} onChange={(v) => update('snmpAlerts', v)} />
        <Toggle label="Syslog Forwarding" description="Forward alerts to remote syslog server" checked={draft.syslogAlerts} onChange={(v) => update('syslogAlerts', v)} />
      </SettingsSection>

      <SettingsSection title="API Settings" icon={Globe}>
        <SettingsInput label="Default API Port" value={draft.defaultPort} onChange={(v) => update('defaultPort', v)} type="number" />
        <SettingsInput label="Connection Timeout (seconds)" value={draft.connTimeout} onChange={(v) => update('connTimeout', v)} type="number" />
        <Toggle label="SSL Verification" description="Verify SSL certificates when connecting to FortiGate devices" checked={draft.sslVerify} onChange={(v) => update('sslVerify', v)} />
      </SettingsSection>

      <SettingsSection title="Appearance" icon={Palette}>
        {/* Dark / Light mode toggle */}
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm text-slate-200">Color Scheme</p>
            <p className="text-xs text-slate-500 mt-0.5">Switch between dark and light interface</p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-dark-900 rounded-xl border border-dark-600">
            <button
              onClick={() => update('darkMode', true)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200',
                draft.darkMode
                  ? 'bg-dark-700 text-slate-100 shadow'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              <Moon className="w-3.5 h-3.5" /> Dark
            </button>
            <button
              onClick={() => update('darkMode', false)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200',
                !draft.darkMode
                  ? 'bg-amber-400/20 text-amber-300 shadow'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              <Sun className="w-3.5 h-3.5" /> Light
            </button>
          </div>
        </div>

        {/* Accent color picker */}
        <div className="flex items-center gap-4 pt-1">
          <p className="text-sm text-slate-300 shrink-0">Accent Color</p>
          <div className="flex gap-2.5 flex-wrap">
            {[
              { color: '#06b6d4', name: 'Cyan'   },
              { color: '#3b82f6', name: 'Blue'   },
              { color: '#8b5cf6', name: 'Purple' },
              { color: '#10b981', name: 'Green'  },
              { color: '#f59e0b', name: 'Amber'  },
              { color: '#ef4444', name: 'Red'    },
              { color: '#ec4899', name: 'Pink'   },
            ].map(({ color, name }) => (
              <button
                key={color}
                onClick={() => update('accentColor', color)}
                title={name}
                className={clsx(
                  'w-8 h-8 rounded-full transition-all duration-200 hover:scale-110 focus:outline-none',
                  color === draft.accentColor
                    ? 'ring-2 ring-offset-2 ring-offset-dark-800 scale-110'
                    : 'opacity-70 hover:opacity-100'
                )}
                style={{ backgroundColor: color, '--tw-ring-color': color } as React.CSSProperties}
              />
            ))}
            {/* Custom color input */}
            <label title="Custom color" className="w-8 h-8 rounded-full border-2 border-dashed border-dark-500 hover:border-slate-400 flex items-center justify-center cursor-pointer transition-colors overflow-hidden">
              <input
                type="color"
                value={draft.accentColor}
                onChange={(e) => update('accentColor', e.target.value)}
                className="opacity-0 absolute w-0 h-0"
              />
              <span className="text-[10px] text-slate-500">+</span>
            </label>
          </div>
        </div>

        {/* Live preview strip */}
        <div className="mt-3 p-3 rounded-lg border border-dark-600 bg-dark-900/50 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: draft.accentColor }}>
            <Palette className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Preview</p>
            <p className="text-sm font-medium" style={{ color: draft.accentColor }}>{draft.appName}</p>
          </div>
          <div className="ml-auto flex gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${draft.accentColor}22`, color: draft.accentColor }}>
              badge
            </span>
            <button className="text-xs px-2.5 py-1 rounded-lg font-medium text-white" style={{ backgroundColor: draft.accentColor }}>
              button
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="About" icon={Info}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Application', value: draft.appName },
            { label: 'Version', value: '1.0.0' },
            { label: 'Build', value: '2026.03.25' },
            { label: 'License', value: 'Enterprise' },
            { label: 'Author', value: 'Network Operations Team' },
            { label: 'Support', value: 'support@company.com' },
          ].map((item) => (
            <div key={item.label} className="bg-dark-900/50 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
              <p className="text-sm text-slate-200 mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
