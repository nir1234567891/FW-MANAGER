from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, Policy
from app.services.fortigate_api import FortiGateAPI
from app.schemas import (
    FirewallPolicySimplified,
    PolicyListResponse,
    PolicySummary,
    PolicySyncResult,
)

router = APIRouter(prefix="/api/policies", tags=["policies"])


def _extract_names_from_objects(obj_list: list) -> str:
    """Extract comma-separated names from FortiGate object list.

    FortiGate returns arrays like: [{"name": "port1", "q_origin_key": "port1"}]
    This converts to: "port1, port2, ..."
    """
    if not obj_list or not isinstance(obj_list, list):
        return ""
    return ", ".join(obj.get("name", "") for obj in obj_list if isinstance(obj, dict))


def _policy_to_simplified(p: Policy) -> FirewallPolicySimplified:
    """Convert SQLAlchemy Policy model to simplified Pydantic schema.

    Converts JSON arrays to comma-separated strings for easier frontend display.
    """
    return FirewallPolicySimplified(
        policyid=p.policy_id,
        name=p.name or f"Policy-{p.policy_id}",
        status=p.status,
        action=p.action,
        srcintf=_extract_names_from_objects(p.srcintf),
        dstintf=_extract_names_from_objects(p.dstintf),
        srcaddr=_extract_names_from_objects(p.srcaddr),
        dstaddr=_extract_names_from_objects(p.dstaddr),
        service=_extract_names_from_objects(p.service),
        nat=p.nat,
        schedule=p.schedule,
        logtraffic=p.logtraffic,
        comments=p.comments or "",
        uuid=p.uuid or "",
        hit_count=p.hit_count,
    )


@router.get("/{device_id}", response_model=PolicyListResponse)
async def get_device_policies(
    device_id: int,
    vdom: Optional[str] = Query("root", description="VDOM name"),
    db: AsyncSession = Depends(get_db),
):
    """Get all firewall policies for a device.

    Returns simplified policy representation with comma-separated object names.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    stmt = select(Policy).where(Policy.device_id == device_id).order_by(Policy.policy_id)
    if vdom:
        stmt = stmt.where(Policy.vdom_name == vdom)

    pol_result = await db.execute(stmt)
    policies = pol_result.scalars().all()

    return PolicyListResponse(
        device_id=device_id,
        device_name=device.name,
        vdom_name=vdom or "root",
        policies=[_policy_to_simplified(p) for p in policies],
    )


@router.get("/{device_id}/summary", response_model=PolicySummary)
async def get_policy_summary(
    device_id: int,
    vdom: Optional[str] = Query("root", description="VDOM name"),
    db: AsyncSession = Depends(get_db),
):
    """Get summary statistics for device policies.

    Returns counts for total, accept, deny, enabled, disabled, NAT, and UTM policies.
    """
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

    nat_result = await db.execute(
        select(func.count(Policy.id)).where(base_filter, Policy.nat == "enable")
    )
    nat_count = nat_result.scalar() or 0

    utm_result = await db.execute(
        select(func.count(Policy.id)).where(base_filter, Policy.utm_status == "enable")
    )
    utm_count = utm_result.scalar() or 0

    return PolicySummary(
        device_id=device_id,
        device_name=device.name,
        vdom_name=vdom or "root",
        total=total,
        accept=accept_count,
        deny=deny_count,
        enabled=total - disabled_count,
        disabled=disabled_count,
        with_nat=nat_count,
        with_utm=utm_count,
    )


@router.get("/{device_id}/policy/{policy_id}/full")
async def get_policy_full_structure(
    device_id: int,
    policy_id: int,
    vdom: Optional[str] = Query("root", description="VDOM name"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single policy with full JSON structure (not simplified).

    Returns raw arrays as stored in database, useful for debugging or advanced use cases.
    """
    result = await db.execute(
        select(Policy).where(
            Policy.device_id == device_id,
            Policy.policy_id == policy_id,
            Policy.vdom_name == vdom,
        )
    )
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    return {
        "policyid": policy.policy_id,
        "name": policy.name,
        "uuid": policy.uuid,
        "status": policy.status,
        "action": policy.action,
        # Return JSON arrays as-is
        "srcintf": policy.srcintf,
        "dstintf": policy.dstintf,
        "srcaddr": policy.srcaddr,
        "dstaddr": policy.dstaddr,
        "srcaddr6": policy.srcaddr6,
        "dstaddr6": policy.dstaddr6,
        "service": policy.service,
        # NAT
        "nat": policy.nat,
        "ippool": policy.ippool,
        "poolname": policy.poolname,
        "natip": policy.natip,
        # Security
        "utm_status": policy.utm_status,
        "inspection_mode": policy.inspection_mode,
        "av_profile": policy.av_profile,
        "webfilter_profile": policy.webfilter_profile,
        "ips_sensor": policy.ips_sensor,
        "application_list": policy.application_list,
        "ssl_ssh_profile": policy.ssl_ssh_profile,
        # Logging
        "logtraffic": policy.logtraffic,
        "logtraffic_start": policy.logtraffic_start,
        # Other
        "schedule": policy.schedule,
        "comments": policy.comments,
        "hit_count": policy.hit_count,
    }


@router.post("/{device_id}/sync", response_model=PolicySyncResult)
async def sync_policies(
    device_id: int,
    vdom: Optional[str] = Query("root", description="VDOM name"),
    db: AsyncSession = Depends(get_db),
):
    """Sync firewall policies from FortiGate device to database.

    Fetches policies from FortiGate API and stores them with full JSON structure.
    Arrays (srcintf, dstaddr, service, etc.) are preserved as JSON, not flattened to strings.
    """
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

    created = 0
    updated = 0
    errors = []

    for pdata in policies_data:
        try:
            pid = pdata.get("policyid", 0)
            if not pid:
                errors.append(f"Policy missing policyid: {pdata.get('name', 'unknown')}")
                continue

            existing_result = await db.execute(
                select(Policy).where(
                    Policy.device_id == device_id,
                    Policy.vdom_name == vdom_name,
                    Policy.policy_id == pid,
                )
            )
            policy = existing_result.scalar_one_or_none()

            # Store arrays as JSON directly - NO string conversion!
            fields = {
                "name": pdata.get("name", f"Policy-{pid}"),
                "uuid": pdata.get("uuid", ""),
                # Store arrays as-is (will be JSON in database)
                "srcintf": pdata.get("srcintf", []),
                "dstintf": pdata.get("dstintf", []),
                "srcaddr": pdata.get("srcaddr", []),
                "dstaddr": pdata.get("dstaddr", []),
                "srcaddr6": pdata.get("srcaddr6", []),
                "dstaddr6": pdata.get("dstaddr6", []),
                "service": pdata.get("service", []),
                # Basic fields
                "action": pdata.get("action", "accept"),
                "schedule": pdata.get("schedule", "always"),
                "status": pdata.get("status", "enable"),
                # NAT fields
                "nat": pdata.get("nat", "disable"),
                "ippool": pdata.get("ippool", "disable"),
                "poolname": pdata.get("poolname", []),
                "natip": pdata.get("natip", "0.0.0.0 0.0.0.0"),
                # Security profiles
                "utm_status": pdata.get("utm-status", "disable"),
                "inspection_mode": pdata.get("inspection-mode", "flow"),
                "av_profile": pdata.get("av-profile", ""),
                "webfilter_profile": pdata.get("webfilter-profile", ""),
                "ips_sensor": pdata.get("ips-sensor", ""),
                "application_list": pdata.get("application-list", ""),
                "ssl_ssh_profile": pdata.get("ssl-ssh-profile", ""),
                # Logging
                "logtraffic": pdata.get("logtraffic", "all"),
                "logtraffic_start": pdata.get("logtraffic-start", "disable"),
                # Comments
                "comments": pdata.get("comments", ""),
            }

            if policy:
                # Update existing policy
                for k, v in fields.items():
                    setattr(policy, k, v)
                updated += 1
            else:
                # Create new policy
                policy = Policy(
                    device_id=device_id,
                    vdom_name=vdom_name,
                    policy_id=pid,
                    **fields,
                )
                db.add(policy)
                created += 1

        except Exception as exc:
            errors.append(f"Failed to sync policy {pid}: {str(exc)}")
            continue

    await db.flush()

    return PolicySyncResult(
        message=f"Synced {created + updated} policies from {device.name} (created: {created}, updated: {updated})",
        synced=created + updated,
        created=created,
        updated=updated,
        errors=errors,
    )
