from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, VDOM
from app.services.fortigate_api import FortiGateAPI
from app.schemas import (
    InterfaceSimplified,
    InterfaceListResponse,
    InterfaceStatistics,
    ResourceDataPoint,
    ResourceMetricHistory,
    DeviceDashboard,
)

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
    disk_usage: float = 0.0
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
        "disk_usage": device.disk_usage or 0,
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

        # Pull resource usage (CPU/memory/disk/sessions) on create
        try:
            resource = await api.get_resource_usage()
            if isinstance(resource, dict):
                device.cpu_usage = float(_extract_current(resource.get("cpu")))
                device.memory_usage = float(_extract_current(resource.get("mem")))
                device.disk_usage = float(_extract_current(resource.get("disk")))
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
    # NOTE: system/status returns serial/version/build at top level (merged by get_system_status).
    # The 'results' sub-dict has: model_name="FortiGateRugged", model_number="60F", model="FGR60F", hostname.
    # There is NO 'uptime' field here — uptime is fetched separately in step 7 via web-ui/state.
    try:
        status_data = await api.get_system_status()
        device.serial_number = status_data.get("serial", device.serial_number)
        device.firmware_version = status_data.get("version", device.firmware_version)
        # Build friendly model string: "FortiGateRugged 60F" (fallback to model code "FGR60F")
        model_name = status_data.get("model_name", "")
        model_number = status_data.get("model_number", "")
        model_code = status_data.get("model", "")
        if model_name and model_number:
            device.model = f"{model_name} {model_number}"
        elif model_name:
            device.model = model_name
        elif model_code:
            device.model = model_code
        device.hostname = status_data.get("hostname", device.hostname)
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
            disk_val = _extract_current(resource.get("disk"))
            sess_val = _extract_current(resource.get("session"))
            device.cpu_usage = float(cpu_val)
            device.memory_usage = float(mem_val)
            device.disk_usage = float(disk_val)
            device.session_count = sess_val
            resource_loaded = True
            log.info("Resource usage for %s: CPU=%s%%, Mem=%s%%, Disk=%s%%, Sessions=%s",
                     device.name, cpu_val, mem_val, disk_val, sess_val)
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


def _parse_resource_metric(metric_list) -> ResourceMetricHistory:
    """Parse a resource metric list from FortiGate monitor/system/resource/usage.

    FortiGate format:
      [
        {
          "current": 5,
          "historical": {
            "1-min":  {"values": [[ts_ms, val], ...], "min": 4, "max": 6, "average": 5},
            "1-hour": {"values": [[ts_ms, val], ...], "min": 3, "max": 9, "average": 7},
            ...
          }
        }
      ]
    Returns ResourceMetricHistory with current value and two history windows.
    """
    if not isinstance(metric_list, list) or not metric_list:
        return ResourceMetricHistory()

    first = metric_list[0]
    if not isinstance(first, dict):
        return ResourceMetricHistory()

    current = int(first.get("current", 0))
    historical = first.get("historical", {})

    def _parse_window(window_key: str) -> tuple[int, int, int, list[ResourceDataPoint]]:
        """Extract min, max, avg, and data points from one history window."""
        window = historical.get(window_key, {})
        points = [
            ResourceDataPoint(timestamp=p[0], value=p[1])
            for p in window.get("values", [])
            if isinstance(p, list) and len(p) >= 2
        ]
        return (
            int(window.get("min", 0)),
            int(window.get("max", 0)),
            int(window.get("average", 0)),
            points,
        )

    min_1h, max_1h, avg_1h, history_1hour = _parse_window("1-hour")
    _, _, _, history_1min = _parse_window("1-min")

    return ResourceMetricHistory(
        current=current,
        min_1hour=min_1h,
        max_1hour=max_1h,
        avg_1hour=avg_1h,
        history_1min=history_1min,
        history_1hour=history_1hour,
    )


@router.get("/{device_id}/dashboard", response_model=DeviceDashboard)
async def get_device_dashboard(device_id: int, db: AsyncSession = Depends(get_db)):
    """Get complete dashboard data for a device.

    Fetches live data from FortiGate and returns:
    - System info: hostname, serial, firmware version, model
    - Live metrics: CPU %, Memory %, Disk %, Session count
    - Historical trends for charts: 1-min (3s granularity) and 1-hour (3m granularity)

    Data sources:
      - monitor/system/status         → serial, firmware, model, hostname
      - monitor/system/resource/usage → CPU, memory, disk, sessions + history
      - monitor/web-ui/state          → uptime calculation
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    # Fetch system status — serial, version, model, hostname
    serial = device.serial_number or ""
    firmware = device.firmware_version or ""
    model_friendly = device.model or ""
    model_code = ""
    hostname = device.hostname or ""

    try:
        status_data = await api.get_system_status()
        serial = status_data.get("serial", serial)
        firmware = status_data.get("version", firmware)
        model_code = status_data.get("model", "")
        model_name = status_data.get("model_name", "")
        model_number = status_data.get("model_number", "")
        if model_name and model_number:
            model_friendly = f"{model_name} {model_number}"
        elif model_name:
            model_friendly = model_name
        elif model_code:
            model_friendly = model_code
        hostname = status_data.get("hostname", hostname)
    except Exception:
        pass

    # Fetch live resource usage + historical trends
    cpu_metric = ResourceMetricHistory()
    mem_metric = ResourceMetricHistory()
    disk_metric = ResourceMetricHistory()
    session_metric = ResourceMetricHistory()

    try:
        resource = await api.get_resource_usage()
        if isinstance(resource, dict):
            cpu_metric = _parse_resource_metric(resource.get("cpu"))
            mem_metric = _parse_resource_metric(resource.get("mem"))
            disk_metric = _parse_resource_metric(resource.get("disk"))
            session_metric = _parse_resource_metric(resource.get("session"))
    except Exception:
        pass

    # Fetch uptime
    uptime_str = device.uptime or "unknown"
    try:
        uptime_secs = await api.get_uptime_seconds()
        if uptime_secs > 0:
            uptime_str = api.format_uptime(uptime_secs)
    except Exception:
        pass

    last_seen = device.last_seen.isoformat() if device.last_seen else None

    return DeviceDashboard(
        device_id=device_id,
        device_name=device.name,
        hostname=hostname,
        serial_number=serial,
        firmware_version=firmware,
        model=model_friendly,
        model_code=model_code,
        status=device.status,
        uptime=uptime_str,
        last_seen=last_seen,
        # Live snapshot (from metric.current)
        cpu_usage=float(cpu_metric.current),
        memory_usage=float(mem_metric.current),
        disk_usage=float(disk_metric.current),
        session_count=session_metric.current,
        # Historical trends
        cpu=cpu_metric,
        memory=mem_metric,
        disk=disk_metric,
        sessions=session_metric,
    )


def _parse_ip_netmask(ip_string: str) -> tuple[str, str]:
    """Parse FortiGate IP format 'IP NETMASK' into separate components.

    FortiGate stores IPs as: "10.0.10.1 255.255.255.252"
    Returns: ("10.0.10.1", "255.255.255.252")

    If format is invalid or "0.0.0.0 0.0.0.0", returns ("", "")
    """
    if not ip_string or ip_string == "0.0.0.0 0.0.0.0":
        return ("", "")

    parts = ip_string.strip().split()
    if len(parts) >= 2:
        ip = parts[0]
        netmask = parts[1]
        if ip != "0.0.0.0":
            return (ip, netmask)

    return ("", "")


def _interface_to_simplified(iface: dict) -> InterfaceSimplified:
    """Convert FortiGate interface dict to simplified Pydantic model.

    Parses space-separated IP/netmask and remote-ip fields.
    """
    # Parse main IP address
    ip_str = iface.get("ip", "0.0.0.0 0.0.0.0")
    ip_address, netmask = _parse_ip_netmask(ip_str)

    # Parse remote IP (for tunnels)
    remote_ip_str = iface.get("remote-ip", "0.0.0.0 0.0.0.0")
    remote_ip_address, remote_netmask = _parse_ip_netmask(remote_ip_str)

    # Parse IPv6
    ipv6_obj = iface.get("ipv6", {})
    ipv6_address = ipv6_obj.get("ip6-address", "::/0")
    if ipv6_address == "::/0":
        ipv6_address = ""
    ipv6_mode = ipv6_obj.get("ip6-mode", "static")

    # Parse allowaccess (space-separated to list)
    allowaccess_str = iface.get("allowaccess", "")
    allowaccess_list = [a.strip() for a in allowaccess_str.split() if a.strip()]

    return InterfaceSimplified(
        name=iface.get("name", ""),
        vdom=iface.get("vdom", ""),
        ip_address=ip_address,
        netmask=netmask,
        status=iface.get("status", "down"),
        type=iface.get("type", "physical"),
        role=iface.get("role", "undefined"),
        macaddr=iface.get("macaddr", ""),
        mtu=iface.get("mtu", 1500),
        description=iface.get("description", ""),
        alias=iface.get("alias", ""),
        parent_interface=iface.get("interface", ""),
        vlan_id=iface.get("vlanid", 0),
        remote_ip_address=remote_ip_address,
        remote_netmask=remote_netmask,
        ipv6_address=ipv6_address,
        ipv6_mode=ipv6_mode,
        allowaccess=allowaccess_list,
    )


@router.get("/{device_id}/interfaces", response_model=InterfaceListResponse)
async def get_device_interfaces(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Filter by VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get all interfaces for a device with parsed IP addresses.

    Returns simplified interface representation with IP/netmask separated.
    FortiGate returns IPs as "10.0.10.1 255.255.255.252" - this endpoint parses them.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    try:
        interfaces_raw = await api.get_interfaces(vdom=vdom)
        interfaces_simplified = [_interface_to_simplified(iface) for iface in interfaces_raw]

        return InterfaceListResponse(
            device_id=device_id,
            device_name=device.name,
            vdom=vdom or "all",
            interfaces=interfaces_simplified,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch interfaces: {exc}")


@router.get("/{device_id}/interfaces/raw")
async def get_device_interfaces_raw(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Filter by VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get raw interface data from FortiGate without parsing.

    Useful for debugging or when full structure with all fields is needed.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    try:
        interfaces = await api.get_interfaces(vdom=vdom)
        return {"device_id": device_id, "device_name": device.name, "interfaces": interfaces}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch interfaces: {exc}")


@router.get("/{device_id}/interfaces/statistics", response_model=InterfaceStatistics)
async def get_interface_statistics(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Filter by VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get interface statistics for a device."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    try:
        interfaces = await api.get_interfaces(vdom=vdom)

        total = len(interfaces)
        by_type = {"physical": 0, "vlan": 0, "tunnel": 0, "loopback": 0}
        by_status = {"up": 0, "down": 0}

        for iface in interfaces:
            iface_type = iface.get("type", "physical")
            if iface_type in by_type:
                by_type[iface_type] += 1

            status = iface.get("status", "down")
            if status in by_status:
                by_status[status] += 1

        return InterfaceStatistics(
            total_interfaces=total,
            physical=by_type["physical"],
            vlan=by_type["vlan"],
            tunnel=by_type["tunnel"],
            loopback=by_type["loopback"],
            up=by_status["up"],
            down=by_status["down"],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch interface statistics: {exc}")


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
