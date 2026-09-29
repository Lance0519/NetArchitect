/**
 * Network standards registry.
 *
 * Every address-space classification, every auditor rule and every generated
 * configuration convention in NetArchitect traces back to a published standard
 * or a universal design practice. This module is the single source of truth for
 * those references so that:
 *
 *   1. the engine classifies address space the same way every authoritative
 *      registry does, and
 *   2. the UI can attribute each recommendation ("Per RFC 1918") instead of
 *      stating opinion as fact.
 *
 * Unattributed advice is what gets a planning tool dismissed by a network
 * engineer. Attributed, correct advice is what gets it trusted.
 *
 * This module contains DATA ONLY. The classification function lives in
 * `ip-engine.ts` so the engine stays the one place address math happens.
 */

import type { ReservedRangeKind } from '../types/network';

/** Bibliographic references, keyed for lookup and rendering. */
export const STANDARD_REFS = {
  /** Private address space for internal networks. 10/8, 172.16/12, 192.168/16. */
  RFC1918: 'RFC 1918',
  /** CIDR: the Internet Address Assignment Plan. Supersedes RFC 1518/1519. */
  RFC4632: 'RFC 4632',
  /** Using 31-Bit Prefixes on IPv4 Point-to-Point Links. */
  RFC3021: 'RFC 3021',
  /** "This net" and "this host" semantics. 0.0.0.0 is not a usable source address. */
  RFC1912: 'RFC 1912',
  /** Requirements for Internet Hosts. 127/8 must be handled internally. */
  RFC1122: 'RFC 1122',
  /** Router Requirements. Routers MUST NOT forward broadcast-destined datagrams. */
  RFC1812: 'RFC 1812 §5.3.7',
  /** IANA Special-Purpose IP Address Registries (the umbrella registry). */
  RFC6890: 'RFC 6890',
  /** Shared Address Space (CGNAT), 100.64.0.0/10. NOT private space. */
  RFC6598: 'RFC 6598',
  /** Special IPv4 Address Blocks (TEST-NET-1/2/3, documentation ranges). */
  RFC5737: 'RFC 5737',
  /** IPv4 Link-Local Addresses (APIPA), 169.254.0.0/16. */
  RFC3927: 'RFC 3927',
  /** Benchmarking, 198.18.0.0/15. */
  RFC2544: 'RFC 2544',
  /** Multicast, 224.0.0.0/4. */
  RFC5771: 'RFC 5771',
  /** Reserved for future use, 240.0.0.0/4. */
  RFC1112: 'RFC 1112',
  /** Zero Disruption and Seamless Renumbering. Subnet-zero and all-ones are permitted. */
  RFC7600: 'RFC 7600',
  /** Guidelines on Operational Security. Supports the app's "no guarantees" posture. */
  RFC2050: 'RFC 2050',
  /** IEEE 802.1Q — VLAN tagging. Valid VID range 1-4094. */
  IEEE8021Q: 'IEEE 802.1Q',
  /** IEEE 802.1D — Bridging and STP. Each VLAN is one broadcast domain. */
  IEEE8021D: 'IEEE 802.1D',
  /** NIST SP 800-207 — Zero Trust Architecture. No implicit trust from network location. */
  NIST800207: 'NIST SP 800-207',
  /** NIST SP 800-41 — Firewalls and Firewall Policy. Segmentation and DMZ topology. */
  NIST80041: 'NIST SP 800-41',
  /** CIS Benchmarks — host firewall baselines. */
  CIS: 'CIS Benchmarks',
} as const;

export type StandardRefKey = keyof typeof STANDARD_REFS;

/** A classification of an address or network against the IANA registries. */
export interface RangeClassification {
  readonly kind: ReservedRangeKind;
  /** Human label for the UI badge, e.g. "Private-Use". */
  readonly label: string;
  /** The published reference backing this classification. */
  readonly citation: string;
  /** Actionable guidance. `null` for ordinary public space. */
  readonly guidance: string | null;
}

/**
 * Ordered classification table.
 *
 * ORDER MATTERS: ranges are tested in sequence and the first match wins, so more
 * specific entries must precede broader ones. `benchmark` (198.18.0.0/15) and
 * `ietf_protocol_assignments` (192.0.0.0/24) are carved out of ranges that would
 * otherwise shadow them, and `documentation` ranges are listed individually
 * because they are disjoint rather than contiguous.
 */
export const ADDRESS_SPACE_TABLE: readonly RangeClassification[] = Object.freeze([
  {
    kind: 'this_network',
    label: 'This Network',
    citation: STANDARD_REFS.RFC1912,
    guidance: '0.0.0.0/8 is "this network" and is not a usable host address.',
  },
  {
    kind: 'loopback',
    label: 'Loopback',
    citation: STANDARD_REFS.RFC1122,
    guidance: '127.0.0.0/8 is internal to a host and must never be routed or assigned to a subnet.',
  },
  {
    kind: 'private',
    label: 'Private-Use',
    citation: STANDARD_REFS.RFC1918,
    guidance:
      'RFC 1918 space is not routable on the public internet. Intended for internal networks.',
  },
  {
    kind: 'cgnat',
    label: 'Shared Address Space (CGNAT)',
    citation: STANDARD_REFS.RFC6598,
    guidance:
      '100.64.0.0/10 is carrier-grade NAT space, NOT private space. Avoid for internal addressing.',
  },
  {
    kind: 'link_local',
    label: 'Link-Local (APIPA)',
    citation: STANDARD_REFS.RFC3927,
    guidance:
      '169.254.0.0/16 self-assigns when no DHCP server responds. Almost always a misconfiguration.',
  },
  {
    kind: 'ietf_protocol_assignments',
    label: 'IETF Protocol Assignments',
    citation: STANDARD_REFS.RFC6890,
    guidance: '192.0.0.0/24 is reserved for IETF protocol assignments. Not for general use.',
  },
  {
    kind: 'documentation',
    label: 'Documentation (TEST-NET)',
    citation: STANDARD_REFS.RFC5737,
    guidance: 'Reserved for documentation. Valid for labs and examples, never for production.',
  },
  {
    kind: 'benchmark',
    label: 'Benchmarking',
    citation: STANDARD_REFS.RFC2544,
    guidance: '198.18.0.0/15 is reserved for network benchmarking. Not for production use.',
  },
  {
    kind: 'multicast',
    label: 'Multicast',
    citation: STANDARD_REFS.RFC5771,
    guidance: '224.0.0.0/4 is multicast. It cannot be assigned to a unicast subnet.',
  },
  {
    kind: 'reserved',
    label: 'Reserved for Future Use',
    citation: STANDARD_REFS.RFC1112,
    guidance: '240.0.0.0/4 is reserved and must not be allocated.',
  },
  {
    kind: 'public',
    label: 'Public (Globally Routable)',
    citation: STANDARD_REFS.RFC6890,
    guidance: null,
  },
]);

/**
 * The CIDR blocks that back each non-public classification.
 *
 * Stored as `[startInteger, endInteger]` inclusive pairs so the engine can test
 * membership with two unsigned comparisons — no string parsing, no per-packet
 * allocation.
 *
 * NOTE on 172.16.0.0/12: this is a /12, NOT a /16. It covers 172.16.0.0 through
 * 172.31.255.255 — sixteen contiguous /16 blocks. 172.32.0.0 is PUBLIC. This is
 * the most common addressing mistake in practice and is pinned by a dedicated
 * test in the engine suite.
 */
export const RESERVED_BLOCKS: Readonly<
  Record<Exclude<ReservedRangeKind, 'public'>, readonly (readonly [number, number])[]>
> = Object.freeze({
  this_network: Object.freeze([[0x00000000, 0x00ffffff]] as const), // 0.0.0.0/8
  private: Object.freeze([
    [0x0a000000, 0x0affffff], // 10.0.0.0/8
    [0xac100000, 0xac1fffff], // 172.16.0.0/12  <-- 172.16 - 172.31
    [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  ] as const),
  loopback: Object.freeze([[0x7f000000, 0x7fffffff]] as const), // 127.0.0.0/8
  link_local: Object.freeze([[0xa9fe0000, 0xa9feffff]] as const), // 169.254.0.0/16
  cgnat: Object.freeze([[0x64400000, 0x647fffff]] as const), // 100.64.0.0/10
  ietf_protocol_assignments: Object.freeze([[0xc0000000, 0xc00000ff]] as const), // 192.0.0.0/24
  documentation: Object.freeze([
    [0xc0000200, 0xc00002ff], // 192.0.2.0/24    TEST-NET-1
    [0xc6336400, 0xc63364ff], // 198.51.100.0/24 TEST-NET-2
    [0xcb007100, 0xcb0071ff], // 203.0.113.0/24  TEST-NET-3
  ] as const),
  benchmark: Object.freeze([[0xc6120000, 0xc613ffff]] as const), // 198.18.0.0/15
  multicast: Object.freeze([[0xe0000000, 0xefffffff]] as const), // 224.0.0.0/4
  reserved: Object.freeze([[0xf0000000, 0xffffffff]] as const), // 240.0.0.0/4
});

/** Quick lookup from classification kind to its full metadata. */
export const CLASSIFICATION_BY_KIND: Readonly<Record<ReservedRangeKind, RangeClassification>> =
  Object.freeze(
    Object.fromEntries(ADDRESS_SPACE_TABLE.map((entry) => [entry.kind, entry])) as Record<
      ReservedRangeKind,
      RangeClassification
    >,
  );

/**
 * IEEE 802.1Q VLAN ID bounds.
 *
 * VID 0 is the deprecated "priority tagged" VID (withdrawn in 802.1Q-2011) and
 * VID 4095 is reserved. The allocatable range is therefore 1-4094 inclusive.
 */
export const VLAN = Object.freeze({
  MIN: 1,
  MAX: 4094,
  /** Reserved by IEEE 802.1Q. */
  RESERVED_IDS: Object.freeze([0, 4095] as const),
  CITATION: STANDARD_REFS.IEEE8021Q,
});

/**
 * Broadest broadcast domain considered good practice for a routed access
 * segment. A /24 is the conventional ceiling; larger subnets become broadcast
 * and address-space problems rather than efficiency gains.
 */
export const BROADCAST_DOMAIN = Object.freeze({
  MAX_PREFIX: 24,
  /** Management segments are conventionally /28 or smaller. */
  MGMT_MAX_USABLE_HOSTS: 14,
  /** Below this utilisation, a subnet is reported as wasteful. */
  UTILISATION_FLOOR_PERCENT: 25,
  CITATION: STANDARD_REFS.IEEE8021D,
});

/**
 * The app's security posture, stated plainly.
 *
 * NetArchitect performs STATIC DESIGN REVIEW of a plan the user has typed in.
 * It does not scan, probe, test, audit or guarantee the security of any network,
 * and it never connects to one. This is required by RFC 2050's principle of
 * assuming no security, and it is the honest description of what the auditor
 * actually does.
 */
export const SECURITY_DISCLAIMER =
  'This auditor performs static design checks on the plan you have entered. ' +
  'It does not scan, test, or guarantee the security of any network. ' +
  'Treat its output as a review checklist, not an assessment.';

/** Banner prepended to every generated configuration template. */
export const CONFIG_TEMPLATE_BANNER_LINES: readonly string[] = Object.freeze([
  'NetArchitect CONFIGURATION TEMPLATE - NOT A DEPLOYED CONFIG',
  'Generated offline. NetArchitect never connects to or configures a network.',
  'REVIEW EVERY LINE BEFORE APPLYING. Adjust interface names, MTU, and',
  'routing to match your actual platform and design.',
]);

export const CONFIG_TEMPLATE_BANNER: string = CONFIG_TEMPLATE_BANNER_LINES.join('\n');
