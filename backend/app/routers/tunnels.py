from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import tunnel_mapper

router = APIRouter(prefix="/api/tunnels", tags=["tunnels"])


def _tunnel_to_dict(t) -> dict:
    return {
        "id": t.id,
        "device_id": t.device_id,
        "vdom_name": t.vdom_name,
        "tunnel_name": t.tunnel_name,
        "remote_gateway": t.remote_gateway,
        "remote_device_id": t.remote_device_id,
        "tunnel_type": t.tunnel_type,
        "status": t.status,
        "incoming_bytes": t.incoming_bytes,
        "outgoing_bytes": t.outgoing_bytes,
        "phase1_name": t.phase1_name,
        "phase2_name": t.phase2_name,
        "local_subnet": t.local_subnet,
        "remote_subnet": t.remote_subnet,
        "last_check": t.last_check.isoformat() if t.last_check else None,
    }


@router.get("")
async def list_tunnels(db: AsyncSession = Depends(get_db)):
    tunnels = await tunnel_mapper.get_all_tunnels(db)
    return [_tunnel_to_dict(t) for t in tunnels]


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
    return [_tunnel_to_dict(t) for t in tunnels]
