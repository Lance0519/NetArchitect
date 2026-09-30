/**
 * NetArchitect domain model.
 *
 * Discriminated unions, `readonly` throughout, no `any`, and no optional-by-
 * laziness. These types are shared by the pure engine, the persistence layer and
 * the UI, and they are the contract that keeps networking concepts out of
 * component code.
 *
 * This module imports nothing, so it is safe to import from anywhere.
 */

/* ------------------------------------------------------------------ *
 * Addressing
 * ------------------------------------------------------------------ */

/**
 * Address family discriminator.
 *
 * `ipv6` exists so the type layer reserves the slot for future expansion. No
 * IPv6 calculation ships in v1: the engine raises `UnsupportedFamilyError` rather
 * than returning a wrong answer. Designing for the future is not the same as
 * pretending the capability is already there.
 */
export type AddressFamily = 'ipv4' | 'ipv6';

/**
 * A CIDR block.
 *
 * `ip` is stored as an UNSIGNED 32-bit integer in [0, 2^32-1]. Note that `ip` is
 * not required to be a network address: `192.168.1.50/24` is a valid CIDR
 * *reference* (an address inside a network). Use `isNetworkBoundary()` to test
 * whether it is a valid subnet *definition*.
 */
export interface Cidr {
  readonly family: AddressFamily;
  readonly ip: number;
  /** Prefix length 0-32. */
  readonly prefix: number;
}

/** Classification of address space against the IANA registries. */
export type ReservedRangeKind =
  | 'this_network'
  | 'private'
  | 'cgnat'
  | 'loopback'
  | 'link_local'
  | 'ietf_protocol_assignments'
  | 'documentation'
  | 'benchmark'
  | 'multicast'
  | 'reserved'
  | 'public';

/**
 * A fully resolved subnet.
 *
 * Every field is derived. Nothing here is ever typed in by hand or cached from
 * a previous calculation - `calculateSubnet()` is the only producer.
 */
export interface SubnetInfo {
  readonly cidr: Cidr;

  /** First address of the block. */
  readonly networkAddress: number;
  /**
   * Last address of the block.
   * For /31 this is a real, usable endpoint per RFC 3021. For /32 it equals the
   * address itself.
   */
  readonly broadcastAddress: number;

  readonly subnetMask: number;
  readonly wildcardMask: number;

  /** First assignable host address. */
  readonly firstUsableHost: number;
  /** Last assignable host address. */
  readonly lastUsableHost: number;

  /** 2^(32-prefix). Up to 4294967296 for /0. */
  readonly totalAddresses: number;
  /**
   * Count of assignable hosts.
   * `total - 2` for /0-/30; `2` for /31 (RFC 3021); `1` for /32.
   */
  readonly usableHosts: number;

  readonly hostBits: number;
  readonly networkBits: number;

  /** True for /32: a single address, typically a loopback or a static host route. */
  readonly isHostRoute: boolean;
  /** True for /31: a point-to-point link per RFC 3021 where both addresses are usable. */
  readonly isPointToPoint: boolean;

  /** Address-space classification of the network address. */
  readonly addressSpace: ReservedRangeKind;
}

/** An inclusive integer range `[start, end]` over 32-bit address space. */
export interface AddressRange {
  readonly start: number;
  readonly end: number;
}

/* ------------------------------------------------------------------ *
 * Roles and profiles
 * ------------------------------------------------------------------ */

/** Predefined network roles, plus an escape hatch for user-defined roles. */
export type NetworkRole =
  'LAN' | 'SERVERS' | 'MANAGEMENT' | 'IOT' | 'GUEST' | 'DMZ' | 'VOIP' | 'POINT_TO_POINT' | 'CUSTOM';

/** Starting-point templates. Every address in a profile is derived, never hardcoded. */
export type PlanProfile = 'custom' | 'personal' | 'enterprise';

/** Static metadata about a role: label, icon, and design guidance. */
export interface RoleDefinition {
  readonly role: NetworkRole;
  readonly label: string;
  readonly description: string;
  /** Lucide icon name. */
  readonly icon: string;
  /**
   * Whether a VLAN ID is expected for this role. Point-to-point links are
   * commonly untagged, so they are not expected to carry one.
   */
  readonly expectsVlan: boolean;
  /** Whether this role is untrusted and must be isolated from user networks. */
  readonly isUntrusted: boolean;
  /** Whether the role's hosts are expected to run services reachable from outside. */
  readonly isServiceFacing: boolean;
  /** Design guidance shown in the planner. */
  readonly guidance: string;
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

/** A subnet as it appears inside a plan. Inputs are user-owned; derived values are computed. */
export interface PlannedSubnet {
  readonly id: string;
  readonly name: string;
  readonly role: NetworkRole;
  /** Populated only when `role === 'CUSTOM'`. */
  readonly customRoleLabel?: string;
  /** IEEE 802.1Q VLAN ID, 1-4094. Optional: untagged segments are legitimate. */
  readonly vlanId?: number;
  /** The subnet definition. Must be a network boundary. */
  readonly cidr: string;
  /** Gateway address, conventionally the first usable host. */
  readonly gateway?: string;
  /** Host count the user is designing for. Drives utilisation. */
  readonly requestedHosts: number;
  /** Display order. */
  readonly sortOrder: number;
}

/** A host requirement awaiting allocation. */
export interface HostRequirement {
  readonly id: string;
  readonly name: string;
  readonly requestedHosts: number;
  readonly role: NetworkRole;
}

/** A user-defined role, persisted so it survives across sessions. */
export interface CustomRole {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

/** The core plan document. */
export interface NetworkPlan {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Parent CIDR. Every subnet must fall inside it. */
  readonly parentCidr: string;
  readonly profile: PlanProfile;
  readonly subnets: readonly PlannedSubnet[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/* ------------------------------------------------------------------ *
 * VLSM allocation
 * ------------------------------------------------------------------ */

/** One subnet produced by the VLSM engine. */
export interface Allocation {
  readonly id: string;
  readonly name: string;
  readonly role: NetworkRole;
  readonly requestedHosts: number;
  /** The allocated subnet, fully resolved. */
  readonly subnet: SubnetInfo;
  /** CIDR string, e.g. "192.168.1.0/25". */
  readonly assignedCidr: string;
  /** Addresses left unused within the allocated block. */
  readonly wastedAddresses: number;
  /** requestedHosts / hostCapacity, 0-100. */
  readonly utilisationPercent: number;
}

/** A contiguous unused region of the parent network. */
export interface FreeRange extends AddressRange {
  readonly cidr: string;
  readonly addresses: number;
  /** True when the fragment is too small to be useful (below /29). */
  readonly isFragmented: boolean;
}

/** The complete result of packing a parent network. */
export interface VlsmResult {
  readonly parentCidr: Cidr;
  readonly allocations: readonly Allocation[];
  readonly freeRanges: readonly FreeRange[];
  readonly totalAddresses: number;
  readonly allocatedAddresses: number;
  readonly freeAddresses: number;
  /** allocatedAddresses / totalAddresses * 100. */
  readonly spaceUtilisationPercent: number;
  /** sum(usableHosts) / allocatedAddresses * 100. */
  readonly hostEfficiencyPercent: number;
}

/* ------------------------------------------------------------------ *
 * Security audit
 * ------------------------------------------------------------------ */

export type Severity = 'critical' | 'high' | 'medium' | 'info';

/** Severity ordinal for sorting. Lower sorts first (more severe). */
export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
});

/**
 * A single audit finding.
 *
 * All four prose fields are required by design. A finding without a
 * "why it matters" and a remediation is an opinion, not a review finding.
 */
export interface SecurityIssue {
  /** Stable rule identifier, e.g. "SEC-003". */
  readonly ruleId: string;
  readonly severity: Severity;
  readonly title: string;
  /** What is wrong, stated concretely. */
  readonly problem: string;
  /** The engineering consequence. */
  readonly whyItMatters: string;
  /** What to do about it. */
  readonly remediation: string;
  /** Published standard backing the rule, e.g. "RFC 1918". */
  readonly citation: string;
  /** Ids of the subnets the finding concerns. */
  readonly affectedSubnetIds: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Per-Subnet Host Allocation
 * ------------------------------------------------------------------ */

export interface HostAllocationPlan {
  readonly networkAddress: string;
  readonly gateway: string;
  readonly staticRange: {
    readonly start: string;
    readonly end: string;
    readonly count: number;
  } | null;
  readonly dhcpPool: {
    readonly start: string;
    readonly end: string;
    readonly count: number;
  } | null;
  readonly broadcastAddress: string | null;
  readonly totalAssignable: number;
}

/* ------------------------------------------------------------------ *
 * Configuration export
 * ------------------------------------------------------------------ */

export type ExportTarget = 'cisco-ios' | 'linux-iptables' | 'mikrotik' | 'terraform' | 'json';

export interface ExportOptions {
  /**
   * Subinterface naming for Cisco output, e.g. "GigabitEthernet0/0.{vlan}".
   * Platform naming conventions differ, so this must be user-configurable
   * rather than assumed.
   */
  readonly subinterfaceTemplate?: string;
  /** Include the "template, review before applying" banner. On by default. */
  readonly includeBanner?: boolean;
}
