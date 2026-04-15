"""Dashboard router -- fleet-wide overview in a single call."""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, VPNTunnel, Policy, Alert
from app.schemas import DashboardOverview

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverview)
async def dashboard_overview(db: AsyncSession = Depends(get_db)):
    """Aggregated fleet stats: devices, tunnels, policies, alerts, avg CPU/mem."""
    dev_result = await db.execute(select(Device))
    devices = list(dev_result.scalars().all())
    total = len(devices)
    online = sum(1 for d in devices if d.status == "online")
    offline = sum(1 for d in devices if d.status == "offline")

    avg_cpu = sum(d.cpu_usage or 0 for d in devices) / max(total, 1)
    avg_mem = sum(d.memory_usage or 0 for d in devices) / max(total, 1)
    total_sessions = sum(d.session_count or 0 for d in devices)

    tun_total = (await db.execute(select(func.count(VPNTunnel.id)))).scalar() or 0
    tun_up = (await db.execute(
        select(func.count(VPNTunnel.id)).where(VPNTunnel.status == "up")
    )).scalar() or 0

    pol_total = (await db.execute(select(func.count(Policy.id)))).scalar() or 0

    unack = (await db.execute(
        select(func.count(Alert.id)).where(Alert.acknowledged == False)  # noqa: E712
    )).scalar() or 0
    critical = (await db.execute(
        select(func.count(Alert.id)).where(
            Alert.acknowledged == False, Alert.severity == "critical"  # noqa: E712
        )
    )).scalar() or 0

    return DashboardOverview(
        devices_total=total,
        devices_online=online,
        devices_offline=offline,
        tunnels_total=tun_total,
        tunnels_up=tun_up,
        tunnels_down=tun_total - tun_up,
        policies_total=pol_total,
        alerts_unacknowledged=unack,
        alerts_critical=critical,
        avg_cpu=round(avg_cpu, 1),
        avg_memory=round(avg_mem, 1),
        total_sessions=total_sessions,
    )
