/**
 * NetArchitect Security Auditor.
 *
 * PURE MODULE. No React, no React Native, no Expo.
 *
 * A rule-based design review that is honest about its limits. Each rule is a
 * named function in a RULES registry so severity and copy live in one readable
 * table. Every issue carries title, problem, whyItMatters, remediation,
 * affectedSubnetIds, and a citation to the standard that backs the rule.
 *
 * The auditor performs STATIC DESIGN REVIEW only. It does not scan, test, or
 * guarantee the security of any network.
 */

import type { NetworkPlan, PlannedSubnet, SecurityIssue, Severity } from '../types/network';
import {
  calculateSubnet,
  calculateNetworkAddress,
  calculateBroadcastAddress,
  classifyAddressSpace,
  detectOverlap,
  integerToIPv4,
  isNetworkBoundary,
  parseCidr,
  parseIPv4,
} from './ip-engine';
import { BROADCAST_DOMAIN, RESERVED_BLOCKS, STANDARD_REFS, VLAN } from './standards';
import { ROLE_DEFINITION_BY_ROLE } from './roles';

/* ------------------------------------------------------------------ *
 * Rule registry
 * ------------------------------------------------------------------ */

/** A single audit rule. */
interface AuditRule {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly check: (plan: NetworkPlan) => SecurityIssue[];
}

/**
 * All audit rules, in order.
 *
 * Each rule is a pure function that takes a plan and returns zero or more
 * issues. The rule's severity, title, and citation are defined here so the
 * copy lives in one readable table rather than being scattered across
 * conditional logic.
 */
const RULES: readonly AuditRule[] = Object.freeze([
  {
    id: 'SEC-001',
    severity: 'critical',
    title: 'Overlapping subnets',
    check: checkOverlappingSubnets,
  },
  {
    id: 'SEC-002',
    severity: 'critical',
    title: 'Duplicate VLAN IDs',
    check: checkDuplicateVlanIds,
  },
  {
    id: 'SEC-003',
    severity: 'critical',
    title: 'Subnet not aligned to its network boundary',
    check: checkSubnetAlignment,
  },
  {
    id: 'SEC-004',
    severity: 'critical',
    title: 'Gateway outside its subnet',
    check: checkGatewayInsideSubnet,
  },
  {
    id: 'SEC-005',
    severity: 'high',
    title: 'Gateway equals network or broadcast address',
    check: checkGatewayNotNetworkOrBroadcast,
  },
  {
    id: 'SEC-006',
    severity: 'high',
    title: 'VLAN ID out of range',
    check: checkVlanIdRange,
  },
  {
    id: 'SEC-007',
    severity: 'high',
    title: 'Guest shares a subnet with a trusted LAN',
    check: checkGuestIsolation,
  },
  {
    id: 'SEC-008',
    severity: 'high',
    title: 'IoT not segmented from LAN or Guest',
    check: checkIotSegmentation,
  },
  {
    id: 'SEC-009',
    severity: 'medium',
    title: 'Management subnet oversized',
    check: checkManagementSize,
  },
  {
    id: 'SEC-010',
    severity: 'medium',
    title: 'Excessive broadcast domain',
    check: checkBroadcastDomainSize,
  },
  {
    id: 'SEC-011',
    severity: 'medium',
    title: 'Subnet extends outside the parent CIDR',
    check: checkSubnetInsideParent,
  },
  {
    id: 'SEC-012',
    severity: 'medium',
    title: 'Poor address utilization',
    check: checkPoorUtilization,
  },
  {
    id: 'SEC-013',
    severity: 'medium',
    title: 'DMZ shares a subnet with or is nested inside Servers or LAN',
    check: checkDmzIsolation,
  },
  {
    id: 'SEC-014',
    severity: 'info',
    title: 'Missing VLAN ID on a role that needs segmentation',
    check: checkMissingVlanId,
  },
  {
    id: 'SEC-015',
    severity: 'info',
    title: 'Reserved address space in use',
    check: checkReservedSpace,
  },
  {
    id: 'SEC-016',
    severity: 'info',
    title: 'Public address space with no NAT note',
    check: checkPublicSpaceWithoutNat,
  },
  {
    id: 'SEC-017',
    severity: 'info',
    title: 'Address space hygiene',
    check: checkAddressSpaceHygiene,
  },
]);

/* ------------------------------------------------------------------ *
 * Rule implementations
 * ------------------------------------------------------------------ */

/** SEC-001: Overlapping subnets. */
function checkOverlappingSubnets(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const subnets = plan.subnets;

  for (let i = 0; i < subnets.length; i++) {
    for (let j = i + 1; j < subnets.length; j++) {
      const a = subnets[i];
      const b = subnets[j];
      if (!a || !b) continue;

      try {
        const cidrA = parseCidr(a.cidr);
        const cidrB = parseCidr(b.cidr);
        if (detectOverlap(cidrA, cidrB)) {
          issues.push(
            createIssue({
              ruleId: 'SEC-001',
              severity: 'critical',
              title: 'Overlapping subnets',
              problem: `${a.name} (${a.cidr}) overlaps with ${b.name} (${b.cidr}).`,
              whyItMatters:
                'Overlapping subnets cause routing ambiguity and intermittent connectivity. Packets may reach the wrong destination or be dropped entirely.',
              remediation:
                'Reassign one of the subnets to a non-overlapping range. Use the VLSM allocator to find a conflict-free layout.',
              citation: STANDARD_REFS.RFC4632,
              affectedSubnetIds: [a.id, b.id],
            }),
          );
        }
      } catch {
        // Invalid CIDR is caught by SEC-003; skip here.
      }
    }
  }

  return issues;
}

/** SEC-002: Duplicate VLAN IDs. */
function checkDuplicateVlanIds(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const vlanMap = new Map<number, PlannedSubnet[]>();

  for (const subnet of plan.subnets) {
    if (subnet.vlanId !== undefined) {
      const existing = vlanMap.get(subnet.vlanId) ?? [];
      existing.push(subnet);
      vlanMap.set(subnet.vlanId, existing);
    }
  }

  for (const [vlanId, subnets] of vlanMap) {
    if (subnets.length > 1) {
      const names = subnets.map((s) => `${s.name} (${s.cidr})`).join(', ');
      issues.push(
        createIssue({
          ruleId: 'SEC-002',
          severity: 'critical',
          title: 'Duplicate VLAN IDs',
          problem: `VLAN ${vlanId} is assigned to multiple subnets: ${names}.`,
          whyItMatters:
            'Each VLAN is a separate broadcast domain. Two subnets sharing a VLAN ID can leak traffic between them and cause switching loops.',
          remediation:
            'Assign a unique VLAN ID to each subnet. Use the auto-suggest feature in the planner to find the next free VLAN.',
          citation: STANDARD_REFS.IEEE8021Q,
          affectedSubnetIds: subnets.map((s) => s.id),
        }),
      );
    }
  }

  return issues;
}

/** SEC-003: Subnet not aligned to its network boundary. */
function checkSubnetAlignment(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    try {
      const cidr = parseCidr(subnet.cidr);
      if (!isNetworkBoundary(cidr)) {
        const networkAddr = calculateNetworkAddress(cidr.ip, cidr.prefix);
        issues.push(
          createIssue({
            ruleId: 'SEC-003',
            severity: 'critical',
            title: 'Subnet not aligned to its network boundary',
            problem: `${subnet.name} is defined as ${subnet.cidr}, which is not a network boundary.`,
            whyItMatters:
              'A subnet must start on its network boundary for routing to work correctly. A misaligned subnet causes routing failures and address conflicts.',
            remediation: `Use ${integerToIPv4(networkAddr)}/${cidr.prefix} instead.`,
            citation: STANDARD_REFS.RFC4632,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Unparseable CIDR — report as misaligned since it cannot be valid.
      issues.push(
        createIssue({
          ruleId: 'SEC-003',
          severity: 'critical',
          title: 'Subnet not aligned to its network boundary',
          problem: `${subnet.name} has an invalid CIDR: ${subnet.cidr}.`,
          whyItMatters:
            'An invalid CIDR cannot be routed. The subnet definition must be a valid network boundary.',
          remediation: 'Enter a valid CIDR in the form x.x.x.x/n where x.x.x.x is a network address.',
          citation: STANDARD_REFS.RFC4632,
          affectedSubnetIds: [subnet.id],
        }),
      );
    }
  }

  return issues;
}

/** SEC-004: Gateway outside its subnet. */
function checkGatewayInsideSubnet(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    if (!subnet.gateway) continue;

    try {
      const cidr = parseCidr(subnet.cidr);
      const gatewayIp = parseIPv4(subnet.gateway);
      const networkAddr = calculateNetworkAddress(cidr.ip, cidr.prefix);
      const broadcastAddr = calculateBroadcastAddress(cidr.ip, cidr.prefix);

      const gatewayInSubnet =
        gatewayIp >= networkAddr && gatewayIp <= broadcastAddr;

      if (!gatewayInSubnet) {
        issues.push(
          createIssue({
            ruleId: 'SEC-004',
            severity: 'critical',
            title: 'Gateway outside its subnet',
            problem: `Gateway ${subnet.gateway} is not inside ${subnet.cidr}.`,
            whyItMatters:
              'A gateway must be an address within its own subnet. Hosts cannot reach a gateway that is outside their local network.',
            remediation: `Set the gateway to an address between ${integerToIPv4(networkAddr)} and ${integerToIPv4(broadcastAddr)}.`,
            citation: STANDARD_REFS.RFC4632,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Invalid gateway or CIDR — skip; other rules catch parse errors.
    }
  }

  return issues;
}

/** SEC-005: Gateway equals network or broadcast address. */
function checkGatewayNotNetworkOrBroadcast(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    if (!subnet.gateway) continue;

    try {
      const cidr = parseCidr(subnet.cidr);
      const gatewayIp = parseIPv4(subnet.gateway);
      const networkAddr = calculateNetworkAddress(cidr.ip, cidr.prefix);
      const broadcastAddr = calculateBroadcastAddress(cidr.ip, cidr.prefix);

      // /31 and /32 are special: all addresses are usable.
      if (cidr.prefix >= 31) continue;

      if (gatewayIp === networkAddr) {
        issues.push(
          createIssue({
            ruleId: 'SEC-005',
            severity: 'high',
            title: 'Gateway equals network address',
            problem: `Gateway ${subnet.gateway} is the network address of ${subnet.cidr}.`,
            whyItMatters:
              'The network address identifies the subnet itself and cannot be assigned to a host. Using it as a gateway causes address conflicts.',
            remediation: `Use ${integerToIPv4(networkAddr + 1)} (the first usable host) as the gateway.`,
            citation: STANDARD_REFS.RFC4632,
            affectedSubnetIds: [subnet.id],
          }),
        );
      } else if (gatewayIp === broadcastAddr) {
        issues.push(
          createIssue({
            ruleId: 'SEC-005',
            severity: 'high',
            title: 'Gateway equals broadcast address',
            problem: `Gateway ${subnet.gateway} is the broadcast address of ${subnet.cidr}.`,
            whyItMatters:
              'The broadcast address is reserved for broadcast traffic. Routers must not forward datagrams with a broadcast destination.',
            remediation: `Use ${integerToIPv4(broadcastAddr - 1)} (the last usable host) as the gateway.`,
            citation: STANDARD_REFS.RFC1812,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Invalid gateway or CIDR — skip.
    }
  }

  return issues;
}

/** SEC-006: VLAN ID out of 1-4094. */
function checkVlanIdRange(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    if (subnet.vlanId === undefined) continue;

    if (subnet.vlanId < VLAN.MIN || subnet.vlanId > VLAN.MAX) {
      issues.push(
        createIssue({
          ruleId: 'SEC-006',
          severity: 'high',
          title: 'VLAN ID out of range',
          problem: `${subnet.name} has VLAN ID ${subnet.vlanId}, which is outside the valid range of 1-4094.`,
          whyItMatters:
            'VLAN IDs 0 and 4095 are reserved by IEEE 802.1Q. An out-of-range VLAN ID will be rejected by switches or cause undefined behavior.',
          remediation: 'Use a VLAN ID between 1 and 4094 inclusive.',
          citation: STANDARD_REFS.IEEE8021Q,
          affectedSubnetIds: [subnet.id],
        }),
      );
    }
  }

  return issues;
}

/** SEC-007: Guest shares a subnet with a trusted LAN. */
function checkGuestIsolation(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const guestSubnets = plan.subnets.filter((s) => s.role === 'GUEST');
  const trustedSubnets = plan.subnets.filter(
    (s) => s.role === 'LAN' || s.role === 'SERVERS' || s.role === 'MANAGEMENT',
  );

  for (const guest of guestSubnets) {
    for (const trusted of trustedSubnets) {
      if (guest.id === trusted.id) continue;
      // Same VLAN means same broadcast domain.
      if (guest.vlanId !== undefined && guest.vlanId === trusted.vlanId) {
        issues.push(
          createIssue({
            ruleId: 'SEC-007',
            severity: 'high',
            title: 'Guest shares a subnet with a trusted LAN',
            problem: `Guest subnet ${guest.name} shares VLAN ${guest.vlanId} with ${trusted.name}.`,
            whyItMatters:
              'Guest traffic should reach the internet and nothing else. Sharing a broadcast domain with trusted networks allows lateral movement from compromised guest devices.',
            remediation:
              'Move the guest network to its own VLAN and subnet. Add a deny-any internal rule on the guest gateway.',
            citation: STANDARD_REFS.NIST800207,
            affectedSubnetIds: [guest.id, trusted.id],
          }),
        );
      }
    }
  }

  return issues;
}

/** SEC-008: IoT not segmented from LAN/Guest. */
function checkIotSegmentation(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const iotSubnets = plan.subnets.filter((s) => s.role === 'IOT');
  const userSubnets = plan.subnets.filter((s) => s.role === 'LAN' || s.role === 'GUEST');

  for (const iot of iotSubnets) {
    for (const user of userSubnets) {
      if (iot.id === user.id) continue;
      if (iot.vlanId !== undefined && iot.vlanId === user.vlanId) {
        issues.push(
          createIssue({
            ruleId: 'SEC-008',
            severity: 'high',
            title: 'IoT not segmented from LAN or Guest',
            problem: `IoT subnet ${iot.name} shares VLAN ${iot.vlanId} with ${user.name}.`,
            whyItMatters:
              'IoT devices are frequently unpatched and ship with default credentials. A compromised device on the same broadcast domain as user networks is a lateral-movement starting point.',
            remediation:
              'Place IoT devices on their own VLAN and subnet. Add firewall rules to prevent IoT-initiated traffic to user networks.',
            citation: STANDARD_REFS.NIST800207,
            affectedSubnetIds: [iot.id, user.id],
          }),
        );
      }
    }
  }

  return issues;
}

/** SEC-009: Management subnet oversized. */
function checkManagementSize(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    if (subnet.role !== 'MANAGEMENT') continue;

    try {
      const cidr = parseCidr(subnet.cidr);
      const info = calculateSubnet(cidr.ip, cidr.prefix);

      if (info.usableHosts > BROADCAST_DOMAIN.MGMT_MAX_USABLE_HOSTS) {
        issues.push(
          createIssue({
            ruleId: 'SEC-009',
            severity: 'medium',
            title: 'Management subnet oversized',
            problem: `Management subnet ${subnet.name} has ${info.usableHosts} usable addresses.`,
            whyItMatters:
              'Management interfaces should be few and tightly controlled. An oversized management subnet expands the attack surface and makes access control harder to enforce.',
            remediation: `Use a /28 or smaller (up to ${BROADCAST_DOMAIN.MGMT_MAX_USABLE_HOSTS} usable addresses) for the management segment.`,
            citation: STANDARD_REFS.NIST800207,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Invalid CIDR — skip.
    }
  }

  return issues;
}

/** SEC-010: Excessive broadcast domain. */
function checkBroadcastDomainSize(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    try {
      const cidr = parseCidr(subnet.cidr);

      if (cidr.prefix <= BROADCAST_DOMAIN.MAX_PREFIX) {
        const info = calculateSubnet(cidr.ip, cidr.prefix);
        issues.push(
          createIssue({
            ruleId: 'SEC-010',
            severity: 'medium',
            title: 'Excessive broadcast domain',
            problem: `${subnet.name} is a /${cidr.prefix} with ${info.usableHosts} usable addresses.`,
            whyItMatters:
              'A /24 is the practical ceiling for a broadcast domain. Larger subnets cause broadcast traffic to degrade performance and make troubleshooting difficult.',
            remediation:
              'Segment the network into /24 or smaller subnets. Use VLANs to separate broadcast domains.',
            citation: STANDARD_REFS.IEEE8021D,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Invalid CIDR — skip.
    }
  }

  return issues;
}

/** SEC-011: Subnet extends outside the parent CIDR. */
function checkSubnetInsideParent(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  let parentCidr: ReturnType<typeof parseCidr>;
  try {
    parentCidr = parseCidr(plan.parentCidr);
  } catch {
    // Invalid parent — skip this rule.
    return issues;
  }

  const parentNetwork = calculateNetworkAddress(parentCidr.ip, parentCidr.prefix);
  const parentBroadcast = calculateBroadcastAddress(parentCidr.ip, parentCidr.prefix);

  for (const subnet of plan.subnets) {
    try {
      const cidr = parseCidr(subnet.cidr);
      const subnetNetwork = calculateNetworkAddress(cidr.ip, cidr.prefix);
      const subnetBroadcast = calculateBroadcastAddress(cidr.ip, cidr.prefix);

      if (subnetNetwork < parentNetwork || subnetBroadcast > parentBroadcast) {
        issues.push(
          createIssue({
            ruleId: 'SEC-011',
            severity: 'medium',
            title: 'Subnet extends outside the parent CIDR',
            problem: `${subnet.name} (${subnet.cidr}) extends outside the parent network ${plan.parentCidr}.`,
            whyItMatters:
              'Subnets must be contained within the parent network. A subnet that extends outside causes routing conflicts and address space fragmentation.',
            remediation: `Resize the subnet to fit within ${plan.parentCidr}, or enlarge the parent network.`,
            citation: STANDARD_REFS.RFC4632,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Invalid CIDR — skip.
    }
  }

  return issues;
}

/** SEC-012: Poor utilization. */
function checkPoorUtilization(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    try {
      const cidr = parseCidr(subnet.cidr);
      const info = calculateSubnet(cidr.ip, cidr.prefix);

      // Only flag /25 and smaller (prefix >= 25).
      if (cidr.prefix < 25) continue;
      if (subnet.requestedHosts <= 0) continue;

      const utilization = (subnet.requestedHosts / info.usableHosts) * 100;

      if (utilization < BROADCAST_DOMAIN.UTILISATION_FLOOR_PERCENT) {
        issues.push(
          createIssue({
            ruleId: 'SEC-012',
            severity: 'medium',
            title: 'Poor address utilization',
            problem: `${subnet.name} uses ${subnet.requestedHosts} of ${info.usableHosts} addresses (${utilization.toFixed(1)}%).`,
            whyItMatters:
              'Address space is finite. A subnet that is mostly unused wastes addresses that could be allocated to other segments.',
            remediation:
              'Resize the subnet to better match the requested host count, or consolidate multiple small subnets into one.',
            citation: STANDARD_REFS.RFC4632,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Invalid CIDR — skip.
    }
  }

  return issues;
}

/** SEC-013: DMZ shares a subnet with or is nested inside Servers/LAN. */
function checkDmzIsolation(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const dmzSubnets = plan.subnets.filter((s) => s.role === 'DMZ');
  const internalSubnets = plan.subnets.filter(
    (s) => s.role === 'SERVERS' || s.role === 'LAN' || s.role === 'MANAGEMENT',
  );

  for (const dmz of dmzSubnets) {
    for (const internal of internalSubnets) {
      if (dmz.id === internal.id) continue;

      // Check for VLAN sharing.
      if (dmz.vlanId !== undefined && dmz.vlanId === internal.vlanId) {
        issues.push(
          createIssue({
            ruleId: 'SEC-013',
            severity: 'medium',
            title: 'DMZ shares a subnet with internal network',
            problem: `DMZ subnet ${dmz.name} shares VLAN ${dmz.vlanId} with ${internal.name}.`,
            whyItMatters:
              'The DMZ must be isolated from internal networks. A compromised DMZ host on the same broadcast domain as internal servers is a direct path for lateral movement.',
            remediation:
              'Place the DMZ on its own VLAN and subnet. Add firewall rules to permit only specific inbound traffic from the internet and deny all DMZ-initiated connections to internal networks.',
            citation: STANDARD_REFS.NIST80041,
            affectedSubnetIds: [dmz.id, internal.id],
          }),
        );
      }

      // Check for nesting (DMZ inside internal or vice versa).
      try {
        const dmzCidr = parseCidr(dmz.cidr);
        const internalCidr = parseCidr(internal.cidr);
        const dmzNetwork = calculateNetworkAddress(dmzCidr.ip, dmzCidr.prefix);
        const dmzBroadcast = calculateBroadcastAddress(dmzCidr.ip, dmzCidr.prefix);
        const internalNetwork = calculateNetworkAddress(internalCidr.ip, internalCidr.prefix);
        const internalBroadcast = calculateBroadcastAddress(internalCidr.ip, internalCidr.prefix);

        const dmzInsideInternal =
          dmzNetwork >= internalNetwork && dmzBroadcast <= internalBroadcast;
        const internalInsideDmz =
          internalNetwork >= dmzNetwork && internalBroadcast <= dmzBroadcast;

        if (dmzInsideInternal || internalInsideDmz) {
          issues.push(
            createIssue({
              ruleId: 'SEC-013',
              severity: 'medium',
              title: 'DMZ is nested inside an internal network',
              problem: `DMZ subnet ${dmz.name} (${dmz.cidr}) is nested inside ${internal.name} (${internal.cidr}).`,
              whyItMatters:
                'A DMZ nested inside an internal network provides no isolation. An attacker who compromises a DMZ host is already inside the trusted perimeter.',
              remediation:
                'Move the DMZ to a separate subnet that is routed through a firewall, not nested inside an internal network.',
              citation: STANDARD_REFS.NIST80041,
              affectedSubnetIds: [dmz.id, internal.id],
            }),
          );
        }
      } catch {
        // Invalid CIDR — skip.
      }
    }
  }

  return issues;
}

/** SEC-014: Missing VLAN ID on a role that needs segmentation. */
function checkMissingVlanId(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    const roleDef = ROLE_DEFINITION_BY_ROLE[subnet.role];
    if (roleDef.expectsVlan && subnet.vlanId === undefined) {
      issues.push(
        createIssue({
          ruleId: 'SEC-014',
          severity: 'info',
          title: 'Missing VLAN ID',
          problem: `${subnet.name} (${subnet.role}) has no VLAN ID assigned.`,
          whyItMatters:
            'VLAN segmentation is the primary mechanism for separating broadcast domains. A role that expects segmentation but has no VLAN ID may be unintentionally merged with other traffic.',
          remediation: `Assign a VLAN ID between ${VLAN.MIN} and ${VLAN.MAX} to this subnet.`,
          citation: STANDARD_REFS.IEEE8021Q,
          affectedSubnetIds: [subnet.id],
        }),
      );
    }
  }

  return issues;
}

/** SEC-015: Reserved space in use. */
function checkReservedSpace(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    try {
      const cidr = parseCidr(subnet.cidr);
      const classification = classifyAddressSpace(cidr.ip);

      if (classification !== 'public' && classification !== 'private') {
        const reservedKinds: readonly (keyof typeof RESERVED_BLOCKS)[] = [
          'this_network',
          'loopback',
          'link_local',
          'multicast',
          'reserved',
        ];

        if (reservedKinds.includes(classification as keyof typeof RESERVED_BLOCKS)) {
          issues.push(
            createIssue({
              ruleId: 'SEC-015',
              severity: 'info',
              title: 'Reserved address space in use',
              problem: `${subnet.name} (${subnet.cidr}) is in reserved address space.`,
              whyItMatters:
                'Reserved address space has special meaning and may not be routable or assignable. Using it can cause unexpected behavior.',
              remediation:
                'Use RFC 1918 private address space (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) for internal networks.',
              citation: STANDARD_REFS.RFC6890,
              affectedSubnetIds: [subnet.id],
            }),
          );
        }
      }
    } catch {
      // Invalid CIDR — skip.
    }
  }

  return issues;
}

/** SEC-016: Public address space with no NAT note. */
function checkPublicSpaceWithoutNat(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  for (const subnet of plan.subnets) {
    try {
      const cidr = parseCidr(subnet.cidr);
      const classification = classifyAddressSpace(cidr.ip);

      if (classification === 'public') {
        issues.push(
          createIssue({
            ruleId: 'SEC-016',
            severity: 'info',
            title: 'Public address space in use',
            problem: `${subnet.name} (${subnet.cidr}) uses public address space.`,
            whyItMatters:
              'Public addresses are globally routable and may be expensive or unavailable. Internal networks should use RFC 1918 private space with NAT at the perimeter.',
            remediation:
              'Consider using RFC 1918 private address space instead. If public addresses are required, ensure NAT is configured at the perimeter.',
            citation: STANDARD_REFS.RFC1918,
            affectedSubnetIds: [subnet.id],
          }),
        );
      }
    } catch {
      // Invalid CIDR — skip.
    }
  }

  return issues;
}

/** SEC-017: Address space hygiene. */
function checkAddressSpaceHygiene(plan: NetworkPlan): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  if (plan.subnets.length === 0) return issues;

  try {
    const parentCidr = parseCidr(plan.parentCidr);
    const parentInfo = calculateSubnet(parentCidr.ip, parentCidr.prefix);
    const totalAddresses = parentInfo.totalAddresses;

    let allocatedAddresses = 0;
    for (const subnet of plan.subnets) {
      try {
        const cidr = parseCidr(subnet.cidr);
        const info = calculateSubnet(cidr.ip, cidr.prefix);
        allocatedAddresses += info.totalAddresses;
      } catch {
        // Invalid CIDR — skip.
      }
    }

    const freeAddresses = totalAddresses - allocatedAddresses;
    const freePercent = (freeAddresses / totalAddresses) * 100;

    if (freePercent > 90 && plan.subnets.length > 0) {
      issues.push(
        createIssue({
          ruleId: 'SEC-017',
          severity: 'info',
          title: 'Address space mostly unused',
          problem: `${freePercent.toFixed(1)}% of ${plan.parentCidr} is unallocated.`,
          whyItMatters:
            'A parent network that is mostly unused may be oversized for the current plan. This wastes address space and may indicate a design that will be hard to extend.',
          remediation:
            'Consider using a smaller parent network, or plan for future growth by reserving space for additional subnets.',
          citation: STANDARD_REFS.RFC4632,
          affectedSubnetIds: plan.subnets.map((s) => s.id),
        }),
      );
    }
  } catch {
    // Invalid parent CIDR — skip.
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Audit a network plan for security and design issues.
 *
 * Returns a list of findings, each with a rule ID, severity, title, problem
 * description, engineering consequence, remediation, citation, and affected
 * subnet IDs. The list is empty for a clean plan.
 *
 * This function is pure: it does not modify the plan, perform I/O, or throw
 * on invalid input. Invalid subnets are reported as findings rather than
 * causing the audit to fail.
 */
export function auditPlan(plan: NetworkPlan): SecurityIssue[] {
  const allIssues: SecurityIssue[] = [];

  for (const rule of RULES) {
    const issues = rule.check(plan);
    allIssues.push(...issues);
  }

  // Sort by severity (critical first), then by rule ID for stable ordering.
  return allIssues.sort((a, b) => {
    const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, info: 3 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return a.ruleId.localeCompare(b.ruleId);
  });
}

/** The rule registry, exposed for testing and UI display. */
export const AUDIT_RULES = RULES;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Create a SecurityIssue with consistent structure. */
function createIssue(params: {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly title: string;
  readonly problem: string;
  readonly whyItMatters: string;
  readonly remediation: string;
  readonly citation: string;
  readonly affectedSubnetIds: readonly string[];
}): SecurityIssue {
  return Object.freeze({
    ruleId: params.ruleId,
    severity: params.severity,
    title: params.title,
    problem: params.problem,
    whyItMatters: params.whyItMatters,
    remediation: params.remediation,
    citation: params.citation,
    affectedSubnetIds: Object.freeze([...params.affectedSubnetIds]),
  });
}
