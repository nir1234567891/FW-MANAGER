"""Background health checker: polls all devices every 5 minutes.

Each cycle:
  1. Updates device status (online / offline), resource metrics, uptime, VDOMs.
  2. Generates alerts for detected issues (device down, CPU/memory threshold breaches).
  3. Runs tunnel discovery to keep VPN topology current.

Alert generation is idempotent: duplicates are suppressed if an identical
unacknowledged alert already exists for (device_id, alert_type).
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import Alert, Device
from app.services.fortigate_api import FortiGateAPI
from app.services.tunnel_mapper import discover_tunnels
from app.services.utils import (
    extract_current,
    build_model_name,
    CPU_HIGH_THRESHOLD,
    CPU_CRITICAL_THRESHOLD,
    MEM_HIGH_THRESHOLD,
    MEM_CRITICAL_THRESHOLD,
)

logger = logging.getLogger(__name__)


async def _create_alert_if_new(
    db: AsyncSession,
    device_id: int,
    severity: str,
    message: str,
    alert_type: str,
) -> bool:
    """Create an alert only if no identical unacknowledged alert exists.

    Returns True if a new alert was created.
    """
    existing = await db.execute(
        select(Alert).where(
            Alert.device_id == device_id,
            Alert.alert_type == alert_type,
            Alert.acknowledged == False,  # noqa: E712
        )
    )
    if existing.scalar_one_or_none() is not None:
        return False  # Already exists, skip

    alert = Alert(
        device_id=device_id,
        severity=severity,
        message=message,
        alert_type=alert_type,
        acknowledged=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(alert)
    logger.info("Alert created [%s/%s] for device %s: %s", severity, alert_type, device_id, message)
    return True


async def check_device_health(device: Device, db: AsyncSession) -> None:
    """Check a single device's health, update its status, and generate alerts.

    Steps:
      1. Probe system/status → online/offline decision.
      2. Fetch resource usage (CPU, memory, disk, sessions).
      3. Refresh VDOM list.
      4. Calculate uptime from web-ui/state.
      5. Generate alerts based on observed values.
    """
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    try:
        # --- 1. System status (serial, version, model, hostname) ---
        # Real FortiGate response (verified 2026-04-13):
        #   results = { model_name, model_number, model, hostname, log_disk_status }
        #   Envelope fields serial, version, build are merged by get_system_status().
        #   There is NO 'uptime' field here — uptime comes from web-ui/state.
        status_data = await api.get_system_status()

        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)

        if status_data.get("serial"):
            device.serial_number = status_data["serial"]
        if status_data.get("version"):
            device.firmware_version = status_data["version"]
        if status_data.get("hostname"):
            device.hostname = status_data["hostname"]

        built_model = build_model_name(status_data)
        if built_model:
            device.model = built_model

        # --- 2. Resource usage (CPU %, Memory %, Disk %, Session count) ---
        # Single source of truth: monitor/system/resource/usage
        # Real structure: results.cpu = [{"current": 0, "historical": {...}}]
        try:
            resource = await api.get_resource_usage()
            if isinstance(resource, dict):
                device.cpu_usage = float(extract_current(resource.get("cpu")))
                device.memory_usage = float(extract_current(resource.get("mem")))
                device.disk_usage = float(extract_current(resource.get("disk")))
                device.session_count = extract_current(resource.get("session"))
        except Exception as exc:
            logger.debug("Resource usage fetch failed for %s: %s", device.name, exc)

        # --- 3. VDOM list ---
        try:
            vdoms = await api.get_vdoms()
            vdom_names = [v.get("name", "root") for v in vdoms]
            if vdom_names and vdom_names != device.vdom_list:
                device.vdom_list = vdom_names
                logger.info("Updated VDOMs for %s: %s", device.name, vdom_names)
        except Exception as exc:
            logger.debug("VDOM refresh failed for %s: %s", device.name, exc)

        # --- 4. Uptime (from web-ui/state, NOT system/status) ---
        try:
            uptime_secs = await api.get_uptime_seconds()
            if uptime_secs > 0:
                device.uptime = api.format_uptime(uptime_secs)
        except Exception as exc:
            logger.debug("Uptime fetch failed for %s: %s", device.name, exc)

        logger.info("[OK] Device %s is ONLINE (CPU=%.1f%% MEM=%.1f%%)",
                    device.name, device.cpu_usage or 0, device.memory_usage or 0)

    except Exception as exc:
        # Device is unreachable — clear stale metrics
        device.status = "offline"
        device.cpu_usage = 0.0
        device.memory_usage = 0.0
        device.disk_usage = 0.0
        device.session_count = 0
        device.uptime = "0 days"
        logger.warning("[FAIL] Device %s is OFFLINE: %s", device.name, exc)

    # --- 5. Alert generation based on final observed state ---
    await _generate_alerts(device, db)


async def _generate_alerts(device: Device, db: AsyncSession) -> None:
    """Generate alerts for a device based on its current state.

    Called after the device probe regardless of online/offline outcome.
    Duplicate suppression: each alert_type can have at most one unacknowledged
    alert per device at any time.
    """
    if device.status == "offline":
        await _create_alert_if_new(
            db, device.id, "critical",
            f"Device {device.name} is OFFLINE",
            "device_down",
        )
        return  # No point checking CPU/memory when offline

    # CPU thresholds
    cpu = device.cpu_usage or 0.0
    if cpu >= CPU_CRITICAL_THRESHOLD:
        await _create_alert_if_new(
            db, device.id, "critical",
            f"CPU critical on {device.name}: {cpu:.1f}%",
            "cpu_critical",
        )
    elif cpu >= CPU_HIGH_THRESHOLD:
        await _create_alert_if_new(
            db, device.id, "high",
            f"CPU high on {device.name}: {cpu:.1f}%",
            "cpu_high",
        )

    # Memory thresholds
    mem = device.memory_usage or 0.0
    if mem >= MEM_CRITICAL_THRESHOLD:
        await _create_alert_if_new(
            db, device.id, "critical",
            f"Memory critical on {device.name}: {mem:.1f}%",
            "mem_critical",
        )
    elif mem >= MEM_HIGH_THRESHOLD:
        await _create_alert_if_new(
            db, device.id, "high",
            f"Memory high on {device.name}: {mem:.1f}%",
            "mem_high",
        )


async def health_check_loop() -> None:
    """Background task: checks all devices every 5 minutes.

    Each cycle:
      1. Polls every device and updates status + resource metrics.
      2. Generates alerts for detected issues (idempotent — no duplicates).
      3. Runs tunnel discovery to update VPN topology.
    """
    logger.info("[HEALTH CHECKER] Started — running every 5 minutes")

    while True:
        try:
            await asyncio.sleep(300)  # 5 minutes

            logger.info("Running scheduled health check for all devices...")

            async with async_session() as db:
                result = await db.execute(select(Device))
                devices = result.scalars().all()

                if not devices:
                    logger.info("No devices to check")
                    continue

                await asyncio.gather(
                    *(check_device_health(d, db) for d in devices),
                    return_exceptions=True,
                )
                for device in devices:
                    device.updated_at = datetime.now(timezone.utc)

                await db.commit()

                online_count = sum(1 for d in devices if d.status == "online")
                offline_count = sum(1 for d in devices if d.status == "offline")
                logger.info(
                    "Health check complete: %d online, %d offline",
                    online_count, offline_count,
                )

                # Auto-discover tunnels from online devices
                try:
                    tunnel_result = await discover_tunnels(db)
                    await db.commit()
                    logger.info(
                        "Tunnel discovery: %d new tunnels, %d devices scanned",
                        tunnel_result["tunnels_discovered"],
                        tunnel_result["devices_scanned"],
                    )
                except Exception as exc:
                    logger.error("Tunnel discovery error: %s", exc)

        except asyncio.CancelledError:
            logger.info("Health checker stopped")
            break
        except Exception as exc:
            logger.error("Error in health check loop: %s", exc, exc_info=True)
