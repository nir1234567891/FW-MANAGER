"""Pydantic schemas matching real FortiGate API responses."""
from typing import Optional
from pydantic import BaseModel, Field


# ============================================================================
# IPsec VPN Monitor Schemas (from /api/v2/monitor/vpn/ipsec)
# ============================================================================

class ProxySubnet(BaseModel):
    """Subnet definition in proxy_src or proxy_dst."""
    subnet: str
    port: int
    protocol: int
    protocol_name: str


class ProxyID(BaseModel):
    """Phase 2 selector (proxy-id) with live status."""
    proxy_src: list[ProxySubnet]
    proxy_dst: list[ProxySubnet]
    status: str  # "up" or "down"
    p2name: str
    p2serial: int
    expire: int  # seconds until SA expires
    incoming_bytes: int
    outgoing_bytes: int


class IPsecTunnelStatus(BaseModel):
    """Live IPsec tunnel status from monitor API.

    Real structure from FortiGate monitor/vpn/ipsec endpoint.
    NOTE: There is NO top-level 'status' field - status is per proxyid.
    """
    name: str
    comments: str
    wizard_type: str = Field(alias="wizard-type")
    connection_count: int
    creation_time: int  # seconds since tunnel came up
    username: str  # remote peer identifier
    type: str  # "dialup" or "automatic"
    incoming_bytes: int  # total across all proxyids
    outgoing_bytes: int  # total across all proxyids
    rgwy: str  # remote gateway IP
    tun_id: str
    tun_id6: str
    proxyid: list[ProxyID]  # Phase 2 selectors with status

    class Config:
        populate_by_name = True


# ============================================================================
# IPsec Phase 1 CMDB Schemas (from /api/v2/cmdb/vpn/ipsec/phase1-interface)
# ============================================================================

class IPsecPhase1Config(BaseModel):
    """Phase 1 (IKE gateway) configuration.

    This is the CMDB config, not live status. Use IPsecTunnelStatus for status.
    Only including fields commonly used - FortiGate has 150+ fields.
    """
    name: str
    type: str  # "static" or "dialup"
    interface: str
    ike_version: str = Field(alias="ike-version")
    local_gw: str = Field(alias="local-gw")
    remote_gw: str = Field(alias="remote-gw")
    remote_gw6: str = Field(alias="remote-gw6")
    authmethod: str  # "psk" or "signature"
    mode: str  # "main" or "aggressive"
    peertype: str
    keylife: int
    proposal: str  # e.g., "aes256-sha256"
    dhgrp: str  # e.g., "14 5"
    nattraversal: str  # "enable" or "disable"
    keepalive: int
    dpd: str  # "on-demand", "on-idle", "disable"
    dpd_retrycount: int = Field(alias="dpd-retrycount")
    dpd_retryinterval: str = Field(alias="dpd-retryinterval")
    comments: str

    class Config:
        populate_by_name = True


# ============================================================================
# IPsec Phase 2 CMDB Schemas (from /api/v2/cmdb/vpn/ipsec/phase2-interface)
# ============================================================================

class IPsecPhase2Config(BaseModel):
    """Phase 2 (selector) configuration.

    This is the CMDB config. Use ProxyID for live status.
    """
    name: str
    phase1name: str
    proposal: str
    pfs: str  # "enable" or "disable"
    dhgrp: str
    replay: str
    keepalive: str
    keylifeseconds: int
    keylifekbs: int
    src_subnet: str = Field(alias="src-subnet")
    dst_subnet: str = Field(alias="dst-subnet")
    src_addr_type: str = Field(alias="src-addr-type")
    dst_addr_type: str = Field(alias="dst-addr-type")
    protocol: int
    src_port: int = Field(alias="src-port")
    dst_port: int = Field(alias="dst-port")
    comments: str

    class Config:
        populate_by_name = True


# ============================================================================
# API Response Wrappers
# ============================================================================

class FortiGateResponse(BaseModel):
    """Standard FortiGate API response wrapper."""
    http_method: str
    results: list[dict] | dict
    vdom: str
    path: str
    name: str
    status: str
    http_status: int
    serial: str
    version: str
    build: int


class IPsecMonitorResponse(FortiGateResponse):
    """Typed response for monitor/vpn/ipsec."""
    results: list[IPsecTunnelStatus]


class IPsecPhase1ListResponse(FortiGateResponse):
    """Typed response for cmdb/vpn/ipsec/phase1-interface list."""
    results: list[IPsecPhase1Config]


class IPsecPhase2ListResponse(FortiGateResponse):
    """Typed response for cmdb/vpn/ipsec/phase2-interface list."""
    results: list[IPsecPhase2Config]


# ============================================================================
# Application-Level Tunnel Schemas (for API responses)
# ============================================================================

class TunnelDetail(BaseModel):
    """Enriched tunnel data for frontend consumption."""
    id: int
    name: str
    type: str
    status: str  # "up" or "down" - derived from proxyid status
    source_device_id: str
    source_device_name: str
    dest_device_id: str
    dest_device_name: str
    source_ip: str
    dest_ip: str
    local_subnet: str
    remote_subnet: str
    incoming_bytes: int
    outgoing_bytes: int
    phase1_status: str  # "up" or "down"
    phase2_status: str  # "up" or "down"
    uptime: int  # seconds
    last_change: Optional[str]  # ISO datetime

    # Legacy fields for backward compatibility
    device_id: int
    vdom_name: str
    tunnel_name: str
    remote_gateway: Optional[str]
    remote_device_id: Optional[int]
    tunnel_type: str
    phase1_name: Optional[str]
    phase2_name: Optional[str]


class TunnelSummary(BaseModel):
    """Tunnel status summary."""
    total: int
    up: int
    down: int
    health_percent: float


class TunnelDiscoveryResult(BaseModel):
    """Result of tunnel discovery operation."""
    devices_scanned: int
    tunnels_discovered: int
    errors: list[dict]


# ============================================================================
# Firewall Policy Schemas (from /api/v2/cmdb/firewall/policy)
# ============================================================================

class PolicyObjectReference(BaseModel):
    """Reference to a named object in FortiGate (address, service, interface, etc.)."""
    name: str
    q_origin_key: str


class FirewallPolicyFull(BaseModel):
    """Complete IPv4 firewall policy structure from FortiGate.

    This matches the REAL deeply nested structure from FortiGate API.
    All fields with hyphens in FortiGate are converted to underscores in Python.
    Arrays of objects (srcintf, dstintf, srcaddr, dstaddr, service) are preserved as lists.
    """
    policyid: int
    q_origin_key: int
    status: str  # "enable" or "disable"
    name: str
    uuid: str
    uuid_idx: int = Field(alias="uuid-idx")

    # Interfaces - ARRAYS of objects, not strings!
    srcintf: list[PolicyObjectReference]
    dstintf: list[PolicyObjectReference]

    # Basic action
    action: str  # "accept" or "deny"

    # IPv4 Addresses - ARRAYS of objects
    srcaddr: list[PolicyObjectReference]
    dstaddr: list[PolicyObjectReference]
    srcaddr_negate: str = Field(alias="srcaddr-negate")  # "enable" or "disable"
    dstaddr_negate: str = Field(alias="dstaddr-negate")

    # IPv6 Addresses - ARRAYS (can be empty)
    srcaddr6: list[PolicyObjectReference]
    dstaddr6: list[PolicyObjectReference]
    srcaddr6_negate: str = Field(alias="srcaddr6-negate")
    dstaddr6_negate: str = Field(alias="dstaddr6-negate")

    # Services - ARRAY of objects
    service: list[PolicyObjectReference]
    service_negate: str = Field(alias="service-negate")

    # Internet Service fields
    internet_service: str = Field(alias="internet-service")  # "enable" or "disable"
    internet_service_name: list[PolicyObjectReference] = Field(alias="internet-service-name")
    internet_service_group: list[PolicyObjectReference] = Field(alias="internet-service-group")
    internet_service_custom: list[PolicyObjectReference] = Field(alias="internet-service-custom")
    internet_service_negate: str = Field(alias="internet-service-negate")

    # Schedule
    schedule: str  # Schedule name, default "always"
    schedule_timeout: str = Field(alias="schedule-timeout")

    # NAT settings
    nat: str  # "enable" or "disable"
    ippool: str  # "enable" or "disable"
    poolname: list[PolicyObjectReference]  # NAT IP pools
    poolname6: list[PolicyObjectReference]
    natip: str  # NAT IP range like "0.0.0.0 0.0.0.0"

    # UTM/Security Profiles
    utm_status: str = Field(alias="utm-status")  # "enable" or "disable"
    inspection_mode: str = Field(alias="inspection-mode")  # "flow" or "proxy"
    profile_type: str = Field(alias="profile-type")  # "single" or "group"
    profile_protocol_options: str = Field(alias="profile-protocol-options")
    ssl_ssh_profile: str = Field(alias="ssl-ssh-profile")
    av_profile: str = Field(alias="av-profile")
    webfilter_profile: str = Field(alias="webfilter-profile")
    dnsfilter_profile: str = Field(alias="dnsfilter-profile")
    emailfilter_profile: str = Field(alias="emailfilter-profile")
    dlp_profile: str = Field(alias="dlp-profile")
    file_filter_profile: str = Field(alias="file-filter-profile")
    ips_sensor: str = Field(alias="ips-sensor")
    application_list: str = Field(alias="application-list")
    voip_profile: str = Field(alias="voip-profile")
    waf_profile: str = Field(alias="waf-profile")
    ssh_filter_profile: str = Field(alias="ssh-filter-profile")

    # Logging
    logtraffic: str  # "all", "utm", or "disable"
    logtraffic_start: str = Field(alias="logtraffic-start")  # "enable" or "disable"
    capture_packet: str = Field(alias="capture-packet")

    # Authentication
    groups: list[PolicyObjectReference]
    users: list[PolicyObjectReference]
    fsso_groups: list[PolicyObjectReference] = Field(alias="fsso-groups")

    # VPN
    vpntunnel: str  # VPN tunnel name or empty

    # Comments and labels
    comments: str
    label: str
    global_label: str = Field(alias="global-label")

    # Advanced settings
    auto_asic_offload: str = Field(alias="auto-asic-offload")
    match_vip: str = Field(alias="match-vip")
    match_vip_only: str = Field(alias="match-vip-only")

    class Config:
        populate_by_name = True


class FirewallPolicySimplified(BaseModel):
    """Simplified firewall policy for easier frontend consumption.

    Converts arrays to comma-separated strings for display.
    """
    policyid: int
    name: str
    status: str
    action: str
    srcintf: str  # Comma-separated interface names
    dstintf: str
    srcaddr: str  # Comma-separated address names
    dstaddr: str
    service: str  # Comma-separated service names
    nat: str
    schedule: str
    logtraffic: str
    comments: str
    uuid: str
    hit_count: int = 0  # From database, not FortiGate API


class PolicyListResponse(BaseModel):
    """Response for policy list endpoint."""
    device_id: int
    device_name: str
    vdom_name: str
    policies: list[FirewallPolicySimplified]


class PolicySummary(BaseModel):
    """Summary statistics for policies on a device."""
    device_id: int
    device_name: str
    vdom_name: str
    total: int
    accept: int
    deny: int
    enabled: int
    disabled: int
    with_nat: int
    with_utm: int


class PolicySyncResult(BaseModel):
    """Result of policy sync operation."""
    message: str
    synced: int
    created: int
    updated: int
    errors: list[str] = []


# ============================================================================
# System Interface Schemas (from /api/v2/cmdb/system/interface)
# ============================================================================

class SecondaryIP(BaseModel):
    """Secondary IP address configuration."""
    id: int
    ip: str  # Format: "192.168.1.10 255.255.255.0"
    allowaccess: str = ""


class VRRPConfig(BaseModel):
    """VRRP (Virtual Router Redundancy Protocol) configuration."""
    vrid: int
    version: int = 3
    vrgrp: int = 0
    vrip: str  # Virtual IP
    priority: int = 100
    status: str = "enable"


class IPv6Config(BaseModel):
    """IPv6 configuration for an interface."""
    ip6_mode: str = Field(alias="ip6-mode")  # "static", "dhcp", "pppoe"
    ip6_address: str = Field(alias="ip6-address")  # Format: "2001:db8::1/64" or "::/0"
    ip6_allowaccess: str = Field(alias="ip6-allowaccess", default="")
    ip6_send_adv: str = Field(alias="ip6-send-adv", default="disable")
    autoconf: str = "disable"

    class Config:
        populate_by_name = True


class InterfaceFull(BaseModel):
    """Complete FortiGate interface configuration.

    This matches the REAL deeply nested structure from FortiGate API.
    IP addresses are in "IP NETMASK" format (space-separated).
    """
    name: str
    q_origin_key: str
    vdom: str

    # IP Configuration - IMPORTANT: Space-separated "IP NETMASK"!
    ip: str  # Format: "10.0.10.1 255.255.255.252" or "0.0.0.0 0.0.0.0"
    mode: str  # "static", "dhcp", "pppoe"
    allowaccess: str  # Space-separated: "ping https ssh"

    # Interface properties
    status: str  # "up" or "down"
    type: str  # "physical", "vlan", "loopback", "tunnel", "aggregate"
    role: str = "undefined"  # "lan", "wan", "dmz", "undefined"

    # Physical properties
    macaddr: str = ""
    speed: str = "auto"
    mtu: int = 1500
    mtu_override: str = Field(alias="mtu-override", default="disable")

    # VLAN properties (when type="vlan")
    interface: str = ""  # Parent interface name
    vlanid: int = 0
    vlan_protocol: str = Field(alias="vlan-protocol", default="8021q")

    # Tunnel properties (when type="tunnel")
    remote_ip: str = Field(alias="remote-ip", default="0.0.0.0 0.0.0.0")

    # Descriptive fields
    description: str = ""
    alias: str = ""

    # Advanced IP settings
    secondary_IP: str = Field(alias="secondary-IP", default="disable")
    secondaryip: list[SecondaryIP] = []

    # IPv6 configuration
    ipv6: IPv6Config

    # VRRP
    vrrp_virtual_mac: str = Field(alias="vrrp-virtual-mac", default="disable")
    vrrp: list[VRRPConfig] = []

    # Monitoring and QoS
    monitor_bandwidth: str = Field(alias="monitor-bandwidth", default="disable")
    inbandwidth: int = 0  # KB/s
    outbandwidth: int = 0  # KB/s
    estimated_upstream_bandwidth: int = Field(alias="estimated-upstream-bandwidth", default=0)
    estimated_downstream_bandwidth: int = Field(alias="estimated-downstream-bandwidth", default=0)

    # Routing
    distance: int = 5
    priority: int = 1
    defaultgw: str = "enable"
    gwdetect: str = "disable"
    detectserver: str = ""

    # Security
    device_identification: str = Field(alias="device-identification", default="disable")
    trust_ip_1: str = Field(alias="trust-ip-1", default="0.0.0.0 0.0.0.0")
    trust_ip_2: str = Field(alias="trust-ip-2", default="0.0.0.0 0.0.0.0")
    trust_ip_3: str = Field(alias="trust-ip-3", default="0.0.0.0 0.0.0.0")

    # Switch controller (for FortiSwitch)
    fortilink: str = "disable"
    switch_controller_access_vlan: str = Field(alias="switch-controller-access-vlan", default="disable")

    # DHCP relay
    dhcp_relay_service: str = Field(alias="dhcp-relay-service", default="disable")
    dhcp_relay_ip: str = Field(alias="dhcp-relay-ip", default="")

    # LLDP
    lldp_reception: str = Field(alias="lldp-reception", default="vdom")
    lldp_transmission: str = Field(alias="lldp-transmission", default="vdom")

    # SNMP index
    snmp_index: int = Field(alias="snmp-index", default=0)

    # Device index (internal FortiGate reference)
    devindex: int
    vindex: int = 0

    class Config:
        populate_by_name = True


class InterfaceSimplified(BaseModel):
    """Simplified interface representation for easier frontend consumption.

    Parses space-separated IP/netmask into separate fields.
    """
    name: str
    vdom: str
    ip_address: str  # Just the IP part
    netmask: str  # Just the netmask part
    status: str  # "up" or "down"
    type: str
    role: str
    macaddr: str
    mtu: int
    description: str
    alias: str
    # VLAN specific
    parent_interface: str = ""
    vlan_id: int = 0
    # Tunnel specific
    remote_ip_address: str = ""
    remote_netmask: str = ""
    # IPv6
    ipv6_address: str = ""
    ipv6_mode: str = ""
    # Access
    allowaccess: list[str] = []  # Parsed from space-separated string


class InterfaceListResponse(BaseModel):
    """Response for interface list endpoint."""
    device_id: int
    device_name: str
    vdom: str
    interfaces: list[InterfaceSimplified]


class InterfaceStatistics(BaseModel):
    """Interface statistics summary."""
    total_interfaces: int
    physical: int
    vlan: int
    tunnel: int
    loopback: int
    up: int
    down: int


# ============================================================================
# Dashboard / Device Health Schemas
# ============================================================================

class ResourceDataPoint(BaseModel):
    """Single data point from FortiGate historical resource usage.

    FortiGate returns history as [[timestamp_ms, value], ...] pairs.
    timestamp is Unix milliseconds, value is a percentage or count.
    """
    timestamp: int  # Unix milliseconds
    value: int      # Percentage (0-100) or raw count


class ResourceMetricHistory(BaseModel):
    """Complete data for one resource metric (CPU, memory, disk, sessions).

    Real FortiGate structure from monitor/system/resource/usage:
      results.cpu[0].current = 0        ← live percentage
      results.cpu[0].historical["1-min"].values = [[ts_ms, val], ...]
      results.cpu[0].historical["1-min"].min/max/average = int
    """
    current: int = 0                          # Live percentage or count
    min_1hour: int = 0                        # Min over last hour window
    max_1hour: int = 0                        # Max over last hour window
    avg_1hour: int = 0                        # Average over last hour window
    history_1min: list[ResourceDataPoint] = []    # ~20 samples, 3-sec granularity
    history_1hour: list[ResourceDataPoint] = []   # ~20 samples, 3-min granularity


class DeviceDashboard(BaseModel):
    """Complete dashboard payload for a single device.

    Combines system info (serial, firmware, model) with live resource metrics
    and historical trend data for rendering charts.

    Data sources:
      - system info   → monitor/system/status (serial, version, model, hostname)
      - resource data → monitor/system/resource/usage (cpu, mem, disk, session)
      - uptime        → monitor/web-ui/state (snapshot_utc_time - utc_last_reboot)
    """
    device_id: int
    device_name: str
    hostname: str
    serial_number: str
    firmware_version: str   # e.g. "v7.2.8"
    model: str              # Friendly: "FortiGateRugged 60F"
    model_code: str         # Internal: "FGR60F"
    status: str             # "online" / "offline" / "unknown"
    uptime: str             # e.g. "5 days 3:22:10"
    last_seen: Optional[str]

    # Live snapshot values (percentage 0-100, except session_count which is a count)
    cpu_usage: float
    memory_usage: float
    disk_usage: float
    session_count: int

    # Historical trends for charts — same structure as resource/usage historical data
    cpu: ResourceMetricHistory
    memory: ResourceMetricHistory
    disk: ResourceMetricHistory
    sessions: ResourceMetricHistory
