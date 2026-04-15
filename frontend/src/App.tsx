import { Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import Dashboard from '@/pages/Dashboard';
import Devices from '@/pages/Devices';
import TunnelMap from '@/pages/TunnelMap';
import Backups from '@/pages/Backups';
import Monitoring from '@/pages/Monitoring';
import Policies from '@/pages/Policies';
import Alerts from '@/pages/Alerts';
import Routing from '@/pages/Routing';
import BulkCLI from '@/pages/BulkCLI';
import Compliance from '@/pages/Compliance';
import Logs from '@/pages/Logs';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/tunnel-map" element={<TunnelMap />} />
            <Route path="/routing" element={<Routing />} />
            <Route path="/bulk-cli" element={<BulkCLI />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/backups" element={<Backups />} />
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ToastProvider>
    </ErrorBoundary>
  );
}
