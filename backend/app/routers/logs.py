"""FortiGate Logs router.

Endpoints:
  GET /api/logs/{device_id}          — Fetch logs from a FortiGate device
  GET /api/logs/{device_id}/sources  — List available log sources (disk/memory)
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device
from app.services.fortigate_api import FortiGateAPI

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logs", tags=["logs"])

# Supported log types grouped by category
LOG_TYPES = [
    {"value": "event/system",  "label": "Event - System",  "group": "Event"},
    {"value": "event/vpn",     "label": "Event - VPN",     "group": "Event"},
    {"value": "event/user",    "label": "Event - User",    "group": "Event"},
    {"value": "event/router",  "label": "Event - Router",  "group": "Event"},
    {"value": "traffic/forward", "label": "Traffic - Forward", "group": "Traffic"},
    {"value": "traffic/local",   "label": "Traffic - Local",   "group": "Traffic"},
    {"value": "traffic/sniffer", "label": "Traffic - Sniffer", "group": "Traffic"},
]

LOG_LEVEL_COLORS = {
    "emergency": "text-red-500",
    "alert":     "text-red-400",
    "critical":  "text-red-400",
    "error":     "text-orange-400",
    "warning":   "text-amber-400",
    "notice":    "text-blue-400",
    "information": "text-slate-300",
    "debug":     "text-slate-500",
}


@router.get("/{device_id}/sources")
async def get_log_sources(device_id: int, db: AsyncSession = Depends(get_db)):
    """Check which log sources are available on the device."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    sources = []
    if device.status != "offline":
        api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)
        # Test if memory logs are available
        for source in ["memory", "disk"]:
            try:
                resp = await api.get_logs(log_source=source, log_type="event/system", rows=1, start=0)
                # 404 means not available; success (even empty) means available
                sources.append(source)
            except Exception:
                pass  # Source not available

    return {"device_id": device_id, "sources": sources, "log_types": LOG_TYPES}


@router.get("/{device_id}")
async def get_device_logs(
    device_id: int,
    vdom: Optional[str] = Query(None, description="VDOM name. Leave empty to use device default VDOM."),
    log_source: str = Query("memory", description="Log source: memory or disk"),
    log_type: str = Query("event/system", description="Log type: event/system, event/vpn, traffic/forward, etc."),
    rows: int = Query(100, ge=1, le=1000, description="Number of log entries to return"),
    start: int = Query(0, ge=0, description="Offset (for pagination)"),
    db: AsyncSession = Depends(get_db),
):
    """Fetch log entries from a FortiGate device.

    Supports both memory and disk log sources across all log types.
    VDOM parameter filters logs for a specific VDOM.

    Real FortiGate log entry fields: date, time, eventtime, logid, type, subtype,
    level, vd (VDOM), logdesc, msg, action, and many type-specific fields.
    """
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if device.status == "offline":
        return {
            "device_id": device_id,
            "device_name": device.name,
            "log_source": log_source,
            "log_type": log_type,
            "vdom": vdom,
            "entries": [],
            "total_lines": 0,
            "rows": rows,
            "start": start,
            "error": "Device is offline",
        }

    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    try:
        raw = await api.get_logs(
            log_source=log_source,
            log_type=log_type,
            vdom=vdom,
            rows=rows,
            start=start,
        )
    except Exception as exc:
        logger.warning("Log fetch failed for device %s: %s", device.name, exc)
        return {
            "device_id": device_id,
            "device_name": device.name,
            "log_source": log_source,
            "log_type": log_type,
            "vdom": vdom,
            "entries": [],
            "total_lines": 0,
            "rows": rows,
            "start": start,
            "error": str(exc),
        }

    entries = raw.get("results", [])
    total_lines = raw.get("total_lines", len(entries))

    # Normalize entries — ensure consistent fields
    normalized = []
    for entry in entries:
        normalized.append({
            "date":     entry.get("date", ""),
            "time":     entry.get("time", ""),
            "level":    entry.get("level", "notice"),
            "vd":       entry.get("vd", vdom or ""),
            "logid":    entry.get("logid", ""),
            "type":     entry.get("type", log_type.split("/")[0]),
            "subtype":  entry.get("subtype", log_type.split("/")[-1]),
            "logdesc":  entry.get("logdesc", ""),
            "msg":      entry.get("msg", ""),
            "action":   entry.get("action", ""),
            "srcip":    entry.get("srcip", ""),
            "dstip":    entry.get("dstip", ""),
            "srcport":  entry.get("srcport", ""),
            "dstport":  entry.get("dstport", ""),
            "proto":    entry.get("proto", ""),
            "policyid": entry.get("policyid", ""),
            "user":     entry.get("user", ""),
            "devname":  entry.get("devname", device.name),
            "extra":    {k: v for k, v in entry.items()
                         if k not in ("date", "time", "eventtime", "level", "vd", "logid",
                                      "type", "subtype", "logdesc", "msg", "action", "srcip",
                                      "dstip", "srcport", "dstport", "proto", "policyid",
                                      "user", "devname", "_metadata")},
        })

    return {
        "device_id": device_id,
        "device_name": device.name,
        "log_source": log_source,
        "log_type": log_type,
        "vdom": vdom,
        "entries": normalized,
        "total_lines": total_lines,
        "rows": rows,
        "start": start,
    }
