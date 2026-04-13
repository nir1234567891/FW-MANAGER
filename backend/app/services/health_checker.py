import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy import select
from app.database import async_session
from app.models import Device
from app.services.fortigate_api import FortiGateAPI
from app.services.tunnel_mapper import discover_tunnels

logger = logging.getLogger(__name__)


async def check_device_health(device: Device):
    """Check a single device's health and update its status."""
    api = FortiGateAPI(host=device.ip_address, port=device.port, api_key=device.api_key)

    try:
        # --- System Status (serial, version, model, hostname) ---
        # Real response: results = { model_name, model_number, model, hostname, log_disk_status }
        # Envelope: serial, version, build (merged by get_system_status).
        # NOTE: There is NO 'uptime' field in system/status. Uptime comes from web-ui/state.
        status_data = await api.get_system_status()

        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)

        if status_data.get("serial"):
            device.serial_number = status_data["serial"]
        if status_data.get("version"):
            device.firmware_version = status_data["version"]
        if status_data.get("hostname"):
            device.hostname = status_data["hostname"]

        # Build friendly model name: "FortiGateRugged 60F" (not just code "FGR60F")
        model_name = status_data.get("model_name", "")
        model_number = status_data.get("model_number", "")
        model_code = status_data.get("model", "")
        if model_name and model_number:
            device.model = f"{model_name} {model_number}"
        elif model_name:
            device.model = model_name
        elif model_code:
            device.model = model_code

        # --- VDOM list ---
        try:
            vdoms = await api.get_vdoms()
            vdom_names = [v.get("name", "root") for v in vdoms]
            if vdom_names and vdom_names != device.vdom_list:
                device.vdom_list = vdom_names
                logger.info("Updated VDOMs for %s: %s", device.name, vdom_names)
        except Exception as e:
            logger.debug("Could not refresh VDOMs for %s: %s", device.name, e)

        # --- Resource Usage (CPU, memory, disk, sessions) ---
        # Single source of truth: monitor/system/resource/usage
        # Real structure: results.cpu = [{"current": 0, "historical": {...}}]
        try:
            resource = await api.get_resource_usage()
            if isinstance(resource, dict):
                device.cpu_usage = float(_extract_current(resource.get("cpu")))
                device.memory_usage = float(_extract_current(resource.get("mem")))
                device.disk_usage = float(_extract_current(resource.get("disk")))
                device.session_count = _extract_current(resource.get("session"))
        except Exception as e:
            logger.debug("Could not fetch resource usage for %s: %s", device.name, e)

        # --- Uptime (from web-ui/state, NOT system/status) ---
        try:
            uptime_secs = await api.get_uptime_seconds()
            if uptime_secs > 0:
                device.uptime = api.format_uptime(uptime_secs)
        except Exception as e:
            logger.debug("Could not fetch uptime for %s: %s", device.name, e)

        logger.info("[OK] Device %s is ONLINE", device.name)

    except Exception as e:
        # Device is offline — clear stale metrics
        device.status = "offline"
        device.cpu_usage = 0
        device.memory_usage = 0
        device.disk_usage = 0
        device.session_count = 0
        device.uptime = "0 days"
        logger.warning("[FAIL] Device %s is OFFLINE: %s", device.name, e)


def _extract_current(resource_list) -> int:
    """Extract 'current' value from resource/usage list format."""
    if isinstance(resource_list, list) and resource_list:
        first = resource_list[0]
        if isinstance(first, dict):
            return int(first.get("current", 0))
    return 0


async def health_check_loop():
    """Background task that checks all devices health every 5 minutes."""
    logger.info("[HEALTH CHECKER] Started - running every 5 minutes")

    while True:
        try:
            await asyncio.sleep(300)  # 5 minutes = 300 seconds

            logger.info("Running scheduled health check for all devices...")

            async with async_session() as db:
                # Get all devices
                result = await db.execute(select(Device))
                devices = result.scalars().all()

                if not devices:
                    logger.info("No devices to check")
                    continue

                # Check each device
                for device in devices:
                    await check_device_health(device)
                    device.updated_at = datetime.now(timezone.utc)

                # Save all changes
                await db.commit()

                online_count = sum(1 for d in devices if d.status == "online")
                offline_count = sum(1 for d in devices if d.status == "offline")
                logger.info(f"Health check complete: {online_count} online, {offline_count} offline")

                # Auto-discover tunnels from online devices
                try:
                    tunnel_result = await discover_tunnels(db)
                    await db.commit()
                    logger.info(f"Tunnel discovery: {tunnel_result['tunnels_discovered']} new, scanned {tunnel_result['devices_scanned']} devices")
                except Exception as te:
                    logger.error(f"Tunnel discovery error: {te}")

        except asyncio.CancelledError:
            logger.info("Health checker stopped")
            break
        except Exception as e:
            logger.error(f"Error in health check loop: {e}", exc_info=True)
