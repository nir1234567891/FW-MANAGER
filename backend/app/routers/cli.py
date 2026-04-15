"""Bulk CLI router — execute FortiGate CLI commands via the REST API.

CLI commands are mapped to their REST API equivalents and the JSON
responses are formatted as human-readable CLI-style text output.
Unknown commands return a helpful error message.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device
from app.services.fortigate_api import FortiGateAPI

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cli", tags=["cli"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class CLIRequest(BaseModel):
    command: str
    vdom: str = "root"


class CLIResponse(BaseModel):
    command: str
    device_id: int
    device_name: str
    vdom: str
    output: str
    success: bool
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Formatters — convert JSON API responses to CLI-style text
# ---------------------------------------------------------------------------

def fmt_system_status(d: dict, device: Device) -> str:
    r = d.get("results", {})
    serial = d.get("serial", device.serial_number or "N/A")
    version = d.get("version", device.firmware_version or "N/A")
    hostname = r.get("hostname", device.hostname or device.name)
    model = r.get("model_name", "")
    model_num = r.get("model_number", r.get("model", ""))
    return (
        f"Version: {model}-{model_num} {version}\n"
        f"Serial-Number: {serial}\n"
        f"Hostname: {hostname}\n"
        f"Operation Mode: NAT\n"
        f"System time: (see dashboard)\n"
        f"Uptime: {device.uptime or 'N/A'}"
    )


def fmt_interfaces(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "No interface data available"
    lines = []
    for iface in items:
        name = iface.get("name", "?")
        ip = iface.get("ip", "0.0.0.0 0.0.0.0")
        status = iface.get("status", "down")
        itype = iface.get("type", "physical")
        vdom = iface.get("vdom", "root")
        speed = iface.get("speed", "auto")
        mtu = iface.get("mtu", 1500)
        mac = iface.get("macaddr", "")
        lines.append(
            f"== {name} ==\n"
            f"   IP/Mask:  {ip}\n"
            f"   Status:   {status}\n"
            f"   Type:     {itype}   VDOM: {vdom}\n"
            f"   Speed:    {speed}   MTU: {mtu}   MAC: {mac}"
        )
    return "\n\n".join(lines) if lines else "No interfaces found"


def fmt_routes(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "No routing table data available"
    lines = ["%-12s %-20s %-16s %-12s %s" % ("Type", "Network", "Gateway", "Interface", "Dist/Metric")]
    lines.append("-" * 75)
    for r in items:
        rtype = r.get("type", "?")
        net = r.get("ip_mask", "?")
        gw = r.get("gateway", "0.0.0.0")
        intf = r.get("interface", "?")
        dist = r.get("distance", 0)
        metric = r.get("metric", 0)
        lines.append("%-12s %-20s %-16s %-12s %s/%s" % (rtype, net, gw, intf, dist, metric))
    return "\n".join(lines) if len(lines) > 2 else "Routing table is empty"


def fmt_ha(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "HA is not configured on this device"
    if not items:
        return "HA is not configured on this device (standalone mode)"
    lines = ["HA Mode: Active-Passive", ""]
    for peer in items:
        lines.append(f"Peer hostname:  {peer.get('hostname', 'N/A')}")
        lines.append(f"Serial number:  {peer.get('serial_no', 'N/A')}")
        lines.append(f"Role:           {peer.get('role', 'N/A')}")
        lines.append(f"Priority:       {peer.get('priority', 'N/A')}")
        lines.append(f"Connected:      {peer.get('connected_status', 'N/A')}")
        lines.append("")
    return "\n".join(lines)


def fmt_vpn_ipsec(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "No VPN tunnel data available"
    if not items:
        return "No IPsec tunnels found"
    lines = []
    for t in items:
        name = t.get("name", "?")
        rgw = t.get("rgwy", t.get("rgwip", "?"))
        status = "up" if t.get("proxyid", []) else "down"
        pids = t.get("proxyid", [])
        lines.append(f"== {name} ==")
        lines.append(f"   Remote GW:  {rgw}")
        lines.append(f"   IKE ver:    {t.get('ikeversion', 1)}")
        lines.append(f"   Phase2:     {len(pids)} SA(s)")
        for p in pids[:3]:
            lines.append(f"   SA:  src={p.get('src', '?')} dst={p.get('dst', '?')} status={p.get('status', '?')}")
    return "\n".join(lines)


def fmt_performance(d: dict) -> str:
    r = d.get("results", {})
    cpu = r.get("cpu", {})
    mem = r.get("mem", {})

    cpu_user = cpu.get("user", 0)
    cpu_sys = cpu.get("system", 0)
    cpu_idle = cpu.get("idle", 100)
    cores = cpu.get("cores", [])

    mem_total = mem.get("total", 0)
    mem_used = mem.get("used", 0)
    mem_pct = round(mem_used / mem_total * 100, 1) if mem_total else 0

    def mb(b):
        return f"{b // 1024 // 1024} MB" if b else "0 MB"

    lines = [
        f"CPU states: {cpu_user}% user  {cpu_sys}% system  {cpu_idle}% idle",
    ]
    if cores:
        lines.append(f"CPU cores:  {len(cores)} core(s)")
    lines += [
        f"Memory:     {mem_pct}% used  ({mb(mem_used)} / {mb(mem_total)})",
        f"Memory free: {mb(mem.get('free', 0))}",
    ]
    net = r.get("net", r.get("network", {}))
    if net:
        lines.append(f"Network:    {net}")
    return "\n".join(lines)


def fmt_dns(d: dict) -> str:
    r = d.get("results", {})
    if not isinstance(r, dict):
        return "DNS configuration not available"
    primary = r.get("primary", "N/A")
    secondary = r.get("secondary", "N/A")
    protocol = r.get("protocol", "cleartext")
    return (
        f"Primary DNS:    {primary}\n"
        f"Secondary DNS:  {secondary}\n"
        f"Protocol:       {protocol}"
    )


def fmt_ntp(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "NTP data not available"
    lines = []
    for s in items:
        ip = s.get("ip", "?")
        server = s.get("server", ip)
        reachable = s.get("reachable", False)
        sync = "reachable" if reachable else "unreachable"
        lines.append(f"Server: {server} ({ip})  Status: {sync}")
    return "\n".join(lines) if lines else "No NTP servers configured"


def fmt_bgp(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "BGP not configured"
    if not items:
        return "No BGP neighbors found"
    lines = ["%-16s %-8s %-16s %-12s %-12s %s" % ("Neighbor", "AS", "State", "PfxRcvd", "PfxSent", "Uptime")]
    lines.append("-" * 75)
    for n in items:
        ip = n.get("neighbor_ip", "?")
        remote_as = n.get("remote_as", "?")
        state = n.get("state", "?")
        pfx_rcv = n.get("prefixes_received", 0)
        pfx_sent = n.get("prefixes_sent", 0)
        uptime = n.get("uptime", "never")
        lines.append("%-16s %-8s %-16s %-12s %-12s %s" % (ip, remote_as, state, pfx_rcv, pfx_sent, uptime))
    return "\n".join(lines)


def fmt_ospf(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "OSPF not configured"
    if not items:
        return "No OSPF neighbors found"
    lines = ["%-16s %-12s %-8s %-14s %s" % ("Neighbor ID", "IP", "State", "Dead Time", "Interface")]
    lines.append("-" * 65)
    for n in items:
        nid = n.get("router_id", "?")
        ip = n.get("neighbor_ip", "?")
        state = n.get("state", "?")
        dead = n.get("dead_time", "?")
        intf = n.get("interface_name", "?")
        lines.append("%-16s %-12s %-8s %-14s %s" % (nid, ip, state, dead, intf))
    return "\n".join(lines)


def fmt_policies(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "No policy data"
    lines = ["%-6s %-30s %-10s %-10s %-10s %s" % ("ID", "Name", "Action", "NAT", "Status", "Hits")]
    lines.append("-" * 75)
    for p in items[:50]:
        pid = p.get("policyid", "?")
        name = (p.get("name", "?") or "")[:28]
        action = p.get("action", "?")
        nat = p.get("nat", "disable")
        status = p.get("status", "enable")
        hits = p.get("pkts", 0)
        lines.append("%-6s %-30s %-10s %-10s %-10s %s" % (pid, name, action, nat, status, hits))
    return "\n".join(lines)


def fmt_license(d: dict) -> str:
    r = d.get("results", {})
    if not isinstance(r, dict):
        return "License data not available"
    lines = []
    for key, val in r.items():
        if isinstance(val, dict):
            status = val.get("status", val.get("type", "N/A"))
            exp = val.get("expires", val.get("expiry_date", ""))
            line = f"{key:<30} {status}"
            if exp:
                line += f"   expires: {exp}"
            lines.append(line)
    return "\n".join(lines) if lines else "License information not available"


def fmt_dhcp(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "No DHCP lease data"
    if not items:
        return "No active DHCP leases"
    lines = ["%-16s %-18s %-14s %s" % ("IP", "MAC", "Status", "Hostname")]
    lines.append("-" * 60)
    for lease in items[:100]:
        ip = lease.get("ip", "?")
        mac = lease.get("mac", "?")
        status = lease.get("status", "?")
        hostname = lease.get("hostname", "?")
        lines.append("%-16s %-18s %-14s %s" % (ip, mac, status, hostname))
    return "\n".join(lines)


def fmt_ssl_vpn(d: dict) -> str:
    items = d.get("results", [])
    if not isinstance(items, list):
        return "No SSL VPN data"
    if not items:
        return "No active SSL VPN sessions"
    lines = ["%-20s %-16s %-16s %s" % ("User", "IP", "Tunnel IP", "Duration")]
    lines.append("-" * 65)
    for u in items:
        user = u.get("user_name", u.get("user", "?"))
        src = u.get("src_ip", "?")
        tunnel = u.get("tunnel_ip", u.get("tun_ip", "?"))
        dur = u.get("duration", "?")
        lines.append("%-20s %-16s %-16s %s" % (user, src, tunnel, dur))
    return "\n".join(lines)


def fmt_router_stats(d: dict) -> str:
    r = d.get("results", {})
    total = r.get("total_lines", 0)
    ipv4 = r.get("total_lines_ipv4", 0)
    ipv6 = r.get("total_lines_ipv6", 0)
    return (
        f"Total routes:  {total}\n"
        f"IPv4 routes:   {ipv4}\n"
        f"IPv6 routes:   {ipv6}"
    )


# ---------------------------------------------------------------------------
# Command → API mapping
# ---------------------------------------------------------------------------

COMMAND_MAP = {
    # System
    "get system status":                ("GET", "/api/v2/monitor/system/status",             fmt_system_status, True),
    "get system performance status":    ("GET", "/api/v2/monitor/system/performance/status",  fmt_performance,   False),
    "get system ha status":             ("GET", "/api/v2/monitor/system/ha-peer",             fmt_ha,            False),
    "get system dns":                   ("GET", "/api/v2/cmdb/system/dns",                   fmt_dns,           False),
    "diag sys ntp status":              ("GET", "/api/v2/monitor/system/ntp/status",          fmt_ntp,           False),
    "execute dhcp lease-list":          ("GET", "/api/v2/monitor/system/dhcp",               fmt_dhcp,          False),
    "get system fortiguard-service status": ("GET", "/api/v2/monitor/license/status",        fmt_license,       False),
    # Network
    "get system interface physical":    ("GET", "/api/v2/cmdb/system/interface",             fmt_interfaces,    False),
    "get system arp":                   ("GET", "/api/v2/cmdb/system/arp",                   None,              False),
    # Routing
    "get router info routing-table all": ("GET", "/api/v2/monitor/router/ipv4",             fmt_routes,        False),
    "get router info bgp summary":      ("GET", "/api/v2/monitor/router/bgp/neighbors",      fmt_bgp,           False),
    "get router info ospf neighbor":    ("GET", "/api/v2/monitor/router/ospf/neighbors",     fmt_ospf,          False),
    # Firewall
    "get system session status":        ("GET", "/api/v2/monitor/firewall/session",          None,              False),
    "diag firewall iprope show 100004": ("GET", "/api/v2/monitor/firewall/policy",           fmt_policies,      False),
    # VPN
    "diag vpn ike gateway list":        ("GET", "/api/v2/monitor/vpn/ipsec",                fmt_vpn_ipsec,     False),
    "get vpn ssl monitor":              ("GET", "/api/v2/monitor/vpn/ssl",                   fmt_ssl_vpn,       False),
}

NOT_AVAILABLE = {
    "diag sys logdisk usage":     "Log disk monitoring is not exposed via the REST API on this firmware version.",
    "diag debug crashlog read":   "Crash log download is not available via the REST API. Use SSH to access it.",
}


def _json_fallback(d: dict) -> str:
    """Format any JSON dict nicely when no specific formatter exists."""
    import json
    r = d.get("results", d)
    try:
        return json.dumps(r, indent=2, ensure_ascii=False)
    except Exception:
        return str(r)[:2000]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/{device_id}/execute", response_model=CLIResponse)
async def execute_cli(
    device_id: int,
    req: CLIRequest,
    db: AsyncSession = Depends(get_db),
):
    """Execute a FortiGate CLI command by mapping it to a REST API call.

    Returns CLI-style formatted output.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    cmd = req.command.strip().lower()
    vdom = req.vdom or "root"

    # Check unsupported commands
    for not_avail_cmd, msg in NOT_AVAILABLE.items():
        if cmd == not_avail_cmd or cmd.startswith(not_avail_cmd):
            return CLIResponse(
                command=req.command,
                device_id=device_id,
                device_name=device.name,
                vdom=vdom,
                output=f"[Not available via REST API]\n{msg}",
                success=False,
                error="Command not supported via API",
            )

    # Look up mapping
    mapping = None
    for pattern, value in COMMAND_MAP.items():
        if cmd == pattern or cmd.startswith(pattern):
            mapping = value
            break

    if mapping is None:
        # Unknown command — return informative message
        known = "\n  ".join(sorted(COMMAND_MAP.keys()))
        return CLIResponse(
            command=req.command,
            device_id=device_id,
            device_name=device.name,
            vdom=vdom,
            output=(
                f"Unknown command: '{req.command}'\n\n"
                f"Supported commands:\n  {known}\n\n"
                f"Note: These commands are mapped to FortiOS REST API endpoints.\n"
                f"Arbitrary CLI execution is not supported via REST API."
            ),
            success=False,
            error="Unknown command",
        )

    method, path, formatter, pass_device = mapping

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    try:
        data = await api._get(path, vdom=vdom)
    except Exception as exc:
        err_msg = str(exc)
        return CLIResponse(
            command=req.command,
            device_id=device_id,
            device_name=device.name,
            vdom=vdom,
            output=f"Error contacting device: {err_msg}",
            success=False,
            error=err_msg,
        )

    try:
        if formatter is None:
            output = _json_fallback(data)
        elif pass_device:
            output = formatter(data, device)
        else:
            output = formatter(data)
    except Exception as exc:
        logger.warning("Formatter failed for %s: %s", cmd, exc)
        output = _json_fallback(data)

    return CLIResponse(
        command=req.command,
        device_id=device_id,
        device_name=device.name,
        vdom=vdom,
        output=output,
        success=True,
    )
