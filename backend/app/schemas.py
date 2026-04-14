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
    """Phase 1 (IKE gateway) configuration from CMDB.

    Real FortiGate structure (verified 2026-04-13, FGR60F v7.2.8):
      /api/v2/cmdb/vpn.ipsec/phase1-interface → 150+ fields per entry.
      Key fields extracted below. All have defaults for resilience.

    Use IPsecTunnelStatus for live status (monitor API).
    """
    name: str
    type: str = "static"  # "static" or "dialup"
    interface: str = ""  # Bound interface (e.g., "vlan10-vdom1")
    ike_version: str = Field(default="2", alias="ike-version")
    local_gw: str = Field(default="0.0.0.0", alias="local-gw")
    remote_gw: str = Field(default="0.0.0.0", alias="remote-gw")
    remote_gw6: str = Field(default="::", alias="remote-gw6")
    authmethod: str = "psk"  # "psk" or "signature"
    mode: str = "main"  # "main" or "aggressive" (IKEv1 only)
    peertype: str = "any"
    keylife: int = 86400  # seconds
    proposal: str = ""  # e.g., "aes256-sha256"
    dhgrp: str = ""  # e.g., "14 5"
    nattraversal: str = "enable"
    keepalive: int = 10
    dpd: str = "on-demand"  # "on-demand", "on-idle", "disable"
    dpd_retrycount: int = Field(default=3, alias="dpd-retrycount")
    dpd_retryinterval: str = Field(default="20", alias="dpd-retryinterval")
    comments: str = ""
    wizard_type: str = Field(default="custom", alias="wizard-type")
    auto_negotiate: str = Field(default="enable", alias="auto-negotiate")
    add_route: str = Field(default="enable", alias="add-route")
    distance: int = 15
    priority: int = 1

    class Config:
        populate_by_name = True


# ============================================================================
# IPsec Phase 2 CMDB Schemas (from /api/v2/cmdb/vpn/ipsec/phase2-interface)
# ============================================================================

class IPsecPhase2Config(BaseModel):
    """Phase 2 (selector/child SA) configuration from CMDB.

    Real FortiGate structure (verified 2026-04-13, FGR60F v7.2.8):
      /api/v2/cmdb/vpn.ipsec/phase2-interface → results = [{...}]

    NOTE: src-subnet/dst-subnet use space-separated "IP MASK" format,
          e.g., "0.0.0.0 0.0.0.0" (meaning all traffic).
    """
    name: str
    phase1name: str = ""
    proposal: str = ""  # e.g., "aes256-sha256"
    pfs: str = "enable"
    dhgrp: str = ""  # e.g., "14 5"
    replay: str = "enable"
    keepalive: str = "disable"
    auto_negotiate: str = Field(default="enable", alias="auto-negotiate")
    keylifeseconds: int = 43200
    keylifekbs: int = 5120
    keylife_type: str = Field(default="seconds", alias="keylife-type")
    encapsulation: str = "tunnel-mode"  # "tunnel-mode" or "transport-mode"
    src_subnet: str = Field(default="0.0.0.0 0.0.0.0", alias="src-subnet")
    dst_subnet: str = Field(default="0.0.0.0 0.0.0.0", alias="dst-subnet")
    src_addr_type: str = Field(default="subnet", alias="src-addr-type")
    dst_addr_type: str = Field(default="subnet", alias="dst-addr-type")
    protocol: int = 0
    src_port: int = Field(default=0, alias="src-port")
    dst_port: int = Field(default=0, alias="dst-port")
    comments: str = ""

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

    Real FortiGate structure (verified 2026-04-13, FGR60F v7.2.8):
      /api/v2/cmdb/firewall/policy → results = [{ policyid, status, name, uuid, ... }]

    All fields have defaults for resilience — FortiGate responses vary by firmware version.
    Arrays of objects (srcintf, dstintf, srcaddr, dstaddr, service) are preserved as lists.
    """
    policyid: int
    q_origin_key: int = 0
    status: str = "enable"  # "enable" or "disable"
    name: str = ""
    uuid: str = ""
    uuid_idx: int = Field(default=0, alias="uuid-idx")

    # Interfaces - ARRAYS of objects, not strings!
    srcintf: list[PolicyObjectReference] = []
    dstintf: list[PolicyObjectReference] = []

    # Basic action
    action: str = "accept"  # "accept" or "deny"

    # IPv4 Addresses - ARRAYS of objects
    srcaddr: list[PolicyObjectReference] = []
    dstaddr: list[PolicyObjectReference] = []
    srcaddr_negate: str = Field(default="disable", alias="srcaddr-negate")
    dstaddr_negate: str = Field(default="disable", alias="dstaddr-negate")

    # IPv6 Addresses - ARRAYS (can be empty)
    srcaddr6: list[PolicyObjectReference] = []
    dstaddr6: list[PolicyObjectReference] = []
    srcaddr6_negate: str = Field(default="disable", alias="srcaddr6-negate")
    dstaddr6_negate: str = Field(default="disable", alias="dstaddr6-negate")

    # Services - ARRAY of objects
    service: list[PolicyObjectReference] = []
    service_negate: str = Field(default="disable", alias="service-negate")

    # Internet Service fields
    internet_service: str = Field(default="disable", alias="internet-service")
    internet_service_name: list[PolicyObjectReference] = Field(default=[], alias="internet-service-name")
    internet_service_group: list[PolicyObjectReference] = Field(default=[], alias="internet-service-group")
    internet_service_custom: list[PolicyObjectReference] = Field(default=[], alias="internet-service-custom")
    internet_service_negate: str = Field(default="disable", alias="internet-service-negate")

    # Schedule
    schedule: str = "always"
    schedule_timeout: str = Field(default="disable", alias="schedule-timeout")

    # NAT settings
    nat: str = "disable"
    ippool: str = "disable"
    poolname: list[PolicyObjectReference] = []
    poolname6: list[PolicyObjectReference] = []
    natip: str = "0.0.0.0 0.0.0.0"

    # UTM/Security Profiles
    utm_status: str = Field(default="disable", alias="utm-status")
    inspection_mode: str = Field(default="flow", alias="inspection-mode")
    profile_type: str = Field(default="single", alias="profile-type")
    profile_group: str = Field(default="", alias="profile-group")
    profile_protocol_options: str = Field(default="default", alias="profile-protocol-options")
    ssl_ssh_profile: str = Field(default="", alias="ssl-ssh-profile")
    av_profile: str = Field(default="", alias="av-profile")
    webfilter_profile: str = Field(default="", alias="webfilter-profile")
    dnsfilter_profile: str = Field(default="", alias="dnsfilter-profile")
    emailfilter_profile: str = Field(default="", alias="emailfilter-profile")
    dlp_profile: str = Field(default="", alias="dlp-profile")
    file_filter_profile: str = Field(default="", alias="file-filter-profile")
    ips_sensor: str = Field(default="", alias="ips-sensor")
    application_list: str = Field(default="", alias="application-list")
    voip_profile: str = Field(default="", alias="voip-profile")
    waf_profile: str = Field(default="", alias="waf-profile")
    ssh_filter_profile: str = Field(default="", alias="ssh-filter-profile")

    # Logging
    logtraffic: str = "all"  # "all", "utm", or "disable"
    logtraffic_start: str = Field(default="disable", alias="logtraffic-start")
    capture_packet: str = Field(default="disable", alias="capture-packet")

    # Authentication
    groups: list[PolicyObjectReference] = []
    users: list[PolicyObjectReference] = []
    fsso_groups: list[PolicyObjectReference] = Field(default=[], alias="fsso-groups")

    # VPN
    vpntunnel: str = ""

    # Comments and labels
    comments: str = ""
    label: str = ""
    global_label: str = Field(default="", alias="global-label")

    # Advanced settings
    auto_asic_offload: str = Field(default="enable", alias="auto-asic-offload")
    match_vip: str = Field(default="enable", alias="match-vip")
    match_vip_only: str = Field(default="disable", alias="match-vip-only")

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
    status: str  # "up" or "down" (admin status)
    type: str  # "physical", "hard-switch", "switch", "tunnel", "vlan", "loopback", "aggregate", "redundant", "vdom-link"
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
    status: str  # "up" or "down" (admin status from CMDB)
    type: str  # "physical", "hard-switch", "switch", "tunnel", "vlan", "loopback", "aggregate", "redundant", "vdom-link"
    role: str  # "lan", "wan", "dmz", "undefined"
    mode: str  # "static", "dhcp", "pppoe"
    speed: str  # "auto", "1000full", etc. (from CMDB config, not link speed)
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
    """Interface count summary by type and admin status.

    Real FortiGate types observed (verified 2026-04-13, FGR60F v7.2.8):
      physical, hard-switch, switch, tunnel, vlan, loopback, aggregate, redundant, vdom-link
    """
    total_interfaces: int
    # By type
    physical: int
    hard_switch: int  # "hard-switch" type (e.g., "internal" on FortiGateRugged)
    vlan: int
    tunnel: int
    loopback: int
    aggregate: int
    switch: int  # Software switch
    other: int  # redundant, vdom-link, etc.
    # By admin status
    up: int
    down: int


class InterfaceTrafficStats(BaseModel):
    """Real-time interface traffic stats from monitor/system/interface/select.

    Real FortiGate structure (verified 2026-04-13, FGR60F v7.2.8):
      results is a DICT keyed by interface name, each value:
        { id, name, alias, mac, ip, mask, link, speed, duplex,
          tx_packets, rx_packets, tx_bytes, rx_bytes, tx_errors, rx_errors }

    NOTE: Only returns physical-layer interfaces.
    NOTE: Returns EMPTY for VDOM-scoped tokens on non-root VDOMs.
          Must query with vdom=root or use a global-admin token.
    """
    name: str
    alias: str = ""
    mac: str = ""
    ip: str = ""  # IP from kernel (may be 0.0.0.0 for unnumbered)
    mask: int = 0  # Prefix length (0 if no IP)
    link: bool  # Physical link state (true=link detected)
    speed: int  # Link speed in Mbps (0 if no link)
    duplex: int  # 1=full-duplex, 0=half/none
    tx_packets: int = 0
    rx_packets: int = 0
    tx_bytes: int = 0
    rx_bytes: int = 0
    tx_errors: int = 0
    rx_errors: int = 0


class InterfaceTrafficResponse(BaseModel):
    """Response for interface traffic stats endpoint."""
    device_id: int
    device_name: str
    vdom_note: str = "Traffic stats only available from root VDOM"
    interfaces: list[InterfaceTrafficStats]


# ============================================================================
# VDOM Schemas (from /api/v2/cmdb/system/vdom + /api/v2/cmdb/system/settings)
# ============================================================================

class VDOMDetail(BaseModel):
    """Enriched VDOM data combining two FortiGate endpoints.

    Data sources (verified 2026-04-13, FGR60F v7.2.8):

    1. /api/v2/cmdb/system/vdom → list of VDOMs:
       { name, q_origin_key, "short-name", "vcluster-id", flag }

    2. /api/v2/cmdb/system/settings (per VDOM) → VDOM settings:
       { opmode: "nat"|"transparent",
         "ngfw-mode": "profile-based"|"policy-based",
         "vdom-type": "traffic"|"admin",
         status: "enable"|"disable",
         comments: "" }

    NOTE: opmode and ngfw-mode are in system/settings, NOT in system/vdom.
    """
    name: str
    short_name: str = ""  # Display name (usually same as name)
    vdom_type: str = "traffic"  # "traffic" or "admin"
    opmode: str = "nat"  # "nat" or "transparent"
    ngfw_mode: str = "profile-based"  # "profile-based" or "policy-based"
    status: str = "enable"  # "enable" or "disable"
    vcluster_id: int = 0  # HA virtual cluster ID
    comments: str = ""
    # Counted from other endpoints:
    interface_count: int = 0
    policy_count: int = 0


class VDOMListResponse(BaseModel):
    """Response for VDOM list endpoint."""
    device_id: int
    device_name: str
    vdom_count: int
    vdoms: list[VDOMDetail]


# ============================================================================
# Routing Schemas (from /api/v2/monitor/router/ipv4, bgp/neighbors, ospf/neighbors)
# ============================================================================

class ActiveRoute(BaseModel):
    """Single route from the active routing table (FIB).

    Real FortiGate structure (verified 2026-04-13, FGR60F v7.2.8):
      /api/v2/monitor/router/ipv4 → results = [
        { ip_version, type, ip_mask, distance, metric, priority, vrf,
          gateway, non_rc_gateway, interface,
          ?is_tunnel_route, ?tunnel_parent, ?install_date }
      ]

    Types observed: "connect", "static", "bgp", "ospf", "rip", "isis", "kernel"
    """
    ip_version: int = 4
    type: str  # "connect", "static", "bgp", "ospf", "rip", etc.
    ip_mask: str  # CIDR notation: "10.0.10.0/30"
    distance: int = 0  # Administrative distance
    metric: int = 0
    priority: int = 0
    vrf: int = 0
    gateway: str = "0.0.0.0"  # Next hop (0.0.0.0 for connected)
    non_rc_gateway: str = "0.0.0.0"  # Non-recursive gateway
    interface: str = ""  # Outgoing interface name
    # Optional fields (present only on some routes):
    is_tunnel_route: bool = False
    tunnel_parent: str = ""
    install_date: Optional[int] = None  # Unix timestamp (seconds), only dynamic routes


class BGPNeighborStatus(BaseModel):
    """Live BGP neighbor status from monitor API.

    Real FortiGate structure (verified 2026-04-13):
      /api/v2/monitor/router/bgp/neighbors → results = [
        { neighbor_ip, local_ip, remote_as, admin_status, state, type }
      ]

    States: "Idle", "Connect", "Active", "OpenSent", "OpenConfirm", "Established"
    """
    neighbor_ip: str
    local_ip: str = ""
    remote_as: int
    local_as: int = 0
    admin_status: bool = True
    state: str  # "Established", "Active", "Idle", etc.
    type: str = "ipv4"  # "ipv4" or "ipv6"
    vdom: str = "root"
    uptime: str = ""
    description: str = ""


class BGPConfig(BaseModel):
    """BGP configuration summary from CMDB.

    Real FortiGate structure (verified 2026-04-13):
      /api/v2/cmdb/router/bgp → results = {
        as, "router-id", "keepalive-timer", "holdtime-timer",
        neighbor: [{ip, "remote-as", "update-source", ...}],
        network: [{id, prefix, ...}],
        redistribute: [{name, status, ...}]
      }
    """
    local_as: str = ""  # Local ASN (string, FortiGate returns it as string)
    router_id: str = ""
    keepalive_timer: int = 60
    holdtime_timer: int = 180
    neighbor_count: int = 0
    network_count: int = 0
    neighbors_configured: list[dict] = []  # Simplified neighbor list


class OSPFNeighborStatus(BaseModel):
    """Live OSPF neighbor status from monitor API.

    Real FortiGate structure (verified 2026-04-13):
      /api/v2/monitor/router/ospf/neighbors → results = [
        { neighbor_ip, router_id, state, priority }
      ]

    States: "Full", "2-Way", "Init", "Down", "ExStart", "Exchange", "Loading"
    """
    neighbor_ip: str
    router_id: str = ""
    state: str  # "Full", "2-Way", "Down", etc.
    priority: int = 1
    vdom: str = "root"
    area: str = ""
    interface_name: str = ""
    uptime: str = ""


class RoutingSummary(BaseModel):
    """Routing table summary for a device/VDOM."""
    device_id: int
    device_name: str
    vdom: str
    total_routes: int
    by_type: dict[str, int]  # {"connect": 3, "bgp": 1, "static": 1, ...}
    total_routes_ipv4: int = 0
    total_routes_ipv6: int = 0


class RouteListResponse(BaseModel):
    """Response for route list endpoint."""
    device_id: int
    device_name: str
    vdom: str
    total: int
    routes: list[ActiveRoute]


class BGPStatusResponse(BaseModel):
    """Response for BGP status endpoint."""
    device_id: int
    device_name: str
    vdom: str  # "all" when querying all VDOMs
    config: BGPConfig  # Config from first VDOM with BGP configured
    bgp_neighbors: list[BGPNeighborStatus]  # renamed for frontend clarity


class OSPFStatusResponse(BaseModel):
    """Response for OSPF status endpoint."""
    device_id: int
    device_name: str
    vdom: str  # "all" when querying all VDOMs
    ospf_neighbors: list[OSPFNeighborStatus]  # renamed for frontend clarity


# ============================================================================
# System Status Schemas (from /api/v2/monitor/system/status)
# ============================================================================

class SystemStatusResult(BaseModel):
    """System identity from monitor/system/status.

    Real FortiGate response (verified 2026-04-13 against FGR60F v7.2.8):
      results: { model_name, model_number, model, hostname, log_disk_status }
      envelope: serial, version, build  (merged into results by get_system_status())
    """
    model_name: str = ""       # e.g. "FortiGateRugged"
    model_number: str = ""     # e.g. "60F"
    model: str = ""            # Model code e.g. "FGR60F"
    hostname: str = ""         # e.g. "FGT-1"
    log_disk_status: str = ""  # "available" or "not_available"
    # Merged from envelope by get_system_status():
    serial: str = ""           # e.g. "FGR60FTK25003110"
    version: str = ""          # e.g. "v7.2.8"
    build: int = 0             # e.g. 1639


# ============================================================================
# Dashboard / Device Health Schemas
# (from /api/v2/monitor/system/resource/usage)
# ============================================================================

class ResourceDataPoint(BaseModel):
    """Single data point from FortiGate historical resource usage.

    FortiGate returns history as [[timestamp_ms, value], ...] pairs.
    The router's parse function converts these to {timestamp, value} objects.
    """
    timestamp: int  # Unix milliseconds
    value: int      # Percentage (0-100) or raw count


class ResourceTimeWindow(BaseModel):
    """One historical time window from FortiGate resource/usage.

    Real FortiGate structure (verified 2026-04-13):
      historical["1-hour"] = {
        "values": [[1776085401000, 0], [1776085221000, 5], ...],  ← ~20 samples
        "max": 10, "min": 3, "average": 7,
        "start": 1776081981000, "end": 1776085566000
      }

    FortiGate provides 6 windows with different granularities:
      "1-min"   → ~20 samples at  3-second intervals
      "10-min"  → ~20 samples at 30-second intervals
      "30-min"  → ~20 samples at 90-second intervals
      "1-hour"  → ~20 samples at  3-minute intervals
      "12-hour" → ~20 samples at 36-minute intervals
      "24-hour" → ~20 samples at 72-minute intervals
    """
    values: list[ResourceDataPoint] = []
    min: int = 0
    max: int = 0
    average: int = 0
    start: int = 0   # Unix milliseconds — window start
    end: int = 0     # Unix milliseconds — window end


class ResourceMetric(BaseModel):
    """Single resource metric from FortiGate resource/usage.

    Real FortiGate structure (verified 2026-04-13):
      results.cpu = [{
        "current": 0,
        "historical": {
          "1-min":   { values, min, max, average, start, end },
          "10-min":  { ... },
          "30-min":  { ... },
          "1-hour":  { ... },
          "12-hour": { ... },
          "24-hour": { ... }
        }
      }]

    FortiGate wraps each metric in an array (always length 1 for non-HA).
    This schema represents the INNER element after extracting [0].
    """
    current: int = 0
    historical: dict[str, ResourceTimeWindow] = {}


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

    # Full resource metrics with all 6 historical windows
    # Keys in .historical: "1-min", "10-min", "30-min", "1-hour", "12-hour", "24-hour"
    cpu: ResourceMetric
    memory: ResourceMetric
    disk: ResourceMetric
    sessions: ResourceMetric


# ============================================================================
# Alert Schemas
# ============================================================================

class AlertResponse(BaseModel):
    """Alert enriched with device name for frontend display.

    Used by GET /api/monitoring/alerts and related endpoints.
    Adds device_name so the frontend doesn't need a second request.
    """
    id: int
    device_id: int
    device_name: str        # Joined from devices table
    severity: str           # "critical", "high", "medium", "low", "info"
    message: str
    alert_type: Optional[str] = None   # e.g. "device_down", "cpu_high", "tunnel_down"
    acknowledged: bool
    created_at: Optional[str] = None   # ISO 8601 datetime string


class EvaluationResult(BaseModel):
    """Result of POST /api/monitoring/evaluate."""
    devices_checked: int
    alerts_created: int
    alerts: list[dict]      # List of {device_id, type, severity, message}


class BulkAcknowledgeResult(BaseModel):
    """Result of POST /api/monitoring/alerts/bulk-acknowledge."""
    acknowledged: int
    message: str


class BulkDeleteResult(BaseModel):
    """Result of DELETE /api/monitoring/alerts/acknowledged."""
    deleted: int
    message: str
