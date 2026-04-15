"""Compliance & Health router.

Endpoints:
  GET /api/compliance/{device_id}   — Run live compliance checks on one device
  GET /api/compliance               — Run compliance checks on all devices (summary)
"""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.models import Device
from app.services.fortigate_api import FortiGateAPI
from app.services.utils import extract_current

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/compliance", tags=["compliance"])


def _parse_firmware_version(fw: str) -> tuple[int, int, int]:
    """Parse 'v7.2.8' → (7, 2, 8). Returns (0, 0, 0) on failure."""
    try:
        parts = fw.lstrip("v").split(".")
        major = int(parts[0]) if len(parts) > 0 else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
        patch = int(parts[2]) if len(parts) > 2 else 0
        return major, minor, patch
    except Exception:
        return 0, 0, 0


async def _run_compliance_checks(device: Device) -> dict:
    """Query FortiGate live and return compliance check results."""
    firmware = device.firmware_version or "unknown"
    cpu: float = device.cpu_usage or 0.0
    mem: float = device.memory_usage or 0.0
    source = "database"

    checks: dict = {
        "ntp":           {"enabled": False, "type": "unknown", "compliant": False, "details": "Unreachable"},
        "dns":           {"primary": "", "secondary": "", "compliant": False, "details": "Unreachable"},
        "admin_timeout": {"value": 0, "compliant": False, "details": "Unreachable"},
        "admin_https":   {"https_port": 443, "http_redirect": False, "compliant": False, "details": "Unreachable"},
        "ssh_v1":        {"disabled": False, "compliant": False, "details": "Unreachable"},
        "strong_crypto": {"enabled": False, "compliant": False, "details": "Unreachable"},
        "telnet":        {"disabled": False, "compliant": False, "details": "Unreachable"},
        "syslog":        {"enabled": False, "compliant": False, "details": "Unreachable"},
        "cli_audit":     {"enabled": False, "compliant": False, "details": "Unreachable"},
    }

    if device.status == "offline":
        for key in checks:
            checks[key]["details"] = "Device offline"
        return {
            "firmware": {"version": firmware, "compliant": False, "details": firmware},
            "checks": checks,
            "resources": {"cpu": cpu, "memory": mem},
            "source": "offline",
        }

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
    source = "live"

    # ── Parallel API calls ──────────────────────────────────────────────────
    async def safe(coro):
        try:
            return await coro
        except Exception as exc:
            logger.debug("Compliance API call failed for %s: %s", device.name, exc)
            return None

    status_data, ntp_data, dns_data, global_data, syslog_data, resource_data = await asyncio.gather(
        safe(api.get_system_status()),
        safe(api.get_ntp()),
        safe(api.get_dns()),
        safe(api.get_system_global()),
        safe(api.get_syslog_setting()),
        safe(api.get_resource_usage()),
    )

    # ── Firmware ────────────────────────────────────────────────────────────
    if status_data:
        firmware = status_data.get("version", firmware)

    # ── NTP ─────────────────────────────────────────────────────────────────
    if ntp_data is not None:
        ntpsync = ntp_data.get("ntpsync", "disable") == "enable"
        ntp_type = ntp_data.get("type", "unknown")
        servers = ntp_data.get("ntpserver", [])
        if ntpsync and servers:
            srv_names = [s.get("server", "") for s in servers if s.get("server")]
            details = f"{ntp_type}: {', '.join(srv_names)}" if srv_names else ntp_type
        elif ntpsync:
            details = f"Synced via {ntp_type}"
        else:
            details = "NTP sync disabled"
        checks["ntp"] = {"enabled": ntpsync, "type": ntp_type, "compliant": ntpsync, "details": details}

    # ── DNS ──────────────────────────────────────────────────────────────────
    if dns_data is not None:
        primary = dns_data.get("primary", "")
        secondary = dns_data.get("secondary", "")
        dual = bool(secondary and secondary not in ("0.0.0.0", ""))
        if dual:
            details = f"{primary}, {secondary}"
        elif primary:
            details = f"{primary} only (no secondary)"
        else:
            details = "Not configured"
        checks["dns"] = {"primary": primary, "secondary": secondary, "compliant": dual, "details": details}

    # ── System Global settings ───────────────────────────────────────────────
    if global_data is not None:
        timeout = global_data.get("admintimeout", 0)
        admin_sport = global_data.get("admin-sport", 443)
        https_redirect = global_data.get("admin-https-redirect", "disable") == "enable"
        ssh_v1 = global_data.get("admin-ssh-v1", "enable") == "disable"
        strong = global_data.get("strong-crypto", "disable") == "enable"
        telnet_off = global_data.get("admin-telnet", "enable") == "disable"
        cli_audit = global_data.get("cli-audit-log", "disable") == "enable"

        to_compliant = 0 < timeout <= 480
        checks["admin_timeout"] = {
            "value": timeout,
            "compliant": to_compliant,
            "details": f"{timeout} min" if timeout else "Disabled (unlimited sessions)",
        }
        https_ok = admin_sport != 80 or https_redirect
        checks["admin_https"] = {
            "https_port": admin_sport,
            "http_redirect": https_redirect,
            "compliant": https_ok,
            "details": f"HTTPS :{admin_sport}" + (" + HTTP redirect" if https_redirect else ""),
        }
        checks["ssh_v1"] = {
            "disabled": ssh_v1,
            "compliant": ssh_v1,
            "details": "SSH v1 disabled" if ssh_v1 else "SSH v1 ENABLED (security risk)",
        }
        checks["strong_crypto"] = {
            "enabled": strong,
            "compliant": strong,
            "details": "Enabled" if strong else "Disabled (weak ciphers allowed)",
        }
        checks["telnet"] = {
            "disabled": telnet_off,
            "compliant": telnet_off,
            "details": "Telnet disabled" if telnet_off else "Telnet ENABLED (plaintext protocol)",
        }
        checks["cli_audit"] = {
            "enabled": cli_audit,
            "compliant": cli_audit,
            "details": "CLI audit log enabled" if cli_audit else "CLI audit log disabled (no admin trail)",
        }

    # ── Syslog ───────────────────────────────────────────────────────────────
    if syslog_data is not None:
        syslog_on = syslog_data.get("status", "disable") == "enable"
        srv = syslog_data.get("server", "")
        checks["syslog"] = {
            "enabled": syslog_on,
            "server": srv,
            "compliant": syslog_on,
            "details": f"Forwarding to {srv}" if syslog_on else "Syslog forwarding disabled",
        }

    # ── Resources ────────────────────────────────────────────────────────────
    if resource_data is not None:
        cpu_arr = resource_data.get("cpu", [])
        mem_arr = resource_data.get("mem", [])
        if isinstance(cpu_arr, list) and cpu_arr:
            cpu = float(cpu_arr[0].get("current", cpu))
        if isinstance(mem_arr, list) and mem_arr:
            mem = float(mem_arr[0].get("current", mem))

    return {
        "firmware": {
            "version": firmware,
            "compliant": _parse_firmware_version(firmware) >= (7, 2, 0),
            "details": firmware,
        },
        "checks": checks,
        "resources": {"cpu": cpu, "memory": mem},
        "source": source,
    }


@router.get("/{device_id}")
async def get_device_compliance(device_id: int, db: AsyncSession = Depends(get_db)):
    """Run live compliance checks on a single device.

    Queries FortiGate for: firmware, NTP, DNS, system global settings, syslog.
    Falls back to database values when device is unreachable.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    data = await _run_compliance_checks(device)

    # Count totals
    all_checks = [data["firmware"]] + list(data["checks"].values())
    checks_passed = sum(1 for c in all_checks if c.get("compliant", False))
    checks_total = len(all_checks)
    score = round((checks_passed / checks_total) * 100) if checks_total > 0 else 0

    return {
        "device_id": device.id,
        "device_name": device.name,
        "status": device.status,
        "model": device.model,
        "firmware": data["firmware"],
        "checks": data["checks"],
        "resources": data["resources"],
        "checks_passed": checks_passed,
        "checks_total": checks_total,
        "score": score,
        "source": data["source"],
        "last_checked": datetime.now(timezone.utc).isoformat(),
    }


@router.get("")
async def get_all_compliance(db: AsyncSession = Depends(get_db)):
    """Run compliance checks on all devices in parallel.

    Returns a list of per-device compliance summaries.
    """
    dev_result = await db.execute(select(Device).order_by(Device.name))
    devices = list(dev_result.scalars().all())

    if not devices:
        return []

    async def check_one(device: Device) -> dict:
        try:
            data = await _run_compliance_checks(device)
            all_checks = [data["firmware"]] + list(data["checks"].values())
            passed = sum(1 for c in all_checks if c.get("compliant", False))
            total = len(all_checks)
            score = round((passed / total) * 100) if total > 0 else 0
            return {
                "device_id": device.id,
                "device_name": device.name,
                "status": device.status,
                "model": device.model,
                "firmware": data["firmware"],
                "checks": data["checks"],
                "resources": data["resources"],
                "checks_passed": passed,
                "checks_total": total,
                "score": score,
                "source": data["source"],
                "last_checked": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            logger.error("Compliance check failed for device %s: %s", device.name, exc)
            return {
                "device_id": device.id,
                "device_name": device.name,
                "status": device.status,
                "error": str(exc),
                "checks_passed": 0,
                "checks_total": 0,
                "score": 0,
            }

    results = await asyncio.gather(*[check_one(d) for d in devices])
    return list(results)
