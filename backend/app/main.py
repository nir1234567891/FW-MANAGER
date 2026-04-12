import asyncio
import hashlib
import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.database import engine, async_session, init_db, Base
from app.models import Device, VDOM, VPNTunnel, Backup, Policy, Alert

from app.routers import devices, backups, tunnels, monitoring, policies
from app.services.health_checker import health_check_loop

logger = logging.getLogger(__name__)


async def seed_demo_data():
    async with async_session() as db:
        result = await db.execute(select(Device).limit(1))
        if result.scalar_one_or_none():
            return

        logger.info("Seeding demo data...")

        now = datetime.now(timezone.utc)

        devices_data = [
            {
                "name": "FW-HQ-01", "hostname": "fw-hq-01", "ip_address": "10.0.1.1",
                "port": 443, "api_key": "demo-key-hq-01",
                "serial_number": "FGT6E0000000001", "firmware_version": "v7.4.4",
                "model": "FortiGate-600E", "ha_status": "active-passive",
                "status": "online", "vdom_list": ["root", "DMZ", "GUEST"],
                "cpu_usage": 32.5, "memory_usage": 58.2, "session_count": 45230,
                "uptime": "142 days 7:23:15", "last_seen": now,
                "notes": "Main HQ firewall - Primary"
            },
            {
                "name": "FW-DC-01", "hostname": "fw-dc-01", "ip_address": "10.0.2.1",
                "port": 443, "api_key": "demo-key-dc-01",
                "serial_number": "FG1KE0000000002", "firmware_version": "v7.4.4",
                "model": "FortiGate-1000E", "ha_status": "active-passive",
                "status": "online", "vdom_list": ["root", "SERVERS", "MGMT"],
                "cpu_usage": 18.7, "memory_usage": 42.1, "session_count": 28450,
                "uptime": "89 days 12:45:30", "last_seen": now,
                "notes": "Data Center primary firewall"
            },
            {
                "name": "FW-BRANCH-01", "hostname": "fw-branch-01", "ip_address": "10.1.1.1",
                "port": 443, "api_key": "demo-key-br-01",
                "serial_number": "FG100F0000000003", "firmware_version": "v7.4.3",
                "model": "FortiGate-100F", "ha_status": "standalone",
                "status": "online", "vdom_list": ["root"],
                "cpu_usage": 12.3, "memory_usage": 35.8, "session_count": 3200,
                "uptime": "56 days 3:12:45", "last_seen": now,
                "notes": "Tel Aviv branch office"
            },
            {
                "name": "FW-BRANCH-02", "hostname": "fw-branch-02", "ip_address": "10.1.2.1",
                "port": 443, "api_key": "demo-key-br-02",
                "serial_number": "FG100F0000000004", "firmware_version": "v7.4.3",
                "model": "FortiGate-100F", "ha_status": "standalone",
                "status": "online", "vdom_list": ["root"],
                "cpu_usage": 8.9, "memory_usage": 28.4, "session_count": 1850,
                "uptime": "34 days 15:30:00", "last_seen": now,
                "notes": "Haifa branch office"
            },
            {
                "name": "FW-DR-01", "hostname": "fw-dr-01", "ip_address": "10.0.3.1",
                "port": 443, "api_key": "demo-key-dr-01",
                "serial_number": "FGT6E0000000005", "firmware_version": "v7.4.2",
                "model": "FortiGate-600E", "ha_status": "standalone",
                "status": "offline", "vdom_list": ["root", "DR-SERVERS"],
                "cpu_usage": 0, "memory_usage": 0, "session_count": 0,
                "uptime": "0 days", "last_seen": now - timedelta(hours=3),
                "notes": "DR site firewall - OFFLINE since 3h ago"
            },
            {
                "name": "FW-CLOUD-01", "hostname": "fw-cloud-01", "ip_address": "172.16.0.1",
                "port": 443, "api_key": "demo-key-cloud-01",
                "serial_number": "FGVM020000000006", "firmware_version": "v7.4.4",
                "model": "FortiGate-VM02", "ha_status": "standalone",
                "status": "online", "vdom_list": ["root"],
                "cpu_usage": 45.2, "memory_usage": 62.8, "session_count": 12300,
                "uptime": "210 days 22:10:05", "last_seen": now,
                "notes": "Azure cloud FortiGate instance"
            },
        ]

        db_devices = []
        for dd in devices_data:
            device = Device(**dd)
            db.add(device)
            db_devices.append(device)

        await db.flush()

        vdoms_data = [
            (0, "root", "nat", "enabled", 12, 8),
            (0, "DMZ", "nat", "enabled", 6, 4),
            (0, "GUEST", "nat", "enabled", 3, 2),
            (1, "root", "nat", "enabled", 15, 10),
            (1, "SERVERS", "nat", "enabled", 8, 6),
            (1, "MGMT", "nat", "enabled", 4, 3),
            (2, "root", "nat", "enabled", 5, 4),
            (3, "root", "nat", "enabled", 5, 4),
            (4, "root", "nat", "enabled", 8, 6),
            (4, "DR-SERVERS", "nat", "enabled", 4, 3),
            (5, "root", "nat", "enabled", 6, 5),
        ]
        for idx, name, mode, status, pol_cnt, iface_cnt in vdoms_data:
            vdom = VDOM(
                device_id=db_devices[idx].id, name=name, mode=mode,
                status=status, policy_count=pol_cnt, interface_count=iface_cnt,
            )
            db.add(vdom)

        tunnels_data = [
            (0, "root", "HQ-to-DC", "10.0.2.1", 1, "ipsec", "up", 1_200_000_000, 980_000_000, "HQ-DC-P1", "HQ-DC-P2", "10.0.1.0/24", "10.0.2.0/24"),
            (0, "root", "HQ-to-BRANCH01", "10.1.1.1", 2, "ipsec", "up", 450_000_000, 320_000_000, "HQ-BR01-P1", "HQ-BR01-P2", "10.0.1.0/24", "10.1.1.0/24"),
            (0, "root", "HQ-to-BRANCH02", "10.1.2.1", 3, "ipsec", "up", 380_000_000, 290_000_000, "HQ-BR02-P1", "HQ-BR02-P2", "10.0.1.0/24", "10.1.2.0/24"),
            (0, "root", "HQ-to-DR", "10.0.3.1", 4, "ipsec", "down", 0, 0, "HQ-DR-P1", "HQ-DR-P2", "10.0.1.0/24", "10.0.3.0/24"),
            (0, "root", "HQ-to-CLOUD", "172.16.0.1", 5, "ipsec", "up", 890_000_000, 720_000_000, "HQ-CLD-P1", "HQ-CLD-P2", "10.0.1.0/24", "172.16.0.0/24"),
            (1, "root", "DC-to-HQ", "10.0.1.1", 0, "ipsec", "up", 980_000_000, 1_200_000_000, "DC-HQ-P1", "DC-HQ-P2", "10.0.2.0/24", "10.0.1.0/24"),
            (1, "root", "DC-to-DR", "10.0.3.1", 4, "ipsec", "down", 0, 0, "DC-DR-P1", "DC-DR-P2", "10.0.2.0/24", "10.0.3.0/24"),
            (1, "root", "DC-to-CLOUD", "172.16.0.1", 5, "ipsec", "up", 560_000_000, 430_000_000, "DC-CLD-P1", "DC-CLD-P2", "10.0.2.0/24", "172.16.0.0/24"),
            (2, "root", "BRANCH01-to-HQ", "10.0.1.1", 0, "ipsec", "up", 320_000_000, 450_000_000, "BR01-HQ-P1", "BR01-HQ-P2", "10.1.1.0/24", "10.0.1.0/24"),
            (3, "root", "BRANCH02-to-HQ", "10.0.1.1", 0, "ipsec", "up", 290_000_000, 380_000_000, "BR02-HQ-P1", "BR02-HQ-P2", "10.1.2.0/24", "10.0.1.0/24"),
            (4, "root", "DR-to-HQ", "10.0.1.1", 0, "ipsec", "down", 0, 0, "DR-HQ-P1", "DR-HQ-P2", "10.0.3.0/24", "10.0.1.0/24"),
            (4, "root", "DR-to-DC", "10.0.2.1", 1, "ipsec", "down", 0, 0, "DR-DC-P1", "DR-DC-P2", "10.0.3.0/24", "10.0.2.0/24"),
            (5, "root", "CLOUD-to-HQ", "10.0.1.1", 0, "ipsec", "up", 720_000_000, 890_000_000, "CLD-HQ-P1", "CLD-HQ-P2", "172.16.0.0/24", "10.0.1.0/24"),
            (5, "root", "CLOUD-to-DC", "10.0.2.1", 1, "ipsec", "up", 430_000_000, 560_000_000, "CLD-DC-P1", "CLD-DC-P2", "172.16.0.0/24", "10.0.2.0/24"),
        ]
        for d_idx, vdom_name, tname, rgw, rd_idx, ttype, status, ib, ob, p1, p2, lsub, rsub in tunnels_data:
            tunnel = VPNTunnel(
                device_id=db_devices[d_idx].id, vdom_name=vdom_name,
                tunnel_name=tname, remote_gateway=rgw,
                remote_device_id=db_devices[rd_idx].id,
                tunnel_type=ttype, status=status,
                incoming_bytes=ib, outgoing_bytes=ob,
                phase1_name=p1, phase2_name=p2,
                local_subnet=lsub, remote_subnet=rsub,
            )
            db.add(tunnel)

        backup_dir = os.path.abspath(settings.BACKUP_DIR)
        os.makedirs(backup_dir, exist_ok=True)

        sample_config_template = """#config-version={model}-{fw_version}:opmode=0:vdom=1:user={name}
#conf_file_ver=1234567890
#buildno=1234
#global_vdom=1
config system global
    set admintimeout 30
    set alias "{name}"
    set hostname "{hostname}"
    set timezone 04
end
config system interface
    edit "port1"
        set vdom "root"
        set ip {ip} 255.255.255.0
        set allowaccess ping https ssh snmp
        set type physical
    next
    edit "port2"
        set vdom "root"
        set ip 192.168.1.1 255.255.255.0
        set allowaccess ping https
        set type physical
    next
end
config firewall policy
    edit 1
        set name "Allow-LAN-to-Internet"
        set srcintf "port2"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
        set logtraffic all
    next
    edit 2
        set name "VPN-Traffic"
        set srcintf "port2"
        set dstintf "vpn-tunnel"
        set srcaddr "LAN-subnet"
        set dstaddr "Remote-subnet"
        set action accept
        set schedule "always"
        set service "ALL"
    next
end
config vpn ipsec phase1-interface
    edit "HQ-Tunnel"
        set interface "port1"
        set ike-version 2
        set peertype any
        set proposal aes256-sha256
        set remote-gw 10.0.1.1
        set psksecret ENC_DEMO_KEY
    next
end
"""

        for device in db_devices:
            device_backup_dir = os.path.join(backup_dir, device.name.replace(" ", "_"))
            os.makedirs(device_backup_dir, exist_ok=True)

            for days_ago in [7, 3, 0]:
                config_content = sample_config_template.format(
                    model=device.model, fw_version=device.firmware_version,
                    name=device.name, hostname=device.hostname, ip=device.ip_address,
                )
                if days_ago == 0:
                    config_content += f"\n# Latest backup - {device.name}\n"
                elif days_ago == 3:
                    config_content += f"\n# Mid-week backup - {device.name}\nconfig system admin\n    edit admin\n        set password ENC_OLD_PASS\n    next\nend\n"

                ts = now - timedelta(days=days_ago)
                ts_str = ts.strftime("%Y%m%d_%H%M%S")
                filename = f"{device.name}_full_{ts_str}.conf"
                filepath = os.path.join(device_backup_dir, filename)

                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(config_content)

                file_size = os.path.getsize(filepath)
                config_hash = hashlib.sha256(config_content.encode()).hexdigest()

                backup = Backup(
                    device_id=device.id, vdom_name=None, filename=filename,
                    filepath=filepath, file_size=file_size, backup_type="auto" if days_ago > 0 else "manual",
                    config_hash=config_hash, created_at=ts,
                    notes=f"{'Auto' if days_ago > 0 else 'Manual'} backup",
                )
                db.add(backup)

        policy_templates = [
            (1, "Allow-LAN-to-Internet", "port2", "port1", "LAN-Net", "all", "accept", "ALL", "always", "enable", "enable", "all", "Allow LAN users internet access", 125000),
            (2, "VPN-Site-Traffic", "port2", "vpn-tunnel", "LAN-Net", "Remote-Net", "accept", "ALL", "always", "disable", "enable", "all", "Inter-site VPN traffic", 89000),
            (3, "Allow-DNS", "port2", "port1", "all", "DNS-Servers", "accept", "DNS", "always", "enable", "enable", "utm", "DNS resolution", 340000),
            (4, "Allow-HTTPS", "port2", "port1", "all", "all", "accept", "HTTPS", "always", "enable", "enable", "all", "HTTPS traffic", 95000),
            (5, "Block-Malware-Sites", "port2", "port1", "all", "Malware-Block-List", "deny", "ALL", "always", "disable", "enable", "all", "Block known malware sites", 2300),
            (6, "Allow-ICMP", "any", "any", "all", "all", "accept", "PING", "always", "disable", "enable", "disable", "Allow ping for monitoring", 560000),
            (7, "Management-Access", "port1", "loopback", "Admin-Hosts", "FW-Mgmt", "accept", "HTTPS SSH", "always", "disable", "enable", "all", "Management access", 15000),
            (8, "Deny-All", "any", "any", "all", "all", "deny", "ALL", "always", "disable", "enable", "all", "Implicit deny rule", 45000),
        ]

        for device in db_devices:
            for vdom_name in (device.vdom_list or ["root"]):
                for pid, name, si, di, sa, da, action, svc, sched, nat, status, log, comment, hits in policy_templates:
                    policy = Policy(
                        device_id=device.id, vdom_name=vdom_name, policy_id=pid,
                        name=name, srcintf=si, dstintf=di, srcaddr=sa, dstaddr=da,
                        action=action, service=svc, schedule=sched, nat=nat,
                        status=status, logtraffic=log, comments=comment, hit_count=hits,
                    )
                    db.add(policy)

        alerts_data = [
            (4, "critical", "Device FW-DR-01 is unreachable for 3 hours", "device_down"),
            (4, "critical", "All VPN tunnels on FW-DR-01 are DOWN", "tunnel_down"),
            (0, "high", "VPN tunnel HQ-to-DR is DOWN", "tunnel_down"),
            (1, "high", "VPN tunnel DC-to-DR is DOWN", "tunnel_down"),
            (5, "high", "CPU usage on FW-CLOUD-01 reached 85% (threshold: 80%)", "cpu_high"),
            (0, "medium", "Firmware update available: v7.4.5 for FW-HQ-01", "firmware_update"),
            (1, "medium", "HA peer sync delay detected on FW-DC-01", "ha_warning"),
            (2, "medium", "Firmware update available: v7.4.5 for FW-BRANCH-01", "firmware_update"),
            (5, "medium", "Memory usage on FW-CLOUD-01 at 72% and rising", "memory_warning"),
            (0, "low", "Admin login from new IP 192.168.1.100 on FW-HQ-01", "auth_info"),
            (3, "info", "Configuration backup completed for FW-BRANCH-02", "backup_complete"),
            (1, "info", "SSL certificate for FW-DC-01 expires in 30 days", "cert_expiry"),
        ]
        for d_idx, severity, message, alert_type in alerts_data:
            alert = Alert(
                device_id=db_devices[d_idx].id, severity=severity,
                message=message, alert_type=alert_type,
                acknowledged=False, created_at=now - timedelta(minutes=d_idx * 15),
            )
            db.add(alert)

        await db.commit()
        logger.info("Demo data seeded successfully.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_demo_data()

    # Start health checker background task
    health_task = asyncio.create_task(health_check_loop())
    print("\n" + "="*60)
    print("[HEALTH CHECKER] Auto-checking devices every 5 minutes")
    print("="*60 + "\n")
    logger.info("Health checker background task started")

    yield

    # Cancel health checker on shutdown
    health_task.cancel()
    try:
        await health_task
    except asyncio.CancelledError:
        pass
    print("Health checker stopped")

    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Comprehensive FortiGate Management System",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices.router)
app.include_router(backups.router)
app.include_router(tunnels.router)
app.include_router(monitoring.router)
app.include_router(policies.router)


@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs",
    }


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}
