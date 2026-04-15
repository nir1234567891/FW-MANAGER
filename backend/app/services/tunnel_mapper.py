import asyncio
import logging
import math
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Device, VPNTunnel
from app.services.fortigate_api import FortiGateAPI

logger = logging.getLogger(__name__)


def _parse_tunnel_data(tdata: dict, vdom_name: str) -> dict:
    """Parse raw FortiGate tunnel monitor data into a flat dict."""
    phase1 = tdata.get("name", "unknown")
    remote_gw = tdata.get("rgwy", "")

    proxyid = tdata.get("proxyid", [])
    if proxyid and isinstance(proxyid, list):
        pid = proxyid[0]
        tun_status = "up" if pid.get("status", "") == "up" else "down"
        incoming = int(pid.get("incoming_bytes", 0))
        outgoing = int(pid.get("outgoing_bytes", 0))
        local_sub = pid.get("proxy_src", [])
        remote_sub = pid.get("proxy_dst", [])
        phase2 = pid.get("p2name", "")
    else:
        tun_status = "down"
        incoming = int(tdata.get("incoming_bytes", 0))
        outgoing = int(tdata.get("outgoing_bytes", 0))
        local_sub = []
        remote_sub = []
        phase2 = ""

    local_subnet = ""
    if isinstance(local_sub, list) and local_sub:
        local_subnet = local_sub[0].get("subnet", "")
    remote_subnet = ""
    if isinstance(remote_sub, list) and remote_sub:
        remote_subnet = remote_sub[0].get("subnet", "")

    return {
        "tunnel_name": phase1,
        "remote_gateway": str(remote_gw),
        "status": tun_status,
        "incoming_bytes": incoming,
        "outgoing_bytes": outgoing,
        "phase1_name": str(phase1),
        "phase2_name": str(phase2),
        "local_subnet": str(local_subnet),
        "remote_subnet": str(remote_subnet),
        "vdom_name": vdom_name,
        "uptime_seconds": int(tdata.get("creation_time", 0)),
    }


async def _discover_device(device: Device, db: AsyncSession) -> tuple[int, list[dict]]:
    """Discover tunnels for a single device. Returns (discovered_count, errors)."""
    discovered = 0
    errors: list[dict] = []

    try:
        api = FortiGateAPI(
            host=device.ip_address,
            port=device.port,
            api_key=device.api_key,
        )
        vdom_list = device.vdom_list if device.vdom_list else ["root"]

        existing_stmt = select(VPNTunnel).where(VPNTunnel.device_id == device.id)
        existing_result = await db.execute(existing_stmt)
        existing = {t.tunnel_name: t for t in existing_result.scalars().all()}

        seen_tunnel_names: set[str] = set()

        for vdom_name in vdom_list:
            try:
                tunnels_data = await api.get_vpn_tunnels(vdom=vdom_name)
            except Exception as vdom_exc:
                logger.debug("No tunnels on %s vdom=%s: %s", device.name, vdom_name, vdom_exc)
                continue

            for tdata in tunnels_data:
                parsed = _parse_tunnel_data(tdata, vdom_name)
                tunnel_name = parsed["tunnel_name"]
                seen_tunnel_names.add(tunnel_name)

                if tunnel_name in existing:
                    tunnel = existing[tunnel_name]
                    for key, val in parsed.items():
                        if key != "tunnel_name":
                            setattr(tunnel, key, val)
                else:
                    tunnel = VPNTunnel(
                        device_id=device.id,
                        tunnel_type="ipsec",
                        **parsed,
                    )
                    db.add(tunnel)
                    discovered += 1

        for tname, tunnel in existing.items():
            if tname not in seen_tunnel_names:
                await db.delete(tunnel)
                logger.info("Removed stale tunnel '%s' from device '%s'", tname, device.name)

    except Exception as exc:
        logger.error("Tunnel discovery failed for %s: %s", device.name, exc)
        errors.append({"device": device.name, "error": str(exc)})

    return discovered, errors


async def discover_tunnels(db: AsyncSession) -> dict:
    stmt = select(Device).where(Device.status.in_(["online", "unknown"]))
    result = await db.execute(stmt)
    devices = list(result.scalars().all())

    results = await asyncio.gather(
        *[_discover_device(dev, db) for dev in devices],
        return_exceptions=True,
    )

    discovered = 0
    errors: list[dict] = []
    for r in results:
        if isinstance(r, Exception):
            errors.append({"device": "unknown", "error": str(r)})
        else:
            discovered += r[0]
            errors.extend(r[1])

    await db.flush()
    await map_tunnel_endpoints(db)

    return {
        "devices_scanned": len(devices),
        "tunnels_discovered": discovered,
        "errors": errors,
    }


async def map_tunnel_endpoints(db: AsyncSession) -> int:
    """Map tunnel remote endpoints to known devices.

    Uses 4 methods in priority order:
      1. Direct management IP match (rgwy == device.ip_address)
      2. Interface IP match (rgwy matches any configured interface IP on a device)
      3. Same tunnel name on different devices
      4. Reverse tunnel match (other device has tunnel pointing back to us)

    Method 2 is critical because tunnel endpoints (rgwy) are almost never
    the same as the management IP used to register the device.
    """
    device_result = await db.execute(select(Device))
    devices = list(device_result.scalars().all())
    ip_to_device = {d.ip_address: d for d in devices}

    # Build extended IP-to-device map: query ALL interface IPs from each device
    # This catches tunnel endpoint IPs that differ from management IP
    extended_ip_map: dict[str, Device] = dict(ip_to_device)
    for device in devices:
        try:
            api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
            vdom_list = device.vdom_list if device.vdom_list else ["root"]
            for vdom_name in vdom_list:
                try:
                    ifaces = await api.get_interfaces(vdom=vdom_name)
                    for iface in ifaces:
                        ip_field = iface.get("ip", "0.0.0.0 0.0.0.0")
                        if ip_field and ip_field != "0.0.0.0 0.0.0.0":
                            ip_addr = ip_field.split()[0]
                            if ip_addr != "0.0.0.0" and ip_addr not in extended_ip_map:
                                extended_ip_map[ip_addr] = device
                except Exception:
                    continue
        except Exception:
            continue

    logger.info("Extended IP map: %d IPs across %d devices", len(extended_ip_map), len(devices))

    tunnel_result = await db.execute(select(VPNTunnel))
    tunnels = list(tunnel_result.scalars().all())

    # Group tunnels by device for cross-device matching
    device_tunnels: dict[int, list[VPNTunnel]] = {}
    for t in tunnels:
        device_tunnels.setdefault(t.device_id, []).append(t)

    mapped = 0
    for tunnel in tunnels:
        if tunnel.remote_device_id:
            continue  # already mapped

        # Method 1+2: Match rgwy against management IP AND all interface IPs
        if tunnel.remote_gateway and tunnel.remote_gateway in extended_ip_map:
            target_device = extended_ip_map[tunnel.remote_gateway]
            # Don't map to self
            if target_device.id != tunnel.device_id:
                tunnel.remote_device_id = target_device.id
                mapped += 1
                continue

        # Method 2: Match by same tunnel name on different devices
        # (e.g. both FW-A and FW-B have "tun-vdom1" = they're connected)
        for other_device in devices:
            if other_device.id == tunnel.device_id:
                continue
            for other_tunnel in device_tunnels.get(other_device.id, []):
                if other_tunnel.tunnel_name == tunnel.tunnel_name:
                    tunnel.remote_device_id = other_device.id
                    if not other_tunnel.remote_device_id:
                        other_tunnel.remote_device_id = tunnel.device_id
                        mapped += 1
                    mapped += 1
                    break
            if tunnel.remote_device_id:
                break

        if tunnel.remote_device_id:
            continue

        # Method 3: Reverse tunnel match - find another device that has
        # a tunnel pointing back to this device's management IP
        source_device = next((d for d in devices if d.id == tunnel.device_id), None)
        if not source_device:
            continue

        for other_device in devices:
            if other_device.id == tunnel.device_id:
                continue
            for other_tunnel in device_tunnels.get(other_device.id, []):
                if other_tunnel.remote_gateway == source_device.ip_address:
                    tunnel.remote_device_id = other_device.id
                    if not other_tunnel.remote_device_id:
                        other_tunnel.remote_device_id = source_device.id
                        mapped += 1
                    mapped += 1
                    break
            if tunnel.remote_device_id:
                break

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

    device_ids = {d.id for d in devices}

    for tunnel in tunnels:
        if not tunnel.remote_device_id:
            continue

        # Skip edges where either device no longer exists
        if tunnel.device_id not in device_ids or tunnel.remote_device_id not in device_ids:
            continue

        # Deduplicate by normalized device pair + tunnel name
        # so tun-vdom1 on FW-A→FW-B and tun-vdom1 on FW-B→FW-A = 1 edge
        # but tun-vdom1 and tun-vdom2 between same pair = 2 separate edges
        lo = min(tunnel.device_id, tunnel.remote_device_id)
        hi = max(tunnel.device_id, tunnel.remote_device_id)
        edge_key = f"{lo}-{hi}-{tunnel.tunnel_name}"
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)

        edge_color = "#22c55e" if tunnel.status == "up" else "#ef4444"
        animated = tunnel.status == "up"

        edge_label = tunnel.tunnel_name
        if tunnel.vdom_name and tunnel.vdom_name != "root":
            edge_label = f"{tunnel.tunnel_name} ({tunnel.vdom_name})"

        edges.append({
            "id": f"e{lo}-{hi}-{tunnel.tunnel_name}",
            "source": str(tunnel.device_id),
            "target": str(tunnel.remote_device_id),
            "type": "smoothstep",
            "animated": animated,
            "label": edge_label,
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
