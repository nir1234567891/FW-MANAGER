# FortiManager Pro

A comprehensive FortiGate management system with a professional dark-themed UI, interactive VPN tunnel topology mapping, backup management with diff comparison, real-time monitoring dashboards, and much more.

## Features

- **Dashboard** - Overview of all devices, alerts, traffic graphs, and system health
- **Device Management** - Full CRUD for FortiGate devices with connection testing via FortiOS REST API
- **VPN Tunnel Topology Map** - Interactive network visualization showing all IPsec tunnels between devices with status indicators
- **Backup Management** - Create, schedule, and manage configuration backups with side-by-side diff comparison
- **Real-Time Monitoring** - CPU, memory, session counts, and network throughput graphs
- **Policy Management** - View and manage firewall policies across all devices and VDOMs
- **Alerts & Notifications** - Severity-based alerting with acknowledgment workflow
- **VDOM Support** - Full VDOM awareness across all features
- **Settings** - Configurable auto-backup schedules, notification preferences, and API settings

## Tech Stack

### Backend
- **Python 3.10+** with **FastAPI**
- **SQLAlchemy** (async) with **SQLite**
- **httpx** for FortiGate REST API communication
- **Pydantic** for data validation

### Frontend
- **React 18** with **TypeScript**
- **Vite** for build tooling
- **Tailwind CSS** for styling (dark theme)
- **Recharts** for graphs and charts
- **@xyflow/react** (React Flow) for topology visualization
- **react-diff-viewer-continued** for config comparison
- **lucide-react** for icons

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- npm

### Backend
```bash
cd backend
pip install -r requirements.txt
python run.py
```
The API server starts at `http://localhost:8000` with interactive docs at `http://localhost:8000/docs`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
The UI is available at `http://localhost:5173`.

## Demo Data

On first startup, the backend automatically seeds demo data:
- **6 FortiGate devices**: FW-HQ-01 (600E), FW-DC-01 (1000E), FW-BRANCH-01/02 (100F), FW-DR-01 (600E, offline), FW-CLOUD-01 (VM02)
- **11 VDOMs** across all devices (root, DMZ, GUEST, SERVERS, MGMT, DR-SERVERS)
- **14 IPsec VPN tunnels** in a hub-and-spoke topology
- **18 configuration backups** (3 per device)
- **88 firewall policies** (8 templates per VDOM)
- **12 alerts** with varying severity levels

## Project Structure

```
FortiManager-Pro/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app with demo data seeder
│   │   ├── config.py            # Application settings
│   │   ├── database.py          # Async SQLAlchemy setup
│   │   ├── models.py            # Database models
│   │   ├── routers/
│   │   │   ├── devices.py       # Device CRUD + FortiGate API integration
│   │   │   ├── backups.py       # Backup management
│   │   │   ├── tunnels.py       # Tunnel mapping & topology
│   │   │   ├── monitoring.py    # Performance monitoring & alerts
│   │   │   └── policies.py      # Firewall policy management
│   │   └── services/
│   │       ├── fortigate_api.py # FortiGate REST API client
│   │       ├── backup_service.py # Backup operations & comparison
│   │       ├── tunnel_mapper.py  # Tunnel discovery & topology builder
│   │       └── config_diff.py   # Configuration diff engine
│   ├── requirements.txt
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Application pages
│   │   ├── services/            # API service layer
│   │   ├── types/               # TypeScript type definitions
│   │   └── App.tsx              # Main app with routing
│   ├── package.json
│   └── vite.config.ts
└── backups/                     # Configuration backup storage
```

## Connecting Real FortiGate Devices

To connect real FortiGate devices:

1. Generate an API token on your FortiGate: **System > Administrators > Create New > REST API Admin**
2. Add the device through the UI or API with the FortiGate's IP address, port (443), and API token
3. The system will automatically discover VDOMs, tunnels, interfaces, and policies

## API Documentation

Once the backend is running, visit `http://localhost:8000/docs` for the interactive Swagger UI documentation.
