from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.services import tunnel_mapper
from app.models import VPNTunnel, Device

router = APIRouter(prefix="/api/tunnels", tags=["tunnels"])


async def _tunnel_to_dict(t, db: AsyncSession) -> dict:
    # Get source device name
    source_device = await db.get(Device, t.device_id)
    source_device_name = source_device.name if source_device else "Unknown"
    source_ip = source_device.ip_address if source_device else ""

    # Get destination device name
    dest_device_name = "Unknown"
    dest_ip = t.remote_gateway or ""
    if t.remote_device_id:
        dest_device = await db.get(Device, t.remote_device_id)
        if dest_device:
            dest_device_name = dest_device.name
            dest_ip = dest_device.ip_address

    return {
        "id": t.id,
        "name": t.tunnel_name,
        "type": t.tunnel_type,
        "status": t.status,
        "source_device_id": str(t.device_id),
        "source_device_name": source_device_name,
        "dest_device_id": str(t.remote_device_id) if t.remote_device_id else "",
        "dest_device_name": dest_device_name,
        "source_ip": source_ip,
        "dest_ip": dest_ip,
        "local_subnet": t.local_subnet or "",
        "remote_subnet": t.remote_subnet or "",
        "incoming_bytes": t.incoming_bytes or 0,
        "outgoing_bytes": t.outgoing_bytes or 0,
        "phase1_status": "up" if t.status == "up" else "down",
        "phase2_status": "up" if t.status == "up" else "down",
        "uptime": 0,  # TODO: Calculate from last_check
        "last_change": t.last_check.isoformat() if t.last_check else None,
        # Legacy fields
        "device_id": t.device_id,
        "vdom_name": t.vdom_name,
        "tunnel_name": t.tunnel_name,
        "remote_gateway": t.remote_gateway,
        "remote_device_id": t.remote_device_id,
        "tunnel_type": t.tunnel_type,
        "phase1_name": t.phase1_name,
        "phase2_name": t.phase2_name,
    }


@router.get("")
async def list_tunnels(db: AsyncSession = Depends(get_db)):
    tunnels = await tunnel_mapper.get_all_tunnels(db)
    result = []
    for t in tunnels:
        result.append(await _tunnel_to_dict(t, db))
    return result


@router.get("/topology")
async def get_topology(db: AsyncSession = Depends(get_db)):
    topology = await tunnel_mapper.build_topology(db)
    return topology


@router.post("/discover")
async def discover_tunnels(db: AsyncSession = Depends(get_db)):
    try:
        result = await tunnel_mapper.discover_tunnels(db)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Tunnel discovery failed: {exc}")


@router.get("/summary")
async def tunnel_summary(db: AsyncSession = Depends(get_db)):
    summary = await tunnel_mapper.get_tunnel_status_summary(db)
    return summary


@router.get("/{device_id}")
async def get_device_tunnels(device_id: int, db: AsyncSession = Depends(get_db)):
    tunnels = await tunnel_mapper.get_device_tunnels(db, device_id)
    result = []
    for t in tunnels:
        result.append(await _tunnel_to_dict(t, db))
    return result
