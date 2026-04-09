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
        self, method: str, path: str, params: Optional[dict] = None, data: Optional[dict] = None
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        if params is None:
            params = {}
        params["vdom"] = self.vdom

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

    async def _get(self, path: str, params: Optional[dict] = None) -> dict[str, Any]:
        return await self._request("GET", path, params=params)

    async def _post(self, path: str, data: Optional[dict] = None, params: Optional[dict] = None) -> dict[str, Any]:
        return await self._request("POST", path, params=params, data=data)

    async def test_connection(self) -> dict[str, Any]:
        try:
            result = await self.get_system_status()
            return {"success": True, "data": result}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def get_system_status(self) -> dict[str, Any]:
        result = await self._get("/api/v2/monitor/system/status")
        return result.get("results", result)

    async def get_interfaces(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        old_vdom = self.vdom
        if vdom:
            self.vdom = vdom
        try:
            result = await self._get("/api/v2/cmdb/system/interface")
            return result.get("results", [])
        finally:
            self.vdom = old_vdom

    async def get_vdoms(self) -> list[dict[str, Any]]:
        old_vdom = self.vdom
        self.vdom = "root"
        try:
            result = await self._get("/api/v2/cmdb/system/vdom")
            return result.get("results", [])
        finally:
            self.vdom = old_vdom

    async def get_vpn_tunnels(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        old_vdom = self.vdom
        if vdom:
            self.vdom = vdom
        try:
            result = await self._get("/api/v2/monitor/vpn/ipsec")
            return result.get("results", [])
        finally:
            self.vdom = old_vdom

    async def get_policies(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        old_vdom = self.vdom
        if vdom:
            self.vdom = vdom
        try:
            result = await self._get("/api/v2/cmdb/firewall/policy")
            return result.get("results", [])
        finally:
            self.vdom = old_vdom

    async def get_routes(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        old_vdom = self.vdom
        if vdom:
            self.vdom = vdom
        try:
            result = await self._get("/api/v2/monitor/router/ipv4")
            return result.get("results", [])
        finally:
            self.vdom = old_vdom

    async def get_ha_status(self) -> dict[str, Any]:
        result = await self._get("/api/v2/monitor/system/ha-peer")
        return result.get("results", result)

    async def get_system_performance(self) -> dict[str, Any]:
        result = await self._get("/api/v2/monitor/system/performance/status")
        return result.get("results", result)

    async def get_cpu_usage(self) -> float:
        perf = await self.get_system_performance()
        if isinstance(perf, dict):
            cpu = perf.get("cpu", perf.get("CPU", {}))
            if isinstance(cpu, dict):
                return float(cpu.get("cpu_usage", cpu.get("used", 0)))
            return float(cpu) if cpu else 0.0
        return 0.0

    async def get_memory_usage(self) -> float:
        perf = await self.get_system_performance()
        if isinstance(perf, dict):
            mem = perf.get("mem", perf.get("memory", {}))
            if isinstance(mem, dict):
                return float(mem.get("mem_usage", mem.get("used", 0)))
            return float(mem) if mem else 0.0
        return 0.0

    async def get_session_count(self) -> int:
        perf = await self.get_system_performance()
        if isinstance(perf, dict):
            session = perf.get("session", {})
            if isinstance(session, dict):
                return int(session.get("current_sessions", session.get("total", 0)))
            return int(session) if session else 0
        return 0

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

    async def get_dhcp_leases(self, vdom: Optional[str] = None) -> list[dict[str, Any]]:
        old_vdom = self.vdom
        if vdom:
            self.vdom = vdom
        try:
            result = await self._get("/api/v2/monitor/system/dhcp")
            return result.get("results", [])
        finally:
            self.vdom = old_vdom

    async def get_arp_table(self) -> list[dict[str, Any]]:
        result = await self._get("/api/v2/monitor/network/arp")
        return result.get("results", [])

    async def get_sessions_count(self) -> int:
        result = await self._get("/api/v2/monitor/firewall/session/summary")
        data = result.get("results", {})
        if isinstance(data, dict):
            return int(data.get("total", 0))
        return 0

    async def get_full_device_info(self) -> dict[str, Any]:
        info: dict[str, Any] = {}
        try:
            info["status"] = await self.get_system_status()
        except Exception as exc:
            info["status_error"] = str(exc)
        try:
            info["performance"] = await self.get_system_performance()
        except Exception as exc:
            info["performance_error"] = str(exc)
        try:
            info["ha"] = await self.get_ha_status()
        except Exception as exc:
            info["ha_error"] = str(exc)
        return info
