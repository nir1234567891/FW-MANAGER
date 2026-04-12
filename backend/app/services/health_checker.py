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
        # Try to get system status
        status_data = await api.get_system_status()

        # Device is online
        device.status = "online"
        device.last_seen = datetime.now(timezone.utc)

        # Update basic info
        if status_data.get("serial"):
            device.serial_number = status_data["serial"]
        if status_data.get("version"):
            device.firmware_version = status_data["version"]
        if status_data.get("model"):
            device.model = status_data["model"]
        if status_data.get("hostname"):
            device.hostname = status_data["hostname"]
        if status_data.get("uptime"):
            device.uptime = status_data["uptime"]

        # Refresh VDOM list
        try:
            vdoms = await api.get_vdoms()
            vdom_names = [v.get("name", "root") for v in vdoms]
            if vdom_names and vdom_names != device.vdom_list:
                device.vdom_list = vdom_names
                logger.info(f"Updated VDOMs for {device.name}: {vdom_names}")
        except Exception as e:
            logger.debug(f"Could not refresh VDOMs for {device.name}: {e}")

        # Try to get resource usage
        try:
            resource = await api.get_resource_usage()
            if isinstance(resource, dict):
                cpu_val = _extract_current(resource.get("cpu"))
                mem_val = _extract_current(resource.get("mem"))
                sess_val = _extract_current(resource.get("session"))
                device.cpu_usage = float(cpu_val)
                device.memory_usage = float(mem_val)
                device.session_count = sess_val
        except Exception as e:
            logger.debug(f"Could not fetch resource usage for {device.name}: {e}")

        # Try to get uptime
        try:
            uptime_secs = await api.get_uptime_seconds()
            if uptime_secs > 0:
                device.uptime = api.format_uptime(uptime_secs)
        except Exception as e:
            logger.debug(f"Could not fetch uptime for {device.name}: {e}")

        logger.info(f"[OK] Device {device.name} is ONLINE")

    except Exception as e:
        # Device is offline - clear stale metrics
        device.status = "offline"
        device.cpu_usage = 0
        device.memory_usage = 0
        device.session_count = 0
        device.uptime = "0 days"
        logger.warning(f"[FAIL] Device {device.name} is OFFLINE: {e}")


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
