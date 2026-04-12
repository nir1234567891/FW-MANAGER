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
        device.hostname = status_data.get("hostname", device.hostname)
        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)

        # Pull resource usage (CPU/memory/sessions/uptime) on create
        try:
            resource = await api.get_resource_usage()
            if isinstance(resource, dict):
                device.cpu_usage = float(_extract_current(resource.get("cpu")))
                device.memory_usage = float(_extract_current(resource.get("mem")))
                device.session_count = _extract_current(resource.get("session"))
        except Exception:
            pass

        # Pull uptime
        try:
            uptime_secs = await api.get_uptime_seconds()
            if uptime_secs > 0:
                device.uptime = api.format_uptime(uptime_secs)
        except Exception:
            pass

        # Pull VDOMs on create
        try:
            vdoms_data = await api.get_vdoms()
            device.vdom_list = [v.get("name", "") for v in vdoms_data]
        except Exception:
            pass
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


def _extract_current(resource_list) -> int:
    """Extract 'current' value from resource/usage list format."""
    if isinstance(resource_list, list) and resource_list:
        first = resource_list[0]
        if isinstance(first, dict):
            return int(first.get("current", 0))
    return 0


@router.post("/{device_id}/refresh")
async def refresh_device(device_id: int, db: AsyncSession = Depends(get_db)):
    import logging
    log = logging.getLogger(__name__)

    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    # --- 1. System Status (serial, version, model, hostname) ---
    try:
        status_data = await api.get_system_status()
        device.serial_number = status_data.get("serial", device.serial_number)
        device.firmware_version = status_data.get("version", device.firmware_version)
        device.model = status_data.get("model", device.model)
        device.hostname = status_data.get("hostname", device.hostname)
        if status_data.get("uptime"):
            device.uptime = status_data["uptime"]
        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)
    except Exception as exc:
        log.error("System status failed for %s: %s", device.name, exc)
        device.status = "offline"
        device.cpu_usage = 0
        device.memory_usage = 0
        device.session_count = 0
        device.uptime = "0 days"
        device.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(device)
        return _device_to_dict(device)

    # --- 2. Resource Usage (CPU %, Memory %, Session count) ---
    # This endpoint returns current percentages directly - works on all models
    resource_loaded = False
    try:
        resource = await api.get_resource_usage()
        if isinstance(resource, dict):
            cpu_val = _extract_current(resource.get("cpu"))
            mem_val = _extract_current(resource.get("mem"))
            sess_val = _extract_current(resource.get("session"))
            device.cpu_usage = float(cpu_val)
            device.memory_usage = float(mem_val)
            device.session_count = sess_val
            resource_loaded = True
            log.info("Resource usage for %s: CPU=%s%%, Mem=%s%%, Sessions=%s",
                     device.name, cpu_val, mem_val, sess_val)
    except Exception as exc:
        log.error("Resource usage failed for %s: %s", device.name, exc)

    # --- 3. Fallback: performance/status (if resource/usage failed) ---
    if not resource_loaded:
        try:
            perf = await api.get_system_performance()
            if isinstance(perf, dict):
                cpu = perf.get("cpu", {})
                if isinstance(cpu, dict):
                    if "idle" in cpu:
                        device.cpu_usage = round(100.0 - float(cpu.get("idle", 100)), 1)
                    elif "cpu_usage" in cpu:
                        device.cpu_usage = float(cpu["cpu_usage"])
                else:
                    device.cpu_usage = float(cpu) if cpu else 0.0

                mem = perf.get("mem", perf.get("memory", {}))
                if isinstance(mem, dict):
                    if "total" in mem and "used" in mem and mem["total"] > 0:
                        device.memory_usage = round(float(mem["used"]) / float(mem["total"]) * 100, 1)
                    elif "mem_usage" in mem:
                        device.memory_usage = float(mem["mem_usage"])
                else:
                    device.memory_usage = float(mem) if mem else 0.0
        except Exception as exc:
            log.error("Performance fetch failed for %s: %s", device.name, exc)

    # --- 4. Session count fallback ---
    if not device.session_count:
        try:
            device.session_count = await api.get_sessions_count()
        except Exception:
            pass

    # --- 5. HA Status ---
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

    # --- 6. VDOMs ---
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

    # --- 7. Uptime: calculate from resource/usage history ---
    try:
        uptime_secs = await api.get_uptime_seconds()
        if uptime_secs > 0:
            device.uptime = api.format_uptime(uptime_secs)
            log.info("Uptime for %s: %s (%d seconds)", device.name, device.uptime, uptime_secs)
        else:
            log.warning("Could not determine uptime for %s", device.name)
    except Exception as exc:
        log.error("Uptime calculation failed for %s: %s", device.name, exc)

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


@router.get("/{device_id}/bgp")
async def get_device_bgp(
    device_id: int, vdom: Optional[str] = None, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    vdoms_to_check = [vdom] if vdom else (device.vdom_list or ["root"])
    all_neighbors = []
    for v in vdoms_to_check:
        try:
            neighbors = await api.get_bgp_neighbors(vdom=v)
            for n in neighbors:
                n["vdom"] = v
            all_neighbors.extend(neighbors)
        except Exception:
            pass
    return {"device_id": device_id, "device_name": device.name, "bgp_neighbors": all_neighbors}


@router.get("/{device_id}/ospf")
async def get_device_ospf(
    device_id: int, vdom: Optional[str] = None, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    vdoms_to_check = [vdom] if vdom else (device.vdom_list or ["root"])
    all_neighbors = []
    for v in vdoms_to_check:
        try:
            neighbors = await api.get_ospf_neighbors(vdom=v)
            for n in neighbors:
                n["vdom"] = v
            all_neighbors.extend(neighbors)
        except Exception:
            pass
    return {"device_id": device_id, "device_name": device.name, "ospf_neighbors": all_neighbors}


@router.get("/{device_id}/debug-live")
async def debug_live_data(device_id: int, db: AsyncSession = Depends(get_db)):
    """Debug endpoint - fetch raw data from FortiGate to diagnose parsing issues."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    output: dict = {}

    try:
        output["system_status"] = await api.get_system_status()
    except Exception as exc:
        output["system_status_error"] = str(exc)

    try:
        output["performance_raw"] = await api.get_system_performance()
    except Exception as exc:
        output["performance_error"] = str(exc)

    try:
        output["ha_status"] = await api.get_ha_status()
    except Exception as exc:
        output["ha_error"] = str(exc)

    try:
        output["web_ui_state"] = await api._get("/api/v2/monitor/web-ui/state")
    except Exception as exc:
        output["web_ui_error"] = str(exc)

    return output
