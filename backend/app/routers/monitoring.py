from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, Alert, VPNTunnel

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


@router.get("/{device_id}/performance")
async def get_device_performance(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return {
        "device_id": device.id,
        "device_name": device.name,
        "status": device.status,
        "cpu_usage": device.cpu_usage or 0,
        "memory_usage": device.memory_usage or 0,
        "session_count": device.session_count or 0,
        "uptime": device.uptime,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "model": device.model,
        "firmware_version": device.firmware_version,
    }


@router.get("/{device_id}/traffic")
async def get_device_traffic(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    tunnel_result = await db.execute(select(VPNTunnel).where(VPNTunnel.device_id == device_id))
    tunnels = tunnel_result.scalars().all()

    total_in = sum(t.incoming_bytes or 0 for t in tunnels)
    total_out = sum(t.outgoing_bytes or 0 for t in tunnels)

    return {
        "device_id": device.id,
        "device_name": device.name,
        "total_incoming_bytes": total_in,
        "total_outgoing_bytes": total_out,
        "tunnel_count": len(tunnels),
        "session_count": device.session_count or 0,
        "tunnels": [
            {
                "name": t.tunnel_name,
                "status": t.status,
                "incoming_bytes": t.incoming_bytes or 0,
                "outgoing_bytes": t.outgoing_bytes or 0,
            }
            for t in tunnels
        ],
    }


@router.get("/overview", tags=["monitoring"])
async def monitoring_overview(db: AsyncSession = Depends(get_db)):
    device_result = await db.execute(select(Device))
    devices = list(device_result.scalars().all())

    total = len(devices)
    online = sum(1 for d in devices if d.status == "online")
    offline = sum(1 for d in devices if d.status == "offline")
    unknown = total - online - offline

    avg_cpu = sum(d.cpu_usage or 0 for d in devices) / max(total, 1)
    avg_mem = sum(d.memory_usage or 0 for d in devices) / max(total, 1)
    total_sessions = sum(d.session_count or 0 for d in devices)

    tunnel_count_result = await db.execute(select(func.count(VPNTunnel.id)))
    tunnel_total = tunnel_count_result.scalar() or 0
    tunnel_up_result = await db.execute(
        select(func.count(VPNTunnel.id)).where(VPNTunnel.status == "up")
    )
    tunnel_up = tunnel_up_result.scalar() or 0

    unack_alerts_result = await db.execute(
        select(func.count(Alert.id)).where(Alert.acknowledged == False)
    )
    unack_alerts = unack_alerts_result.scalar() or 0

    critical_result = await db.execute(
        select(func.count(Alert.id)).where(
            Alert.acknowledged == False, Alert.severity == "critical"
        )
    )
    critical_alerts = critical_result.scalar() or 0

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
        },
        "alerts": {
            "unacknowledged": unack_alerts,
            "critical": critical_alerts,
        },
        "devices_detail": [
            {
                "id": d.id,
                "name": d.name,
                "status": d.status,
                "model": d.model,
                "cpu_usage": d.cpu_usage or 0,
                "memory_usage": d.memory_usage or 0,
                "session_count": d.session_count or 0,
                "uptime": d.uptime,
            }
            for d in devices
        ],
    }


@router.get("/alerts", tags=["monitoring"])
async def get_alerts(
    severity: Optional[str] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    device_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Alert).order_by(Alert.created_at.desc()).limit(limit).offset(offset)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if acknowledged is not None:
        stmt = stmt.where(Alert.acknowledged == acknowledged)
    if device_id is not None:
        stmt = stmt.where(Alert.device_id == device_id)

    result = await db.execute(stmt)
    alerts = result.scalars().all()

    return [
        {
            "id": a.id,
            "device_id": a.device_id,
            "severity": a.severity,
            "message": a.message,
            "alert_type": a.alert_type,
            "acknowledged": a.acknowledged,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in alerts
    ]


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.acknowledged = True
    await db.flush()
    return {"message": "Alert acknowledged", "alert_id": alert_id}
