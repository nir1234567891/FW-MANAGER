"""Monitoring & Alerts router.

Endpoints:
  GET  /api/monitoring/overview              — Fleet-wide status summary
  GET  /api/monitoring/fleet-performance     — Live CPU/mem for all online devices
  GET  /api/monitoring/alerts                — List alerts (filterable)
  POST /api/monitoring/alerts/bulk-acknowledge — Bulk acknowledge (query: severity, device_id)
  DELETE /api/monitoring/alerts/acknowledged — Delete all acknowledged alerts
  POST /api/monitoring/alerts/{alert_id}/acknowledge — Acknowledge single alert
  DELETE /api/monitoring/alerts/{alert_id}   — Delete single alert
  POST /api/monitoring/evaluate              — Scan devices, generate alerts
  GET  /api/monitoring/{device_id}/performance — Live CPU/mem/disk/sessions
  GET  /api/monitoring/{device_id}/traffic   — Live interface stats + VPN byte counts

Route order matters: fixed-path routes MUST come before {device_id} parameterized routes.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Alert, Device, VPNTunnel
from app.schemas import AlertResponse, BulkAcknowledgeResult, BulkDeleteResult, EvaluationResult
from app.services.fortigate_api import FortiGateAPI
from app.services.utils import (
    extract_current,
    CPU_HIGH_THRESHOLD,
    CPU_CRITICAL_THRESHOLD,
    MEM_HIGH_THRESHOLD,
    MEM_CRITICAL_THRESHOLD,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _alert_to_dict(a: Alert, device_name: str) -> dict:
    return {
        "id": a.id,
        "device_id": a.device_id,
        "device_name": device_name,
        "severity": a.severity,
        "message": a.message,
        "alert_type": a.alert_type,
        "acknowledged": a.acknowledged,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


_extract_current = extract_current


# ---------------------------------------------------------------------------
# Fleet overview
# ---------------------------------------------------------------------------

@router.get("/overview")
async def monitoring_overview(db: AsyncSession = Depends(get_db)):
    """Fleet-wide status summary: device counts, performance averages, tunnel health, alert counts."""
    device_result = await db.execute(select(Device))
    devices = list(device_result.scalars().all())

    total = len(devices)
    online = sum(1 for d in devices if d.status == "online")
    offline = sum(1 for d in devices if d.status == "offline")
    unknown = total - online - offline

    avg_cpu = sum(d.cpu_usage or 0 for d in devices) / max(total, 1)
    avg_mem = sum(d.memory_usage or 0 for d in devices) / max(total, 1)
    total_sessions = sum(d.session_count or 0 for d in devices)

    tunnel_total_result = await db.execute(select(func.count(VPNTunnel.id)))
    tunnel_total = tunnel_total_result.scalar() or 0

    tunnel_up_result = await db.execute(
        select(func.count(VPNTunnel.id)).where(VPNTunnel.status == "up")
    )
    tunnel_up = tunnel_up_result.scalar() or 0

    unack_result = await db.execute(
        select(func.count(Alert.id)).where(Alert.acknowledged == False)  # noqa: E712
    )
    unack_alerts = unack_result.scalar() or 0

    critical_result = await db.execute(
        select(func.count(Alert.id)).where(
            Alert.acknowledged == False, Alert.severity == "critical"  # noqa: E712
        )
    )
    critical_alerts = critical_result.scalar() or 0

    high_result = await db.execute(
        select(func.count(Alert.id)).where(
            Alert.acknowledged == False, Alert.severity == "high"  # noqa: E712
        )
    )
    high_alerts = high_result.scalar() or 0

    return {
        "devices": {
            "total": total,
            "online": online,
            "offline": offline,
            "unknown": unknown,
        },
        "performance": {
            "avg_cpu_usage": round(avg_cpu, 1),
            "avg_memory_usage": round(avg_mem, 1),
            "total_sessions": total_sessions,
        },
        "tunnels": {
            "total": tunnel_total,
            "up": tunnel_up,
            "down": tunnel_total - tunnel_up,
            "health_percent": round((tunnel_up / tunnel_total * 100) if tunnel_total > 0 else 0, 1),
        },
        "alerts": {
            "unacknowledged": unack_alerts,
            "critical": critical_alerts,
            "high": high_alerts,
        },
        "devices_detail": [
            {
                "id": d.id,
                "name": d.name,
                "status": d.status,
                "model": d.model,
                "cpu_usage": d.cpu_usage or 0,
                "memory_usage": d.memory_usage or 0,
                "disk_usage": d.disk_usage or 0,
                "session_count": d.session_count or 0,
                "uptime": d.uptime,
                "last_seen": d.last_seen.isoformat() if d.last_seen else None,
            }
            for d in devices
        ],
    }


# ---------------------------------------------------------------------------
# Fleet-wide live performance (fixed path — must be before /{device_id}/*)
# ---------------------------------------------------------------------------

@router.get("/fleet-performance")
async def get_fleet_performance(db: AsyncSession = Depends(get_db)):
    """Get live CPU/memory for all online devices in parallel.

    Returns a dict keyed by device_id (as string).
    Falls back to DB values for devices that time out or error.
    """
    dev_result = await db.execute(select(Device))
    devices = list(dev_result.scalars().all())

    async def _fetch(device: Device) -> dict:
        base = {
            "device_id": device.id,
            "device_name": device.name,
            "status": device.status,
            "cpu_usage": device.cpu_usage or 0.0,
            "memory_usage": device.memory_usage or 0.0,
            "disk_usage": device.disk_usage or 0.0,
            "session_count": device.session_count or 0,
            "source": "database",
        }
        if device.status == "offline":
            return base
        try:
            api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
            resource = await api.get_resource_usage()
            if isinstance(resource, dict):
                cpu_arr = resource.get("cpu", [])
                mem_arr = resource.get("mem", [])
                disk_arr = resource.get("disk", [])
                sess_arr = resource.get("session", [])
                if isinstance(cpu_arr, list) and cpu_arr:
                    base["cpu_usage"] = float(cpu_arr[0].get("current", base["cpu_usage"]))
                if isinstance(mem_arr, list) and mem_arr:
                    base["memory_usage"] = float(mem_arr[0].get("current", base["memory_usage"]))
                if isinstance(disk_arr, list) and disk_arr:
                    base["disk_usage"] = float(disk_arr[0].get("current", base["disk_usage"]))
                if isinstance(sess_arr, list) and sess_arr:
                    base["session_count"] = int(sess_arr[0].get("current", base["session_count"]))
                base["source"] = "live"
        except Exception as exc:
            logger.debug("Fleet perf fetch failed for %s: %s", device.name, exc)
        return base

    results = await asyncio.gather(*[_fetch(d) for d in devices])
    return {str(r["device_id"]): r for r in results}


# ---------------------------------------------------------------------------
# Alert management — fixed paths BEFORE parameterized {alert_id} paths
# ---------------------------------------------------------------------------

@router.get("/alerts", response_model=list[AlertResponse])
async def get_alerts(
    severity: Optional[str] = Query(None, description="Filter by severity: critical, high, medium, low, info"),
    acknowledged: Optional[bool] = Query(None, description="Filter by acknowledged status"),
    device_id: Optional[int] = Query(None, description="Filter by device ID"),
    alert_type: Optional[str] = Query(None, description="Filter by alert_type (e.g. 'device_down', 'cpu_high')"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List alerts with optional filtering. Returns device_name for each alert."""
    stmt = select(Alert)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if acknowledged is not None:
        stmt = stmt.where(Alert.acknowledged == acknowledged)
    if device_id is not None:
        stmt = stmt.where(Alert.device_id == device_id)
    if alert_type:
        stmt = stmt.where(Alert.alert_type == alert_type)
    stmt = stmt.order_by(Alert.created_at.desc()).limit(limit).offset(offset)

    result = await db.execute(stmt)
    alerts = list(result.scalars().all())

    # Enrich with device names in a single query
    device_ids = list({a.device_id for a in alerts})
    device_map: dict[int, str] = {}
    if device_ids:
        dev_result = await db.execute(select(Device).where(Device.id.in_(device_ids)))
        for d in dev_result.scalars().all():
            device_map[d.id] = d.name

    return [
        AlertResponse(**_alert_to_dict(a, device_map.get(a.device_id, "Unknown")))
        for a in alerts
    ]


@router.post("/alerts/bulk-acknowledge", response_model=BulkAcknowledgeResult)
async def bulk_acknowledge_alerts(
    severity: Optional[str] = Query(None, description="Only acknowledge alerts of this severity"),
    device_id: Optional[int] = Query(None, description="Only acknowledge alerts for this device"),
    db: AsyncSession = Depends(get_db),
):
    """Bulk acknowledge all unacknowledged alerts, with optional filtering."""
    stmt = select(Alert).where(Alert.acknowledged == False)  # noqa: E712
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if device_id is not None:
        stmt = stmt.where(Alert.device_id == device_id)

    result = await db.execute(stmt)
    alerts = result.scalars().all()
    count = len(alerts)

    for alert in alerts:
        alert.acknowledged = True
    await db.flush()

    return BulkAcknowledgeResult(
        acknowledged=count,
        message=f"Acknowledged {count} alert(s)",
    )


@router.delete("/alerts/acknowledged", response_model=BulkDeleteResult)
async def delete_acknowledged_alerts(
    device_id: Optional[int] = Query(None, description="Only delete alerts for this device"),
    db: AsyncSession = Depends(get_db),
):
    """Delete all acknowledged alerts (cleanup old resolved alerts).

    Optionally filter by device_id to only clean up one device's alerts.
    """
    stmt = select(Alert).where(Alert.acknowledged == True)  # noqa: E712
    if device_id is not None:
        stmt = stmt.where(Alert.device_id == device_id)

    result = await db.execute(stmt)
    alerts = result.scalars().all()
    count = len(alerts)

    for alert in alerts:
        await db.delete(alert)
    await db.flush()

    return BulkDeleteResult(
        deleted=count,
        message=f"Deleted {count} acknowledged alert(s)",
    )


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    """Acknowledge a single alert by ID."""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.acknowledged = True
    await db.flush()
    return {"message": "Alert acknowledged", "alert_id": alert_id}


@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a single alert by ID."""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    await db.delete(alert)
    await db.flush()
    return {"message": "Alert deleted", "alert_id": alert_id}


# ---------------------------------------------------------------------------
# Alert evaluation (scan devices → generate alerts)
# ---------------------------------------------------------------------------

@router.post("/evaluate", response_model=EvaluationResult)
async def evaluate_device_health(
    device_id: Optional[int] = Query(None, description="Evaluate one device (omit for all devices)"),
    db: AsyncSession = Depends(get_db),
):
    """Scan devices and auto-generate alerts for detected issues.

    Evaluated conditions:
      - Device is offline          → critical  "device_down"
      - CPU >= 95%                 → critical  "cpu_critical"
      - CPU >= 85%                 → high      "cpu_high"
      - Memory >= 95%              → critical  "mem_critical"
      - Memory >= 85%              → high      "mem_high"
      - VPN tunnel is DOWN         → high      "tunnel_down"

    Deduplication: skips alert creation if an identical unacknowledged alert
    for the same (device_id, alert_type) already exists.
    For tunnel alerts, dedup also checks that the tunnel name appears in the message.
    """
    stmt = select(Device)
    if device_id is not None:
        stmt = stmt.where(Device.id == device_id)
    dev_result = await db.execute(stmt)
    devices = list(dev_result.scalars().all())

    if not devices:
        raise HTTPException(status_code=404, detail="No devices found")

    created_alerts: list[dict] = []

    async def _has_alert(dev_id: int, atype: str) -> bool:
        """True if an unacknowledged alert of this type already exists for the device."""
        chk = await db.execute(
            select(Alert).where(
                Alert.device_id == dev_id,
                Alert.alert_type == atype,
                Alert.acknowledged == False,  # noqa: E712
            )
        )
        return chk.scalar_one_or_none() is not None

    async def _has_tunnel_alert(dev_id: int, tunnel_name: str) -> bool:
        """True if an unacknowledged tunnel_down alert mentioning this tunnel already exists."""
        chk = await db.execute(
            select(Alert).where(
                Alert.device_id == dev_id,
                Alert.alert_type == "tunnel_down",
                Alert.acknowledged == False,  # noqa: E712
                Alert.message.contains(tunnel_name),
            )
        )
        return chk.scalar_one_or_none() is not None

    async def _create(dev_id: int, severity: str, message: str, atype: str):
        if not await _has_alert(dev_id, atype):
            alert = Alert(
                device_id=dev_id,
                severity=severity,
                message=message,
                alert_type=atype,
                acknowledged=False,
                created_at=datetime.now(timezone.utc),
            )
            db.add(alert)
            created_alerts.append({
                "device_id": dev_id,
                "type": atype,
                "severity": severity,
                "message": message,
            })
            logger.info("Alert created [%s/%s]: %s", severity, atype, message)

    for device in devices:
        if device.status == "offline":
            await _create(device.id, "critical", f"Device {device.name} is OFFLINE", "device_down")
        else:
            cpu = device.cpu_usage or 0.0
            if cpu >= CPU_CRITICAL_THRESHOLD:
                await _create(
                    device.id, "critical",
                    f"CPU critical on {device.name}: {cpu:.1f}%",
                    "cpu_critical",
                )
            elif cpu >= CPU_HIGH_THRESHOLD:
                await _create(
                    device.id, "high",
                    f"CPU high on {device.name}: {cpu:.1f}%",
                    "cpu_high",
                )

            mem = device.memory_usage or 0.0
            if mem >= MEM_CRITICAL_THRESHOLD:
                await _create(
                    device.id, "critical",
                    f"Memory critical on {device.name}: {mem:.1f}%",
                    "mem_critical",
                )
            elif mem >= MEM_HIGH_THRESHOLD:
                await _create(
                    device.id, "high",
                    f"Memory high on {device.name}: {mem:.1f}%",
                    "mem_high",
                )

        # Per-tunnel alerts (device-agnostic of online/offline)
        tunnel_result = await db.execute(
            select(VPNTunnel).where(
                VPNTunnel.device_id == device.id,
                VPNTunnel.status == "down",
            )
        )
        for tunnel in tunnel_result.scalars().all():
            if not await _has_tunnel_alert(device.id, tunnel.tunnel_name):
                alert = Alert(
                    device_id=device.id,
                    severity="high",
                    message=f"VPN tunnel '{tunnel.tunnel_name}' on {device.name} is DOWN",
                    alert_type="tunnel_down",
                    acknowledged=False,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(alert)
                created_alerts.append({
                    "device_id": device.id,
                    "type": "tunnel_down",
                    "severity": "high",
                    "message": alert.message,
                })
                logger.info("Alert created [high/tunnel_down]: %s", alert.message)

    await db.flush()

    return EvaluationResult(
        devices_checked=len(devices),
        alerts_created=len(created_alerts),
        alerts=created_alerts,
    )


# ---------------------------------------------------------------------------
# Per-device live monitoring
# ---------------------------------------------------------------------------

@router.get("/{device_id}/performance")
async def get_device_performance(device_id: int, db: AsyncSession = Depends(get_db)):
    """Get live performance metrics for a single device.

    Queries FortiGate directly for current CPU/memory/disk/session counts.
    Falls back to last-known DB values when the device is unreachable.

    For full historical trend data (charts), use GET /api/devices/{device_id}/dashboard.

    Data source: monitor/system/resource/usage
    Real structure: results.cpu = [{"current": int, "historical": {...}}]
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    cpu = device.cpu_usage or 0.0
    mem = device.memory_usage or 0.0
    disk = device.disk_usage or 0.0
    sessions = device.session_count or 0
    uptime = device.uptime
    source = "database"

    if device.status != "offline":
        try:
            api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
            resource = await api.get_resource_usage()
            if isinstance(resource, dict):
                cpu = float(_extract_current(resource.get("cpu")))
                mem = float(_extract_current(resource.get("mem")))
                disk = float(_extract_current(resource.get("disk")))
                sessions = _extract_current(resource.get("session"))
            try:
                uptime_secs = await api.get_uptime_seconds()
                if uptime_secs > 0:
                    uptime = api.format_uptime(uptime_secs)
            except Exception:
                pass
            source = "live"
        except Exception as exc:
            logger.debug("Live performance fetch failed for %s: %s", device.name, exc)

    return {
        "device_id": device.id,
        "device_name": device.name,
        "status": device.status,
        "source": source,
        "cpu_usage": cpu,
        "memory_usage": mem,
        "disk_usage": disk,
        "session_count": sessions,
        "uptime": uptime,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "model": device.model,
        "firmware_version": device.firmware_version,
    }


@router.get("/{device_id}/traffic")
async def get_device_traffic(device_id: int, db: AsyncSession = Depends(get_db)):
    """Get live interface traffic stats and VPN tunnel byte counts for a device.

    Interface stats: live from monitor/system/interface (physical-layer counters).
      NOTE: Returns empty when queried from non-root VDOMs — root VDOM only.
    Tunnel stats: from DB (last synced during tunnel discovery).
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # VPN tunnel byte counts from DB
    tunnel_result = await db.execute(
        select(VPNTunnel).where(VPNTunnel.device_id == device_id)
    )
    tunnels = list(tunnel_result.scalars().all())

    total_tunnel_in = sum(t.incoming_bytes or 0 for t in tunnels)
    total_tunnel_out = sum(t.outgoing_bytes or 0 for t in tunnels)

    # Live interface traffic stats (forces root VDOM internally)
    interface_stats: list[dict] = []
    try:
        api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
        stats_dict = await api.get_interface_traffic_stats()
        for iface_name, iface_data in stats_dict.items():
            if not isinstance(iface_data, dict):
                continue
            interface_stats.append({
                "name": iface_data.get("name", iface_name),
                "alias": iface_data.get("alias", ""),
                "link": iface_data.get("link", False),
                "speed": iface_data.get("speed", 0),
                "tx_bytes": iface_data.get("tx_bytes", 0),
                "rx_bytes": iface_data.get("rx_bytes", 0),
                "tx_packets": iface_data.get("tx_packets", 0),
                "rx_packets": iface_data.get("rx_packets", 0),
                "tx_errors": iface_data.get("tx_errors", 0),
                "rx_errors": iface_data.get("rx_errors", 0),
            })
    except Exception as exc:
        logger.debug("Interface traffic fetch failed for %s: %s", device.name, exc)

    return {
        "device_id": device.id,
        "device_name": device.name,
        "vpn_tunnels": {
            "total_incoming_bytes": total_tunnel_in,
            "total_outgoing_bytes": total_tunnel_out,
            "tunnel_count": len(tunnels),
            "tunnels": [
                {
                    "name": t.tunnel_name,
                    "status": t.status,
                    "incoming_bytes": t.incoming_bytes or 0,
                    "outgoing_bytes": t.outgoing_bytes or 0,
                }
                for t in tunnels
            ],
        },
        "interfaces": interface_stats,
    }
