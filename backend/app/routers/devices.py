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
    InterfaceTrafficStats,
    InterfaceTrafficResponse,
    VDOMDetail,
    VDOMListResponse,
    ActiveRoute,
    BGPNeighborStatus,
    BGPConfig,
    BGPStatusResponse,
    OSPFNeighborStatus,
    OSPFStatusResponse,
    RoutingSummary,
    RouteListResponse,
    ResourceDataPoint,
    ResourceTimeWindow,
    ResourceMetric,
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
        device.model = _build_model_name(status_data)
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
    """Extract 'current' value from resource/usage list format.

    FortiGate resource/usage returns each metric as a list of length 1:
      results.cpu = [{"current": 5, "historical": {...}}]
    This extracts [0]["current"].
    """
    if isinstance(resource_list, list) and resource_list:
        first = resource_list[0]
        if isinstance(first, dict):
            return int(first.get("current", 0))
    return 0


def _build_model_name(status_data: dict) -> str:
    """Build friendly model name from system/status response.

    Real FortiGate returns:
      model_name = "FortiGateRugged"
      model_number = "60F"
      model = "FGR60F"  (model code)

    Builds: "FortiGateRugged 60F", falling back to model code.
    """
    model_name = status_data.get("model_name", "")
    model_number = status_data.get("model_number", "")
    model_code = status_data.get("model", "")
    if model_name and model_number:
        return f"{model_name} {model_number}"
    elif model_name:
        return model_name
    return model_code


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
    # Real response (verified): results = { model_name, model_number, model, hostname, log_disk_status }
    # Envelope fields serial, version, build are merged into results by get_system_status().
    # There is NO 'uptime' field — uptime is fetched separately via web-ui/state.
    try:
        status_data = await api.get_system_status()
        device.serial_number = status_data.get("serial", device.serial_number)
        device.firmware_version = status_data.get("version", device.firmware_version)
        device.model = _build_model_name(status_data) or device.model
        device.hostname = status_data.get("hostname", device.hostname)
        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)
    except Exception as exc:
        log.error("System status failed for %s: %s", device.name, exc)
        device.status = "offline"
        device.cpu_usage = 0
        device.memory_usage = 0
        device.disk_usage = 0
        device.session_count = 0
        device.uptime = "0 days"
        device.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(device)
        return _device_to_dict(device)

    # --- 2. Resource Usage (CPU %, Memory %, Disk %, Session count) ---
    # Single source of truth: monitor/system/resource/usage
    # Real structure: results.cpu = [{"current": 0, "historical": {...}}]
    # No fallback to performance/status (returns 403 on VDOM-scoped tokens).
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
            log.info("Resource usage for %s: CPU=%s%%, Mem=%s%%, Disk=%s%%, Sessions=%s",
                     device.name, cpu_val, mem_val, disk_val, sess_val)
    except Exception as exc:
        log.error("Resource usage failed for %s: %s", device.name, exc)

    # --- 3. HA Status ---
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

    # --- 4. VDOMs (list + per-VDOM settings for opmode) ---
    try:
        vdoms_data = await api.get_vdoms()
        device.vdom_list = [v.get("name", "") for v in vdoms_data]

        for vdata in vdoms_data:
            vdom_name = vdata.get("name", "")
            existing = await db.execute(
                select(VDOM).where(VDOM.device_id == device.id, VDOM.name == vdom_name)
            )
            vdom_record = existing.scalar_one_or_none()
            if not vdom_record:
                vdom_record = VDOM(device_id=device.id, name=vdom_name)
                db.add(vdom_record)

            # Enrich with per-VDOM settings (opmode, status)
            try:
                settings = await api.get_vdom_settings(vdom_name)
                vdom_record.mode = settings.get("opmode", "nat")
                vdom_record.status = settings.get("status", "enable")
            except Exception:
                pass
    except Exception:
        pass

    # --- 5. Uptime: calculate from web-ui/state ---
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


def _parse_resource_metric(metric_list) -> ResourceMetric:
    """Parse a resource metric from FortiGate monitor/system/resource/usage.

    Real FortiGate structure (verified 2026-04-13):
      results.cpu = [{
        "current": 0,
        "historical": {
          "1-min":   {"values": [[ts_ms, val], ...], "min": 0, "max": 0, "average": 0, "start": ts, "end": ts},
          "10-min":  { ... },
          "30-min":  { ... },
          "1-hour":  { ... },
          "12-hour": { ... },
          "24-hour": { ... }
        }
      }]

    Extracts [0] and converts all 6 historical windows into ResourceTimeWindow objects.
    """
    if not isinstance(metric_list, list) or not metric_list:
        return ResourceMetric()

    first = metric_list[0]
    if not isinstance(first, dict):
        return ResourceMetric()

    current = int(first.get("current", 0))
    raw_historical = first.get("historical", {})

    historical: dict[str, ResourceTimeWindow] = {}
    for window_key, window_data in raw_historical.items():
        if not isinstance(window_data, dict):
            continue
        points = [
            ResourceDataPoint(timestamp=p[0], value=p[1])
            for p in window_data.get("values", [])
            if isinstance(p, list) and len(p) >= 2
        ]
        historical[window_key] = ResourceTimeWindow(
            values=points,
            min=int(window_data.get("min", 0)),
            max=int(window_data.get("max", 0)),
            average=int(window_data.get("average", 0)),
            start=int(window_data.get("start", 0)),
            end=int(window_data.get("end", 0)),
        )

    return ResourceMetric(current=current, historical=historical)


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
        model_friendly = _build_model_name(status_data) or model_friendly
        hostname = status_data.get("hostname", hostname)
    except Exception:
        pass

    # Fetch live resource usage + historical trends (all 6 windows)
    cpu_metric = ResourceMetric()
    mem_metric = ResourceMetric()
    disk_metric = ResourceMetric()
    session_metric = ResourceMetric()

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
        mode=iface.get("mode", "static"),
        speed=iface.get("speed", "auto"),
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
    """Get interface count summary by type and admin status.

    Real FortiGate interface types (verified 2026-04-13):
      physical, hard-switch, switch, tunnel, vlan, loopback, aggregate, redundant, vdom-link
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    try:
        interfaces = await api.get_interfaces(vdom=vdom)

        total = len(interfaces)
        by_type = {
            "physical": 0,
            "hard-switch": 0,
            "vlan": 0,
            "tunnel": 0,
            "loopback": 0,
            "aggregate": 0,
            "switch": 0,
            "other": 0,
        }
        by_status = {"up": 0, "down": 0}

        for iface in interfaces:
            iface_type = iface.get("type", "physical")
            if iface_type in by_type:
                by_type[iface_type] += 1
            else:
                by_type["other"] += 1

            status = iface.get("status", "down")
            if status in by_status:
                by_status[status] += 1

        return InterfaceStatistics(
            total_interfaces=total,
            physical=by_type["physical"],
            hard_switch=by_type["hard-switch"],
            vlan=by_type["vlan"],
            tunnel=by_type["tunnel"],
            loopback=by_type["loopback"],
            aggregate=by_type["aggregate"],
            switch=by_type["switch"],
            other=by_type["other"],
            up=by_status["up"],
            down=by_status["down"],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch interface statistics: {exc}")


@router.get("/{device_id}/interfaces/traffic", response_model=InterfaceTrafficResponse)
async def get_interface_traffic(
    device_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get real-time interface traffic stats (bytes, packets, errors, link state).

    Uses monitor/system/interface/select which returns physical-layer counters.
    NOTE: This endpoint always queries root VDOM because the monitor API
    returns EMPTY for VDOM-scoped tokens on non-root VDOMs.

    Real structure (verified 2026-04-13):
      results = { "wan1": {name, mac, link, speed, duplex, tx/rx bytes/packets/errors}, ... }
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    try:
        stats_dict = await api.get_interface_traffic_stats()

        interfaces = []
        for iface_name, iface_data in stats_dict.items():
            if not isinstance(iface_data, dict):
                continue
            interfaces.append(InterfaceTrafficStats(
                name=iface_data.get("name", iface_name),
                alias=iface_data.get("alias", ""),
                mac=iface_data.get("mac", ""),
                ip=iface_data.get("ip", ""),
                mask=iface_data.get("mask", 0),
                link=iface_data.get("link", False),
                speed=iface_data.get("speed", 0),
                duplex=iface_data.get("duplex", 0),
                tx_packets=iface_data.get("tx_packets", 0),
                rx_packets=iface_data.get("rx_packets", 0),
                tx_bytes=iface_data.get("tx_bytes", 0),
                rx_bytes=iface_data.get("rx_bytes", 0),
                tx_errors=iface_data.get("tx_errors", 0),
                rx_errors=iface_data.get("rx_errors", 0),
            ))

        return InterfaceTrafficResponse(
            device_id=device_id,
            device_name=device.name,
            interfaces=interfaces,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch interface traffic stats: {exc}")


@router.get("/{device_id}/routes", response_model=RouteListResponse)
async def get_device_routes(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Filter by VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get active routing table (FIB) for a device.

    Returns all installed routes from monitor/router/ipv4.
    Supports VDOM filtering — if not specified, queries all device VDOMs.

    Real route types (verified 2026-04-13):
      connect, static, bgp, ospf, rip, isis, kernel
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        routes_raw = await api.get_routes(vdom=target_vdom)
        routes = [
            ActiveRoute(
                ip_version=r.get("ip_version", 4),
                type=r.get("type", "unknown"),
                ip_mask=r.get("ip_mask", ""),
                distance=r.get("distance", 0),
                metric=r.get("metric", 0),
                priority=r.get("priority", 0),
                vrf=r.get("vrf", 0),
                gateway=r.get("gateway", "0.0.0.0"),
                non_rc_gateway=r.get("non_rc_gateway", "0.0.0.0"),
                interface=r.get("interface", ""),
                is_tunnel_route=r.get("is_tunnel_route", False),
                tunnel_parent=r.get("tunnel_parent", ""),
                install_date=r.get("install_date"),
            )
            for r in routes_raw
        ]
        return RouteListResponse(
            device_id=device_id,
            device_name=device.name,
            vdom=target_vdom,
            total=len(routes),
            routes=routes,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch routes: {exc}")


@router.get("/{device_id}/vdoms", response_model=VDOMListResponse)
async def get_device_vdoms(device_id: int, db: AsyncSession = Depends(get_db)):
    """Get all VDOMs for a device with live enrichment.

    Fetches VDOM list from FortiGate, then queries per-VDOM settings
    (opmode, ngfw-mode, vdom-type) and counts interfaces/policies per VDOM.

    Data sources (verified 2026-04-13):
      - /api/v2/cmdb/system/vdom         → VDOM list (name, short-name, vcluster-id)
      - /api/v2/cmdb/system/settings     → per-VDOM settings (opmode, ngfw-mode, vdom-type)
      - /api/v2/cmdb/system/interface    → interface count per VDOM
      - /api/v2/cmdb/firewall/policy     → policy count per VDOM
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    try:
        vdoms_raw = await api.get_vdoms()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch VDOMs: {exc}")

    vdom_details: list[VDOMDetail] = []

    for vdata in vdoms_raw:
        vdom_name = vdata.get("name", "")
        short_name = vdata.get("short-name", vdom_name)
        vcluster_id = vdata.get("vcluster-id", 0)

        # Fetch per-VDOM settings (opmode, ngfw-mode, vdom-type)
        opmode = "nat"
        ngfw_mode = "profile-based"
        vdom_type = "traffic"
        vdom_status = "enable"
        comments = ""
        try:
            settings = await api.get_vdom_settings(vdom_name)
            opmode = settings.get("opmode", "nat")
            ngfw_mode = settings.get("ngfw-mode", "profile-based")
            vdom_type = settings.get("vdom-type", "traffic")
            vdom_status = settings.get("status", "enable")
            comments = settings.get("comments", "")
        except Exception:
            pass

        # Count interfaces in this VDOM
        iface_count = 0
        try:
            ifaces = await api.get_interfaces(vdom=vdom_name)
            iface_count = len(ifaces)
        except Exception:
            pass

        # Count policies in this VDOM
        pol_count = 0
        try:
            policies = await api.get_policies(vdom=vdom_name)
            pol_count = len(policies)
        except Exception:
            pass

        vdom_details.append(VDOMDetail(
            name=vdom_name,
            short_name=short_name,
            vdom_type=vdom_type,
            opmode=opmode,
            ngfw_mode=ngfw_mode,
            status=vdom_status,
            vcluster_id=vcluster_id,
            comments=comments,
            interface_count=iface_count,
            policy_count=pol_count,
        ))

        # Sync to DB
        existing = await db.execute(
            select(VDOM).where(VDOM.device_id == device.id, VDOM.name == vdom_name)
        )
        vdom_record = existing.scalar_one_or_none()
        if not vdom_record:
            vdom_record = VDOM(device_id=device.id, name=vdom_name)
            db.add(vdom_record)
        vdom_record.mode = opmode
        vdom_record.status = vdom_status
        vdom_record.interface_count = iface_count
        vdom_record.policy_count = pol_count

    await db.flush()

    return VDOMListResponse(
        device_id=device_id,
        device_name=device.name,
        vdom_count=len(vdom_details),
        vdoms=vdom_details,
    )


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


@router.get("/{device_id}/routes/summary", response_model=RoutingSummary)
async def get_routing_summary(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Target VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get routing table summary (route counts by type).

    Data sources:
      - /api/v2/monitor/router/ipv4       → route list (counted by type)
      - /api/v2/monitor/router/statistics  → total_lines_ipv4/ipv6
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        routes_raw = await api.get_routes(vdom=target_vdom)
        by_type: dict[str, int] = {}
        for r in routes_raw:
            rtype = r.get("type", "unknown")
            by_type[rtype] = by_type.get(rtype, 0) + 1

        return RoutingSummary(
            device_id=device_id,
            device_name=device.name,
            vdom=target_vdom,
            total_routes=len(routes_raw),
            by_type=by_type,
            total_routes_ipv4=len(routes_raw),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch routing summary: {exc}")


@router.get("/{device_id}/bgp", response_model=BGPStatusResponse)
async def get_device_bgp(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Target VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get BGP status: configuration summary + live neighbor states.

    Combines two data sources:
      - /api/v2/cmdb/router/bgp         → config (ASN, router-id, neighbors configured)
      - /api/v2/monitor/router/bgp/neighbors → live neighbor states (Established/Idle/etc.)

    Real neighbor states (verified 2026-04-13):
      Idle, Connect, Active, OpenSent, OpenConfirm, Established
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    # Fetch BGP config (CMDB)
    bgp_config = BGPConfig()
    try:
        config_raw = await api.get_bgp_config(vdom=target_vdom)
        if isinstance(config_raw, dict):
            neighbors_cfg = config_raw.get("neighbor", [])
            networks_cfg = config_raw.get("network", [])
            bgp_config = BGPConfig(
                local_as=str(config_raw.get("as", "")),
                router_id=config_raw.get("router-id", ""),
                keepalive_timer=config_raw.get("keepalive-timer", 60),
                holdtime_timer=config_raw.get("holdtime-timer", 180),
                neighbor_count=len(neighbors_cfg),
                network_count=len(networks_cfg),
                neighbors_configured=[
                    {"ip": n.get("ip", ""), "remote_as": n.get("remote-as", ""), "update_source": n.get("update-source", "")}
                    for n in neighbors_cfg
                ],
            )
    except Exception:
        pass

    # Fetch live neighbor status (monitor)
    neighbors: list[BGPNeighborStatus] = []
    try:
        neighbors_raw = await api.get_bgp_neighbors(vdom=target_vdom)
        for n in neighbors_raw:
            neighbors.append(BGPNeighborStatus(
                neighbor_ip=n.get("neighbor_ip", ""),
                local_ip=n.get("local_ip", ""),
                remote_as=n.get("remote_as", 0),
                admin_status=n.get("admin_status", True),
                state=n.get("state", "Unknown"),
                type=n.get("type", "ipv4"),
            ))
    except Exception:
        pass

    return BGPStatusResponse(
        device_id=device_id,
        device_name=device.name,
        vdom=target_vdom,
        config=bgp_config,
        neighbors=neighbors,
    )


@router.get("/{device_id}/ospf", response_model=OSPFStatusResponse)
async def get_device_ospf(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Target VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get live OSPF neighbor states.

    Data source: /api/v2/monitor/router/ospf/neighbors

    Real neighbor states (verified 2026-04-13):
      Full, 2-Way, Init, Down, ExStart, Exchange, Loading
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    neighbors: list[OSPFNeighborStatus] = []
    try:
        neighbors_raw = await api.get_ospf_neighbors(vdom=target_vdom)
        for n in neighbors_raw:
            neighbors.append(OSPFNeighborStatus(
                neighbor_ip=n.get("neighbor_ip", ""),
                router_id=n.get("router_id", ""),
                state=n.get("state", "Unknown"),
                priority=n.get("priority", 1),
            ))
    except Exception:
        pass

    return OSPFStatusResponse(
        device_id=device_id,
        device_name=device.name,
        vdom=target_vdom,
        neighbors=neighbors,
    )


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
        output["resource_usage"] = await api.get_resource_usage()
    except Exception as exc:
        output["resource_usage_error"] = str(exc)

    try:
        output["ha_status"] = await api.get_ha_status()
    except Exception as exc:
        output["ha_error"] = str(exc)

    try:
        output["web_ui_state"] = await api._get("/api/v2/monitor/web-ui/state")
    except Exception as exc:
        output["web_ui_error"] = str(exc)

    return output
