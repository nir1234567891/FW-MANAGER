from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.services import tunnel_mapper
from app.services.fortigate_api import FortiGateAPI
from app.models import VPNTunnel, Device
from app.schemas import (
    TunnelDetail,
    TunnelSummary,
    TunnelDiscoveryResult,
    IPsecPhase1Config,
    IPsecPhase2Config,
)

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
        "uptime": t.uptime_seconds or 0,
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


@router.get("", response_model=list[TunnelDetail])
async def list_tunnels(db: AsyncSession = Depends(get_db)):
    """List all VPN tunnels across all devices."""
    tunnels = await tunnel_mapper.get_all_tunnels(db)
    result = []
    for t in tunnels:
        result.append(await _tunnel_to_dict(t, db))
    return result


@router.get("/topology")
async def get_topology(db: AsyncSession = Depends(get_db)):
    topology = await tunnel_mapper.build_topology(db)
    return topology


@router.post("/discover", response_model=TunnelDiscoveryResult)
async def discover_tunnels(db: AsyncSession = Depends(get_db)):
    """Discover IPsec tunnels from all managed FortiGate devices."""
    try:
        result = await tunnel_mapper.discover_tunnels(db)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Tunnel discovery failed: {exc}")


@router.get("/summary", response_model=TunnelSummary)
async def tunnel_summary(db: AsyncSession = Depends(get_db)):
    """Get summary of tunnel status (total, up, down, health %)."""
    summary = await tunnel_mapper.get_tunnel_status_summary(db)
    return summary


@router.get("/{device_id}", response_model=list[TunnelDetail])
async def get_device_tunnels(device_id: int, db: AsyncSession = Depends(get_db)):
    """Get all tunnels for a specific device (from database)."""
    tunnels = await tunnel_mapper.get_device_tunnels(db, device_id)
    result = []
    for t in tunnels:
        result.append(await _tunnel_to_dict(t, db))
    return result


@router.get("/{device_id}/live")
async def get_device_tunnels_live(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Target VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get live IPsec tunnel status directly from FortiGate (no DB).

    Real monitor structure (verified 2026-04-13):
      Each tunnel has: name, rgwy, connection_count, creation_time (uptime secs),
      incoming_bytes, outgoing_bytes, type, proxyid[].status

    NOTE: There is NO top-level 'status' field. Status is per proxyid.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        tunnels_raw = await api.get_vpn_tunnels(vdom=target_vdom)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch tunnels: {exc}")

    tunnels = []
    for t in tunnels_raw:
        # Determine tunnel status from proxyid (no top-level status!)
        proxyids = t.get("proxyid", [])
        p2_statuses = []
        for pid in proxyids:
            p2_statuses.append({
                "p2name": pid.get("p2name", ""),
                "status": pid.get("status", "down"),
                "expire": pid.get("expire", 0),
                "incoming_bytes": pid.get("incoming_bytes", 0),
                "outgoing_bytes": pid.get("outgoing_bytes", 0),
                "proxy_src": [s.get("subnet", "") for s in pid.get("proxy_src", [])],
                "proxy_dst": [s.get("subnet", "") for s in pid.get("proxy_dst", [])],
            })

        # Overall status: up if ANY proxyid is up
        overall_status = "up" if any(p.get("status") == "up" for p in proxyids) else "down"

        tunnels.append({
            "name": t.get("name", ""),
            "status": overall_status,
            "remote_gateway": t.get("rgwy", ""),
            "type": t.get("type", ""),  # "automatic" or "dialup"
            "connection_count": t.get("connection_count", 0),
            "uptime_seconds": t.get("creation_time", 0),
            "incoming_bytes": t.get("incoming_bytes", 0),
            "outgoing_bytes": t.get("outgoing_bytes", 0),
            "tun_id": t.get("tun_id", ""),
            "comments": t.get("comments", ""),
            "phase2_selectors": p2_statuses,
        })

    return {
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "tunnels": tunnels,
    }


@router.get("/{device_id}/phase1")
async def get_device_phase1_config(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Target VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get IPsec Phase 1 (IKE gateway) configurations from FortiGate.

    Real structure (verified 2026-04-13): 150+ fields per phase1-interface.
    Key fields: name, type, interface, ike-version, remote-gw, authmethod,
    proposal, dhgrp, nattraversal, dpd, keylife.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        raw = await api._get("/api/v2/cmdb/vpn.ipsec/phase1-interface", vdom=target_vdom)
        phase1_list = raw.get("results", [])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Phase 1 config: {exc}")

    configs = []
    for p1 in phase1_list:
        try:
            configs.append(IPsecPhase1Config(**p1))
        except Exception:
            configs.append(IPsecPhase1Config(name=p1.get("name", "unknown")))

    return {
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "phase1_interfaces": [c.model_dump(by_alias=True) for c in configs],
    }


@router.get("/{device_id}/phase2")
async def get_device_phase2_config(
    device_id: int,
    vdom: Optional[str] = Query(None, description="Target VDOM"),
    db: AsyncSession = Depends(get_db),
):
    """Get IPsec Phase 2 (selector/child SA) configurations from FortiGate.

    Real structure (verified 2026-04-13): name, phase1name, proposal, pfs,
    dhgrp, keylifeseconds, src-subnet, dst-subnet, encapsulation.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        raw = await api._get("/api/v2/cmdb/vpn.ipsec/phase2-interface", vdom=target_vdom)
        phase2_list = raw.get("results", [])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Phase 2 config: {exc}")

    configs = []
    for p2 in phase2_list:
        try:
            configs.append(IPsecPhase2Config(**p2))
        except Exception:
            configs.append(IPsecPhase2Config(name=p2.get("name", "unknown")))

    return {
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "phase2_interfaces": [c.model_dump(by_alias=True) for c in configs],
    }
