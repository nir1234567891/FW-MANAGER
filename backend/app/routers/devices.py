from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, VDOM
from app.services.fortigate_api import FortiGateAPI

router = APIRouter(prefix="/api/devices", tags=["devices"])


class DeviceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    hostname: str = Field(..., min_length=1, max_length=255)
    ip_address: str = Field(..., min_length=1, max_length=45)
    port: int = Field(default=443, ge=1, le=65535)
    api_key: str = Field(..., min_length=1)
    notes: Optional[str] = None


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    hostname: Optional[str] = None
    ip_address: Optional[str] = None
    port: Optional[int] = None
    api_key: Optional[str] = None
    notes: Optional[str] = None


class DeviceResponse(BaseModel):
    id: int
    name: str
    hostname: str
    ip_address: str
    port: int
    serial_number: Optional[str] = None
    firmware_version: Optional[str] = None
    model: Optional[str] = None
    ha_status: Optional[str] = None
    status: str
    vdom_list: Optional[list] = None
    cpu_usage: float
    memory_usage: float
    session_count: int
    uptime: Optional[str] = None
    last_seen: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


def _device_to_dict(device: Device) -> dict:
    return {
        "id": device.id,
        "name": device.name,
        "hostname": device.hostname,
        "ip_address": device.ip_address,
        "port": device.port,
        "serial_number": device.serial_number,
        "firmware_version": device.firmware_version,
        "model": device.model,
        "ha_status": device.ha_status,
        "status": device.status,
        "vdom_list": device.vdom_list,
        "cpu_usage": device.cpu_usage or 0,
        "memory_usage": device.memory_usage or 0,
        "session_count": device.session_count or 0,
        "uptime": device.uptime,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "created_at": device.created_at.isoformat() if device.created_at else None,
        "updated_at": device.updated_at.isoformat() if device.updated_at else None,
        "notes": device.notes,
    }


@router.get("")
async def list_devices(
    status: Optional[str] = Query(None, description="Filter by status: online, offline, unknown"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Device).order_by(Device.name)
    if status:
        stmt = stmt.where(Device.status == status)
    result = await db.execute(stmt)
    devices = result.scalars().all()
    return [_device_to_dict(d) for d in devices]


@router.post("", status_code=201)
async def create_device(payload: DeviceCreate, db: AsyncSession = Depends(get_db)):
    device = Device(
        name=payload.name,
        hostname=payload.hostname,
        ip_address=payload.ip_address,
        port=payload.port,
        api_key=payload.api_key,
        notes=payload.notes,
    )

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    conn_result = await api.test_connection()
    if conn_result["success"]:
        status_data = conn_result.get("data", {})
        device.serial_number = status_data.get("serial", "")
        device.firmware_version = status_data.get("version", "")
        device.model = status_data.get("model", "")
        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)
    else:
        device.status = "unknown"

    db.add(device)
    await db.flush()
    await db.refresh(device)

    return {
        "device": _device_to_dict(device),
        "connection_test": conn_result,
    }


@router.get("/{device_id}")
async def get_device(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return _device_to_dict(device)


@router.put("/{device_id}")
async def update_device(device_id: int, payload: DeviceUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(device, field, value)
    device.updated_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(device)
    return _device_to_dict(device)


@router.delete("/{device_id}")
async def delete_device(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.flush()
    return {"message": f"Device '{device.name}' deleted successfully"}


@router.post("/{device_id}/refresh")
async def refresh_device(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    try:
        status_data = await api.get_system_status()
        device.serial_number = status_data.get("serial", device.serial_number)
        device.firmware_version = status_data.get("version", device.firmware_version)
        device.model = status_data.get("model", device.model)
        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)
    except Exception:
        device.status = "offline"

    try:
        perf = await api.get_system_performance()
        if isinstance(perf, dict):
            cpu = perf.get("cpu", {})
            mem = perf.get("mem", perf.get("memory", {}))
            sess = perf.get("session", {})
            device.cpu_usage = float(cpu) if not isinstance(cpu, dict) else float(cpu.get("cpu_usage", 0))
            device.memory_usage = float(mem) if not isinstance(mem, dict) else float(mem.get("mem_usage", 0))
            device.session_count = int(sess) if not isinstance(sess, dict) else int(sess.get("current_sessions", 0))
    except Exception:
        pass

    try:
        ha_data = await api.get_ha_status()
        if isinstance(ha_data, list) and ha_data:
            device.ha_status = "active-passive"
        elif isinstance(ha_data, dict) and ha_data:
            device.ha_status = ha_data.get("mode", "standalone")
        else:
            device.ha_status = "standalone"
    except Exception:
        pass

    try:
        vdoms_data = await api.get_vdoms()
        device.vdom_list = [v.get("name", "") for v in vdoms_data]

        for vdata in vdoms_data:
            vdom_name = vdata.get("name", "")
            existing = await db.execute(
                select(VDOM).where(VDOM.device_id == device.id, VDOM.name == vdom_name)
            )
            vdom = existing.scalar_one_or_none()
            if not vdom:
                vdom = VDOM(device_id=device.id, name=vdom_name)
                db.add(vdom)
    except Exception:
        pass

    device.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(device)
    return _device_to_dict(device)


@router.get("/{device_id}/interfaces")
async def get_device_interfaces(
    device_id: int, vdom: Optional[str] = None, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    try:
        interfaces = await api.get_interfaces(vdom=vdom)
        return {"device_id": device_id, "interfaces": interfaces}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch interfaces: {exc}")


@router.get("/{device_id}/routes")
async def get_device_routes(
    device_id: int, vdom: Optional[str] = None, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    try:
        routes = await api.get_routes(vdom=vdom)
        return {"device_id": device_id, "routes": routes}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch routes: {exc}")


@router.get("/{device_id}/vdoms")
async def get_device_vdoms(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    vdom_result = await db.execute(select(VDOM).where(VDOM.device_id == device_id))
    vdoms = vdom_result.scalars().all()
    return {
        "device_id": device_id,
        "vdoms": [
            {
                "id": v.id,
                "name": v.name,
                "mode": v.mode,
                "status": v.status,
                "policy_count": v.policy_count,
                "interface_count": v.interface_count,
            }
            for v in vdoms
        ],
    }


@router.get("/{device_id}/performance")
async def get_device_performance(device_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return {
        "device_id": device_id,
        "device_name": device.name,
        "cpu_usage": device.cpu_usage or 0,
        "memory_usage": device.memory_usage or 0,
        "session_count": device.session_count or 0,
        "uptime": device.uptime,
        "status": device.status,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
    }
