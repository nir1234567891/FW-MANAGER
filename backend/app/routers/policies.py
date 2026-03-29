from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, Policy
from app.services.fortigate_api import FortiGateAPI

router = APIRouter(prefix="/api/policies", tags=["policies"])


def _policy_to_dict(p: Policy) -> dict:
    return {
        "id": p.id,
        "device_id": p.device_id,
        "vdom_name": p.vdom_name,
        "policy_id": p.policy_id,
        "name": p.name,
        "srcintf": p.srcintf,
        "dstintf": p.dstintf,
        "srcaddr": p.srcaddr,
        "dstaddr": p.dstaddr,
        "action": p.action,
        "service": p.service,
        "schedule": p.schedule,
        "nat": p.nat,
        "status": p.status,
        "logtraffic": p.logtraffic,
        "comments": p.comments,
        "hit_count": p.hit_count,
    }


@router.get("/{device_id}")
async def get_device_policies(
    device_id: int,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    stmt = select(Policy).where(Policy.device_id == device_id).order_by(Policy.policy_id)
    if vdom:
        stmt = stmt.where(Policy.vdom_name == vdom)

    pol_result = await db.execute(stmt)
    policies = pol_result.scalars().all()

    return {
        "device_id": device_id,
        "device_name": device.name,
        "policies": [_policy_to_dict(p) for p in policies],
    }


@router.get("/{device_id}/summary")
async def get_policy_summary(
    device_id: int,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    base_filter = Policy.device_id == device_id
    if vdom:
        base_filter = (Policy.device_id == device_id) & (Policy.vdom_name == vdom)

    total_result = await db.execute(select(func.count(Policy.id)).where(base_filter))
    total = total_result.scalar() or 0

    accept_result = await db.execute(
        select(func.count(Policy.id)).where(base_filter, Policy.action == "accept")
    )
    accept_count = accept_result.scalar() or 0

    deny_result = await db.execute(
        select(func.count(Policy.id)).where(base_filter, Policy.action == "deny")
    )
    deny_count = deny_result.scalar() or 0

    disabled_result = await db.execute(
        select(func.count(Policy.id)).where(base_filter, Policy.status == "disable")
    )
    disabled_count = disabled_result.scalar() or 0

    return {
        "device_id": device_id,
        "device_name": device.name,
        "total": total,
        "accept": accept_count,
        "deny": deny_count,
        "ipsec": total - accept_count - deny_count,
        "disabled": disabled_count,
        "enabled": total - disabled_count,
    }


@router.post("/{device_id}/sync")
async def sync_policies(
    device_id: int,
    vdom: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    try:
        vdom_name = vdom or "root"
        policies_data = await api.get_policies(vdom=vdom_name)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to sync policies: {exc}")

    synced = 0
    for pdata in policies_data:
        pid = pdata.get("policyid", 0)
        existing_result = await db.execute(
            select(Policy).where(
                Policy.device_id == device_id,
                Policy.vdom_name == vdom_name,
                Policy.policy_id == pid,
            )
        )
        policy = existing_result.scalar_one_or_none()

        src_intf = pdata.get("srcintf", [])
        dst_intf = pdata.get("dstintf", [])
        src_addr = pdata.get("srcaddr", [])
        dst_addr = pdata.get("dstaddr", [])
        svc = pdata.get("service", [])

        srcintf_str = ", ".join(i.get("name", "") for i in src_intf) if isinstance(src_intf, list) else str(src_intf)
        dstintf_str = ", ".join(i.get("name", "") for i in dst_intf) if isinstance(dst_intf, list) else str(dst_intf)
        srcaddr_str = ", ".join(a.get("name", "") for a in src_addr) if isinstance(src_addr, list) else str(src_addr)
        dstaddr_str = ", ".join(a.get("name", "") for a in dst_addr) if isinstance(dst_addr, list) else str(dst_addr)
        service_str = ", ".join(s.get("name", "") for s in svc) if isinstance(svc, list) else str(svc)

        fields = {
            "name": pdata.get("name", f"Policy-{pid}"),
            "srcintf": srcintf_str,
            "dstintf": dstintf_str,
            "srcaddr": srcaddr_str,
            "dstaddr": dstaddr_str,
            "action": pdata.get("action", "accept"),
            "service": service_str,
            "schedule": pdata.get("schedule", "always"),
            "nat": pdata.get("nat", "disable"),
            "status": pdata.get("status", "enable"),
            "logtraffic": pdata.get("logtraffic", "all"),
            "comments": pdata.get("comments", ""),
        }

        if policy:
            for k, v in fields.items():
                setattr(policy, k, v)
        else:
            policy = Policy(
                device_id=device_id,
                vdom_name=vdom_name,
                policy_id=pid,
                **fields,
            )
            db.add(policy)

        synced += 1

    await db.flush()
    return {"message": f"Synced {synced} policies from {device.name}", "synced": synced}
