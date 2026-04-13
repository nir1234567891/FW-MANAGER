from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON
)
from sqlalchemy.orm import relationship
from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    hostname = Column(String(255), nullable=False)
    ip_address = Column(String(45), nullable=False)
    port = Column(Integer, default=443)
    api_key = Column(String(255), nullable=False)
    serial_number = Column(String(100), nullable=True)
    firmware_version = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    ha_status = Column(String(50), default="standalone")
    status = Column(String(20), default="unknown", index=True)
    vdom_list = Column(JSON, default=list)
    cpu_usage = Column(Float, default=0.0)
    memory_usage = Column(Float, default=0.0)
    disk_usage = Column(Float, default=0.0)
    session_count = Column(Integer, default=0)
    uptime = Column(String(100), nullable=True)
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    notes = Column(Text, nullable=True)

    vdoms = relationship("VDOM", back_populates="device", cascade="all, delete-orphan")
    vpn_tunnels = relationship("VPNTunnel", back_populates="device", cascade="all, delete-orphan",
                               foreign_keys="VPNTunnel.device_id")
    backups = relationship("Backup", back_populates="device", cascade="all, delete-orphan")
    policies = relationship("Policy", back_populates="device", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="device", cascade="all, delete-orphan")


class VDOM(Base):
    __tablename__ = "vdoms"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    mode = Column(String(50), default="nat")
    status = Column(String(20), default="enabled")
    policy_count = Column(Integer, default=0)
    interface_count = Column(Integer, default=0)

    device = relationship("Device", back_populates="vdoms")


class VPNTunnel(Base):
    __tablename__ = "vpn_tunnels"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    vdom_name = Column(String(100), default="root")
    tunnel_name = Column(String(255), nullable=False)
    remote_gateway = Column(String(45), nullable=True)
    remote_device_id = Column(Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    tunnel_type = Column(String(20), default="ipsec")
    status = Column(String(10), default="down")
    incoming_bytes = Column(Integer, default=0)
    outgoing_bytes = Column(Integer, default=0)
    phase1_name = Column(String(255), nullable=True)
    phase2_name = Column(String(255), nullable=True)
    local_subnet = Column(String(50), nullable=True)
    remote_subnet = Column(String(50), nullable=True)
    uptime_seconds = Column(Integer, default=0)
    last_check = Column(DateTime, default=utcnow)

    device = relationship("Device", back_populates="vpn_tunnels", foreign_keys=[device_id])
    remote_device = relationship("Device", foreign_keys=[remote_device_id])


class Backup(Base):
    __tablename__ = "backups"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    vdom_name = Column(String(100), nullable=True)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False)
    file_size = Column(Integer, default=0)
    backup_type = Column(String(20), default="full")
    config_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    notes = Column(Text, nullable=True)

    device = relationship("Device", back_populates="backups")


class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    vdom_name = Column(String(100), default="root")
    policy_id = Column(Integer, nullable=False)
    name = Column(String(255), nullable=True)
    uuid = Column(String(100), nullable=True)  # FortiGate UUID

    # Interfaces - stored as JSON arrays of objects
    srcintf = Column(JSON, default=list)  # [{"name": "port1", "q_origin_key": "port1"}]
    dstintf = Column(JSON, default=list)

    # Addresses - stored as JSON arrays of objects
    srcaddr = Column(JSON, default=list)  # [{"name": "all", "q_origin_key": "all"}]
    dstaddr = Column(JSON, default=list)
    srcaddr6 = Column(JSON, default=list)  # IPv6 addresses
    dstaddr6 = Column(JSON, default=list)

    # Services - stored as JSON array of objects
    service = Column(JSON, default=list)  # [{"name": "HTTP", "q_origin_key": "HTTP"}]

    # Basic fields
    action = Column(String(20), default="accept")
    schedule = Column(String(100), default="always")
    status = Column(String(10), default="enable")

    # NAT settings
    nat = Column(String(10), default="disable")
    ippool = Column(String(10), default="disable")
    poolname = Column(JSON, default=list)  # NAT IP pools
    natip = Column(String(50), default="0.0.0.0 0.0.0.0")

    # Security profiles
    utm_status = Column(String(10), default="disable")
    inspection_mode = Column(String(20), default="flow")
    av_profile = Column(String(100), default="")
    webfilter_profile = Column(String(100), default="")
    ips_sensor = Column(String(100), default="")
    application_list = Column(String(100), default="")
    ssl_ssh_profile = Column(String(100), default="")

    # Logging
    logtraffic = Column(String(20), default="all")
    logtraffic_start = Column(String(10), default="disable")

    # Comments and metadata
    comments = Column(Text, nullable=True)
    hit_count = Column(Integer, default=0)

    device = relationship("Device", back_populates="policies")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    severity = Column(String(20), default="info", index=True)
    message = Column(Text, nullable=False)
    alert_type = Column(String(50), nullable=True)
    acknowledged = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

    device = relationship("Device", back_populates="alerts")
