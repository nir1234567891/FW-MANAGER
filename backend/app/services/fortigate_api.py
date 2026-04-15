import httpx
import logging
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger(__name__)


class FortiGateAPI:
    """Async REST API client for FortiGate devices."""

    def __init__(self, host: str, port: int = 443, api_key: str = "", vdom: str = "root"):
        self.host = host
        self.port = port
        self.api_key = api_key
        self.vdom = vdom
        self.base_url = f"https://{host}:{port}"
        self.timeout = httpx.Timeout(
            connect=settings.API_CONNECT_TIMEOUT,
            read=settings.API_REQUEST_TIMEOUT,
            write=settings.API_REQUEST_TIMEOUT,
            pool=settings.API_REQUEST_TIMEOUT,
        )

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def _request(
        self, method: str, path: str, params: Optional[dict] = None,
        data: Optional[dict] = None, vdom: Optional[str] = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        if params is None:
            params = {}
        params["vdom"] = vdom or self.vdom

        async with httpx.AsyncClient(verify=False, timeout=self.timeout) as client:
            try:
                response = await client.request(
                    method, url, headers=self._headers(), params=params, json=data
                )
                response.raise_for_status()
                return response.json()
            except httpx.TimeoutException:
                logger.error("Timeout connecting to %s", url)
                raise ConnectionError(f"Timeout connecting to {self.host}:{self.port}")
            except httpx.ConnectError:
                logger.error("Cannot connect to %s", url)
                raise ConnectionError(f"Cannot connect to {self.host}:{self.port}")
            except httpx.HTTPStatusError as exc:
                logger.error("HTTP %s from %s: %s", exc.response.status_code, url, exc.response.text)
                raise
            except Exception as exc:
                logger.error("Unexpected error communicating with %s: %s", url, exc)
                raise

    async def _get(self, path: str, params: Optional[dict] = None, vdom: Optional[str] = None) -> dict[str, Any]:
        return await self._request("GET", path, params=params, vdom=vdom)

    async def _post(self, path: str, data: Optional[dict] = None, params: Optional[dict] = None, vdom: Optional[str] = None) -> dict[str, Any]:
        return await self._request("POST", path, params=params, data=data, vdom=vdom)

    async def test_connection(self) -> dict[str, Any]:
        try:
            result = await self.get_system_status()
            return {"success": True, "data": result}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def get_system_status(self) -> dict[str, Any]:
        """Get system status. Merges top-level fields (serial, version, build)
        with the inner results dict, since FortiGate splits them."""
        raw = await self._get("/api/v2/monitor/system/status")
        results = raw.get("results", {})
        if isinstance(results, dict):
            # Merge top-level serial/version/build into results
            for key in ("serial", "version", "build"):
                if key in raw and key not in results:
                    results[key] = raw[key]
            return results
        return raw

    async def get_interfaces(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        """Get all interface configurations from CMDB.

        Returns a list of interface dicts with full config (IP, type, status, etc.).
        IP addresses are in "IP NETMASK" space-separated format.
        """
        result = await self._get("/api/v2/cmdb/system/interface", vdom=vdom)
        return result.get("results", [])

    async def get_interface_traffic_stats(self) -> dict[str, Any]:
        """Get real-time interface traffic stats (bytes, packets, errors, link state).

        IMPORTANT: Returns a DICT keyed by interface name (not a list).
        IMPORTANT: Only returns physical-layer interfaces.
        IMPORTANT: Returns EMPTY {} for VDOM-scoped tokens on non-root VDOMs.
                   This method forces vdom=root for the request.
        """
        result = await self._get(
            "/api/v2/monitor/system/interface",
            params={"include_vlan": "true"},
            vdom="root",
        )
        return result.get("results", {})

    async def get_vdoms(self) -> list[dict[str, Any]]:
        """Get list of all VDOMs from CMDB.

        NOTE: Must query from root VDOM to see all VDOMs.
        """
        result = await self._get("/api/v2/cmdb/system/vdom", vdom="root")
        return result.get("results", [])

    async def get_vdom_settings(self, vdom: str) -> dict[str, Any]:
        """Get system settings for a specific VDOM (opmode, ngfw-mode, etc.)."""
        result = await self._get("/api/v2/cmdb/system/settings", vdom=vdom)
        return result.get("results", {})

    async def get_vpn_tunnels(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/monitor/vpn/ipsec", vdom=vdom)
        return result.get("results", [])

    async def get_policies(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/cmdb/firewall/policy", vdom=vdom)
        return result.get("results", [])

    async def get_routes(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/monitor/router/ipv4", vdom=vdom)
        return result.get("results", [])

    async def get_ha_status(self) -> dict[str, Any]:
        result = await self._get("/api/v2/monitor/system/ha-peer")
        return result.get("results", result)

    async def get_resource_usage(self) -> dict[str, Any]:
        """Get resource usage: CPU, memory, disk, sessions + historical trends.

        Real FortiGate structure (verified 2026-04-13, FGR60F v7.2.8):
          results.cpu     → [{current: int, historical: {1-min: {...}, ...}}]
          results.mem     → same
          results.disk    → same
          results.session → same
          results.session6, setuprate, setuprate6, disk_lograte,
            faz_lograte, forticloud_lograte, faz_cloud_lograte → same

        Each metric is an ARRAY (length 1). Use [0]["current"] for live value.
        Each historical window has: values ([[ts_ms, val], ...]), min, max, average, start, end.
        Windows: "1-min", "10-min", "30-min", "1-hour", "12-hour", "24-hour".
        """
        result = await self._get("/api/v2/monitor/system/resource/usage")
        return result.get("results", {})

    async def get_system_global(self) -> dict[str, Any]:
        """Get system global settings (CMDB).

        Real FortiGate structure (verified 2026-04-13):
          results.hostname, results.alias, results["vdom-mode"],
          results["admin-sport"], results.admintimeout, etc.

        NOTE: This is a CMDB endpoint — results is a flat dict, not a list.
        The response also includes a 'revision' field on the envelope.
        """
        result = await self._get("/api/v2/cmdb/system/global")
        return result.get("results", {})

    async def backup_config(self, vdom: Optional[str] = None, scope: str = "global") -> str:
        params: dict[str, Any] = {"scope": scope}
        if vdom and scope == "vdom":
            params["vdom"] = vdom

        url = f"{self.base_url}/api/v2/monitor/system/config/backup"
        async with httpx.AsyncClient(verify=False, timeout=self.timeout) as client:
            try:
                response = await client.get(url, headers=self._headers(), params=params)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "application/json" in content_type:
                    data = response.json()
                    raise RuntimeError(f"Backup failed: {data}")
                return response.text
            except httpx.TimeoutException:
                raise ConnectionError(f"Timeout during backup of {self.host}")
            except httpx.ConnectError:
                raise ConnectionError(f"Cannot connect to {self.host}:{self.port}")

    # ------------------------------------------------------------------
    # Firewall Objects (addresses, services, groups)
    # ------------------------------------------------------------------

    async def get_firewall_addresses(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/cmdb/firewall/address", vdom=vdom)
        return result.get("results", [])

    async def create_firewall_address(self, data: dict[str, Any], vdom: Optional[str] = None) -> dict[str, Any]:
        return await self._post("/api/v2/cmdb/firewall/address", data=data, vdom=vdom)

    async def get_firewall_services(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/cmdb/firewall.service/custom", vdom=vdom)
        return result.get("results", [])

    async def create_firewall_service(self, data: dict[str, Any], vdom: Optional[str] = None) -> dict[str, Any]:
        return await self._post("/api/v2/cmdb/firewall.service/custom", data=data, vdom=vdom)

    async def get_firewall_address_groups(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/cmdb/firewall/addrgrp", vdom=vdom)
        return result.get("results", [])

    async def get_firewall_service_groups(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/cmdb/firewall.service/group", vdom=vdom)
        return result.get("results", [])

    async def get_dhcp_leases(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/monitor/system/dhcp", vdom=vdom)
        return result.get("results", [])

    async def get_arp_table(self) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/monitor/network/arp")
        return result.get("results", [])

    async def get_bgp_neighbors(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/monitor/router/bgp/neighbors", vdom=vdom)
        return result.get("results", [])

    async def get_bgp_config(self, vdom: Optional[str] = None) -> dict[str, Any]:
        result = await self._get("/api/v2/cmdb/router/bgp", vdom=vdom)
        return result.get("results", {})

    async def get_ospf_neighbors(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/monitor/router/ospf/neighbors", vdom=vdom)
        return result.get("results", [])

    async def get_ospf_config(self, vdom: Optional[str] = None) -> dict[str, Any]:
        result = await self._get("/api/v2/cmdb/router/ospf", vdom=vdom)
        return result.get("results", {})

    async def get_uptime_seconds(self) -> int:
        """Calculate device uptime in seconds from web-ui state.
        Uses snapshot_utc_time - utc_last_reboot to get accurate uptime.
        Times are in milliseconds, so we divide by 1000."""
        try:
            result = await self._get("/api/v2/monitor/web-ui/state")
            data = result.get("results", {})

            snapshot_time = data.get("snapshot_utc_time", 0)
            last_reboot = data.get("utc_last_reboot", 0)

            if snapshot_time > 0 and last_reboot > 0:
                # Times are in milliseconds, convert to seconds
                uptime_seconds = int((snapshot_time - last_reboot) / 1000)
                logger.info("Uptime calculated: %d seconds (snapshot: %d ms, reboot: %d ms)",
                           uptime_seconds, snapshot_time, last_reboot)
                return uptime_seconds
            else:
                logger.warning("Missing timestamp data: snapshot=%d, reboot=%d",
                              snapshot_time, last_reboot)
        except Exception as exc:
            logger.error("Uptime calculation failed: %s", exc)

        return 0

    def format_uptime(self, seconds: int) -> str:
        """Format uptime seconds as 'X days H:MM:SS'"""
        if seconds <= 0:
            return "0 days 0:00:00"
        days = seconds // 86400
        hours = (seconds % 86400) // 3600
        mins = (seconds % 3600) // 60
        secs = seconds % 60
        return f"{days} days {hours}:{mins:02d}:{secs:02d}"

    async def get_full_device_info(self) -> dict[str, Any]:
        """Aggregate key device info in one call. Used for diagnostics."""
        info: dict[str, Any] = {}
        try:
            info["status"] = await self.get_system_status()
        except Exception as exc:
            info["status_error"] = str(exc)
        try:
            info["resource_usage"] = await self.get_resource_usage()
        except Exception as exc:
            info["resource_usage_error"] = str(exc)
        try:
            info["ha"] = await self.get_ha_status()
        except Exception as exc:
            info["ha_error"] = str(exc)
        try:
            uptime_secs = await self.get_uptime_seconds()
            info["uptime_seconds"] = uptime_secs
            info["uptime"] = self.format_uptime(uptime_secs)
        except Exception as exc:
            info["uptime_error"] = str(exc)
        return info
