import logging
import math
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Device, VPNTunnel
from app.services.fortigate_api import FortiGateAPI

logger = logging.getLogger(__name__)


async def discover_tunnels(db: AsyncSession) -> dict:
    stmt = select(Device).where(Device.status.in_(["online", "unknown"]))
    result = await db.execute(stmt)
    devices = list(result.scalars().all())

    discovered = 0
    errors = []

    for device in devices:
        try:
            api = FortiGateAPI(
                host=device.ip_address,
                port=device.port,
                api_key=device.api_key,
            )
            tunnels_data = await api.get_vpn_tunnels()

            existing_stmt = select(VPNTunnel).where(VPNTunnel.device_id == device.id)
            existing_result = await db.execute(existing_stmt)
            existing = {t.tunnel_name: t for t in existing_result.scalars().all()}

            for tdata in tunnels_data:
                tunnel_name = tdata.get("p2name", tdata.get("name", "unknown"))
                remote_gw = tdata.get("rgwy", tdata.get("remote_gateway", ""))
                phase1 = tdata.get("p1name", tdata.get("phase1", ""))
                phase2 = tdata.get("p2name", tdata.get("phase2", ""))
                incoming = int(tdata.get("incoming_bytes", 0))
                outgoing = int(tdata.get("outgoing_bytes", 0))
                tun_status = "up" if tdata.get("status", "") == "up" else "down"
                local_sub = tdata.get("proxy_src", [{}])
                remote_sub = tdata.get("proxy_dst", [{}])
                local_subnet = local_sub[0].get("subnet", "") if isinstance(local_sub, list) and local_sub else ""
                remote_subnet = remote_sub[0].get("subnet", "") if isinstance(remote_sub, list) and remote_sub else ""

                if tunnel_name in existing:
                    tunnel = existing[tunnel_name]
                    tunnel.remote_gateway = str(remote_gw)
                    tunnel.status = tun_status
                    tunnel.incoming_bytes = incoming
                    tunnel.outgoing_bytes = outgoing
                    tunnel.phase1_name = str(phase1)
                    tunnel.phase2_name = str(phase2)
                    tunnel.local_subnet = str(local_subnet)
                    tunnel.remote_subnet = str(remote_subnet)
                else:
                    tunnel = VPNTunnel(
                        device_id=device.id,
                        vdom_name="root",
                        tunnel_name=tunnel_name,
                        remote_gateway=str(remote_gw),
                        tunnel_type="ipsec",
                        status=tun_status,
                        incoming_bytes=incoming,
                        outgoing_bytes=outgoing,
                        phase1_name=str(phase1),
                        phase2_name=str(phase2),
                        local_subnet=str(local_subnet),
                        remote_subnet=str(remote_subnet),
                    )
                    db.add(tunnel)
                    discovered += 1

        except Exception as exc:
            logger.error("Tunnel discovery failed for %s: %s", device.name, exc)
            errors.append({"device": device.name, "error": str(exc)})

    await db.flush()
    await map_tunnel_endpoints(db)

    return {
        "devices_scanned": len(devices),
        "tunnels_discovered": discovered,
        "errors": errors,
    }


async def map_tunnel_endpoints(db: AsyncSession) -> int:
    device_result = await db.execute(select(Device))
    devices = list(device_result.scalars().all())
    ip_to_device = {d.ip_address: d for d in devices}

    tunnel_result = await db.execute(select(VPNTunnel))
    tunnels = list(tunnel_result.scalars().all())

    mapped = 0
    for tunnel in tunnels:
        if tunnel.remote_gateway and tunnel.remote_gateway in ip_to_device:
            remote_dev = ip_to_device[tunnel.remote_gateway]
            if tunnel.remote_device_id != remote_dev.id:
                tunnel.remote_device_id = remote_dev.id
                mapped += 1

    await db.flush()
    return mapped


async def build_topology(db: AsyncSession) -> dict:
    device_result = await db.execute(select(Device))
    devices = list(device_result.scalars().all())

    tunnel_result = await db.execute(select(VPNTunnel))
    tunnels = list(tunnel_result.scalars().all())

    nodes = []
    edges = []
    seen_edges: set[str] = set()

    num_devices = len(devices)
    center_x, center_y = 600, 400
    radius = 300

    for i, device in enumerate(devices):
        angle = (2 * math.pi * i) / max(num_devices, 1)
        x = center_x + radius * math.cos(angle)
        y = center_y + radius * math.sin(angle)

        status_color = {
            "online": "#22c55e",
            "offline": "#ef4444",
        }.get(device.status, "#f59e0b")

        nodes.append({
            "id": str(device.id),
            "type": "deviceNode",
            "position": {"x": round(x), "y": round(y)},
            "data": {
                "label": device.name,
                "ip": device.ip_address,
                "model": device.model or "Unknown",
                "status": device.status,
                "firmware": device.firmware_version or "",
                "serial": device.serial_number or "",
                "cpu": device.cpu_usage,
                "memory": device.memory_usage,
                "sessions": device.session_count,
                "color": status_color,
            },
        })

    for tunnel in tunnels:
        if not tunnel.remote_device_id:
            continue

        edge_key_fwd = f"{tunnel.device_id}-{tunnel.remote_device_id}"
        edge_key_rev = f"{tunnel.remote_device_id}-{tunnel.device_id}"
        if edge_key_fwd in seen_edges or edge_key_rev in seen_edges:
            continue
        seen_edges.add(edge_key_fwd)

        edge_color = "#22c55e" if tunnel.status == "up" else "#ef4444"
        animated = tunnel.status == "up"

        edges.append({
            "id": f"e{tunnel.device_id}-{tunnel.remote_device_id}",
            "source": str(tunnel.device_id),
            "target": str(tunnel.remote_device_id),
            "type": "smoothstep",
            "animated": animated,
            "label": tunnel.tunnel_name,
            "style": {"stroke": edge_color, "strokeWidth": 2},
            "data": {
                "tunnel_id": tunnel.id,
                "tunnel_name": tunnel.tunnel_name,
                "status": tunnel.status,
                "type": tunnel.tunnel_type,
                "incoming_bytes": tunnel.incoming_bytes,
                "outgoing_bytes": tunnel.outgoing_bytes,
                "local_subnet": tunnel.local_subnet,
                "remote_subnet": tunnel.remote_subnet,
            },
        })

    return {"nodes": nodes, "edges": edges}


async def get_tunnel_status_summary(db: AsyncSession) -> dict:
    total_result = await db.execute(select(func.count(VPNTunnel.id)))
    total = total_result.scalar() or 0

    up_result = await db.execute(
        select(func.count(VPNTunnel.id)).where(VPNTunnel.status == "up")
    )
    up_count = up_result.scalar() or 0

    down_result = await db.execute(
        select(func.count(VPNTunnel.id)).where(VPNTunnel.status == "down")
    )
    down_count = down_result.scalar() or 0

    return {
        "total": total,
        "up": up_count,
        "down": down_count,
        "health_percent": round((up_count / total * 100) if total > 0 else 0, 1),
    }


async def get_device_tunnels(
    db: AsyncSession, device_id: int
) -> list[VPNTunnel]:
    result = await db.execute(
        select(VPNTunnel).where(VPNTunnel.device_id == device_id)
    )
    return list(result.scalars().all())


async def get_all_tunnels(db: AsyncSession) -> list[VPNTunnel]:
    result = await db.execute(select(VPNTunnel))
    return list(result.scalars().all())
