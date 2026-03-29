import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { applyTheme, defaultSettings } from './hooks/useSettings';

// Apply saved theme BEFORE first render to avoid flash of wrong theme
try {
  const raw = localStorage.getItem('fortimanager-pro-settings');
  const saved = raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  applyTheme(saved);
} catch {
  applyTheme(defaultSettings);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
