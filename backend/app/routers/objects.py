"""Firewall objects router — addresses, services, groups.

Reads objects live from FortiGate devices (no local DB cache).
Supports creating new objects and pushing them to specific VDOMs.

IMPORTANT: Fixed paths (e.g. /push-to-many/...) must be registered
BEFORE parameterised paths (e.g. /{device_id}/...) to avoid FastAPI
matching "push-to-many" as a device_id integer.
"""
import asyncio
import ipaddress
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device
from app.services.fortigate_api import FortiGateAPI

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/objects", tags=["objects"])


# ---------------------------------------------------------------------------
# Pydantic schemas with validation
# ---------------------------------------------------------------------------

class AddressCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=63, pattern=r'^[A-Za-z0-9_. -]+$')
    type: str = Field(default="ipmask")  # ipmask, iprange, fqdn
    subnet: Optional[str] = None
    start_ip: Optional[str] = Field(default=None, alias="start-ip")
    end_ip: Optional[str] = Field(default=None, alias="end-ip")
    fqdn: Optional[str] = None
    comment: str = ""
    associated_interface: str = Field(default="", alias="associated-interface")

    class Config:
        populate_by_name = True

    @field_validator("subnet")
    @classmethod
    def validate_subnet(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if "/" in v:
            try:
                ipaddress.ip_network(v, strict=False)
            except ValueError:
                raise ValueError(f"Invalid CIDR subnet: {v}")
        else:
            parts = v.split()
            if len(parts) == 2:
                try:
                    ipaddress.ip_address(parts[0])
                    ipaddress.ip_address(parts[1])
                except ValueError:
                    raise ValueError(f"Invalid IP/mask pair: {v}")
            else:
                try:
                    ipaddress.ip_address(v)
                    v = f"{v}/32"
                except ValueError:
                    raise ValueError(
                        f"Invalid subnet format: {v}. Use CIDR (10.0.0.0/24) or IP MASK (10.0.0.0 255.255.255.0)"
                    )
        return v

    @field_validator("start_ip", "end_ip")
    @classmethod
    def validate_ip(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        try:
            ipaddress.ip_address(v)
        except ValueError:
            raise ValueError(f"Invalid IP address: {v}")
        return v

    @field_validator("fqdn")
    @classmethod
    def validate_fqdn(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not re.match(r'^[a-zA-Z0-9*]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$', v):
            raise ValueError(f"Invalid FQDN: {v}")
        return v


class ServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=63, pattern=r'^[A-Za-z0-9_. -]+$')
    protocol: str = "TCP/UDP/SCTP"
    tcp_portrange: str = Field(default="", alias="tcp-portrange")
    udp_portrange: str = Field(default="", alias="udp-portrange")
    comment: str = ""

    class Config:
        populate_by_name = True

    @field_validator("tcp_portrange", "udp_portrange")
    @classmethod
    def validate_portrange(cls, v: str) -> str:
        if not v:
            return v
        v = v.strip()
        for part in v.split():
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                lo, hi = part.split("-", 1)
                if not (lo.isdigit() and hi.isdigit() and 1 <= int(lo) <= 65535 and 1 <= int(hi) <= 65535):
                    raise ValueError(f"Invalid port range: {part}")
            elif ":" in part:
                dp, sp = part.split(":", 1)
                if not (dp.isdigit() and sp.isdigit()):
                    raise ValueError(f"Invalid port spec: {part}")
            else:
                if not (part.isdigit() and 1 <= int(part) <= 65535):
                    raise ValueError(f"Invalid port: {part}")
        return v


class PushTarget(BaseModel):
    device_id: int
    vdom: str = "root"


class PushAddressToManyRequest(BaseModel):
    address: AddressCreate
    targets: list[PushTarget]


class PushServiceToManyRequest(BaseModel):
    service: ServiceCreate
    targets: list[PushTarget]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def _get_device(db: AsyncSession, device_id: int) -> Device:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def _build_address_data(addr: AddressCreate) -> dict:
    data: dict = {"name": addr.name, "type": addr.type, "comment": addr.comment}
    if addr.type == "ipmask":
        subnet = addr.subnet or ""
        if "/" in subnet:
            net = ipaddress.ip_network(subnet, strict=False)
            subnet = f"{net.network_address} {net.netmask}"
        data["subnet"] = subnet
    elif addr.type == "iprange":
        data["start-ip"] = addr.start_ip
        data["end-ip"] = addr.end_ip
    elif addr.type == "fqdn":
        data["fqdn"] = addr.fqdn
    if addr.associated_interface:
        data["associated-interface"] = addr.associated_interface
    return data


def _build_service_data(svc: ServiceCreate) -> dict:
    data: dict = {"name": svc.name, "protocol": svc.protocol, "comment": svc.comment}
    if svc.tcp_portrange:
        data["tcp-portrange"] = svc.tcp_portrange
    if svc.udp_portrange:
        data["udp-portrange"] = svc.udp_portrange
    return data


# ---------------------------------------------------------------------------
# FIXED PATHS — must come before /{device_id}/... routes
# ---------------------------------------------------------------------------

@router.post("/push-to-many/addresses")
async def push_address_to_many(
    payload: PushAddressToManyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Push a firewall address object to multiple devices/VDOMs in parallel."""
    addr = payload.address

    async def _push_one(target: PushTarget) -> dict:
        try:
            device = await _get_device(db, target.device_id)
        except HTTPException:
            return {
                "device_id": target.device_id,
                "device_name": f"ID:{target.device_id}",
                "vdom": target.vdom,
                "success": False,
                "error": "Device not found",
            }
        api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
        try:
            data = _build_address_data(addr)
            await api.create_firewall_address(data, vdom=target.vdom)
            return {"device_id": target.device_id, "device_name": device.name, "vdom": target.vdom, "success": True}
        except Exception as exc:
            return {"device_id": target.device_id, "device_name": device.name, "vdom": target.vdom, "success": False, "error": str(exc)}

    results = await asyncio.gather(*[_push_one(t) for t in payload.targets])
    success_count = sum(1 for r in results if r["success"])
    return {
        "message": f"Pushed '{addr.name}' to {success_count}/{len(payload.targets)} targets",
        "object_name": addr.name,
        "results": list(results),
    }


@router.post("/push-to-many/services")
async def push_service_to_many(
    payload: PushServiceToManyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Push a firewall service object to multiple devices/VDOMs in parallel."""
    svc = payload.service

    if not svc.tcp_portrange and not svc.udp_portrange:
        raise HTTPException(status_code=422, detail="At least one of tcp-portrange or udp-portrange is required")

    async def _push_one(target: PushTarget) -> dict:
        try:
            device = await _get_device(db, target.device_id)
        except HTTPException:
            return {
                "device_id": target.device_id,
                "device_name": f"ID:{target.device_id}",
                "vdom": target.vdom,
                "success": False,
                "error": "Device not found",
            }
        api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
        try:
            data = _build_service_data(svc)
            await api.create_firewall_service(data, vdom=target.vdom)
            return {"device_id": target.device_id, "device_name": device.name, "vdom": target.vdom, "success": True}
        except Exception as exc:
            return {"device_id": target.device_id, "device_name": device.name, "vdom": target.vdom, "success": False, "error": str(exc)}

    results = await asyncio.gather(*[_push_one(t) for t in payload.targets])
    success_count = sum(1 for r in results if r["success"])
    return {
        "message": f"Pushed '{svc.name}' to {success_count}/{len(payload.targets)} targets",
        "object_name": svc.name,
        "results": list(results),
    }


# ---------------------------------------------------------------------------
# PARAMETERISED PATHS — after all fixed paths
# ---------------------------------------------------------------------------

@router.get("/{device_id}/addresses")
async def list_addresses(
    device_id: int,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_device(db, device_id)
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        raw = await api.get_firewall_addresses(vdom=target_vdom)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch addresses: {exc}")

    return {
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "total": len(raw),
        "addresses": [
            {
                "name": a.get("name", ""),
                "type": a.get("type", "ipmask"),
                "subnet": a.get("subnet", ""),
                "start_ip": a.get("start-ip", ""),
                "end_ip": a.get("end-ip", ""),
                "fqdn": a.get("fqdn", ""),
                "comment": a.get("comment", ""),
                "associated_interface": a.get("associated-interface", ""),
                "color": a.get("color", 0),
                "fabric_object": a.get("fabric-object", "disable"),
            }
            for a in raw
        ],
    }


@router.get("/{device_id}/services")
async def list_services(
    device_id: int,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_device(db, device_id)
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        raw = await api.get_firewall_services(vdom=target_vdom)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch services: {exc}")

    return {
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "total": len(raw),
        "services": [
            {
                "name": s.get("name", ""),
                "protocol": s.get("protocol", ""),
                "tcp_portrange": s.get("tcp-portrange", ""),
                "udp_portrange": s.get("udp-portrange", ""),
                "category": s.get("category", ""),
                "comment": s.get("comment", ""),
                "color": s.get("color", 0),
            }
            for s in raw
        ],
    }


@router.get("/{device_id}/address-groups")
async def list_address_groups(
    device_id: int,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_device(db, device_id)
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        raw = await api.get_firewall_address_groups(vdom=target_vdom)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch address groups: {exc}")

    return {
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "total": len(raw),
        "groups": [
            {
                "name": g.get("name", ""),
                "member": [m.get("name", "") for m in g.get("member", [])],
                "comment": g.get("comment", ""),
                "color": g.get("color", 0),
            }
            for g in raw
        ],
    }


@router.get("/{device_id}/service-groups")
async def list_service_groups(
    device_id: int,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_device(db, device_id)
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    try:
        raw = await api.get_firewall_service_groups(vdom=target_vdom)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch service groups: {exc}")

    return {
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "total": len(raw),
        "groups": [
            {
                "name": g.get("name", ""),
                "member": [m.get("name", "") for m in g.get("member", [])],
                "comment": g.get("comment", ""),
                "color": g.get("color", 0),
            }
            for g in raw
        ],
    }


@router.post("/{device_id}/addresses")
async def create_address(
    device_id: int,
    payload: AddressCreate,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_device(db, device_id)
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    if payload.type == "ipmask" and not payload.subnet:
        raise HTTPException(status_code=422, detail="subnet is required for type ipmask")
    if payload.type == "iprange" and (not payload.start_ip or not payload.end_ip):
        raise HTTPException(status_code=422, detail="start-ip and end-ip are required for type iprange")
    if payload.type == "fqdn" and not payload.fqdn:
        raise HTTPException(status_code=422, detail="fqdn is required for type fqdn")
    if payload.type not in ("ipmask", "iprange", "fqdn"):
        raise HTTPException(status_code=422, detail=f"Unsupported address type: {payload.type}")

    data = _build_address_data(payload)

    try:
        await api.create_firewall_address(data, vdom=target_vdom)
    except Exception as exc:
        detail = str(exc)
        if hasattr(exc, 'response'):
            try:
                detail = exc.response.json().get("cli_error", detail)
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"Failed to create address: {detail}")

    return {
        "success": True,
        "message": f"Address '{payload.name}' created on {device.name} (VDOM: {target_vdom})",
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "object": data,
    }


@router.post("/{device_id}/services")
async def create_service(
    device_id: int,
    payload: ServiceCreate,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_device(db, device_id)
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    target_vdom = vdom or (device.vdom_list[0] if device.vdom_list else "root")

    if not payload.tcp_portrange and not payload.udp_portrange:
        raise HTTPException(status_code=422, detail="At least one of tcp-portrange or udp-portrange is required")

    data = _build_service_data(payload)

    try:
        await api.create_firewall_service(data, vdom=target_vdom)
    except Exception as exc:
        detail = str(exc)
        if hasattr(exc, 'response'):
            try:
                detail = exc.response.json().get("cli_error", detail)
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"Failed to create service: {detail}")

    return {
        "success": True,
        "message": f"Service '{payload.name}' created on {device.name} (VDOM: {target_vdom})",
        "device_id": device_id,
        "device_name": device.name,
        "vdom": target_vdom,
        "object": data,
    }


@router.post("/{device_id}/sync-all")
async def sync_all_vdom_policies(
    device_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Sync policies from ALL VDOMs on a device."""
    device = await _get_device(db, device_id)

    from app.routers.policies import sync_policies

    vdoms = device.vdom_list or ["root"]
    results = []
    for vdom_name in vdoms:
        try:
            result = await sync_policies(device_id=device_id, vdom=vdom_name, db=db)
            results.append({"vdom": vdom_name, "success": True, "message": result.message})
        except Exception as exc:
            results.append({"vdom": vdom_name, "success": False, "error": str(exc)})

    total_synced = sum(1 for r in results if r["success"])
    return {
        "message": f"Synced {total_synced}/{len(vdoms)} VDOMs on {device.name}",
        "results": results,
    }
