/**
 * Security Auditor Tests
 *
 * Every rule has a positive test (the rule fires) and a negative test (the
 * rule does not fire on a clean plan). A clean plan must produce zero issues.
 */

import { describe, expect, it } from 'vitest';
import { auditPlan } from '@/core/security-auditor';
import type { NetworkPlan, PlannedSubnet } from '@/types/network';

/* ------------------------------------------------------------------ *
 * Test fixtures
 * ------------------------------------------------------------------ */

function makeSubnet(overrides: Partial<PlannedSubnet> = {}): PlannedSubnet {
  return {
    id: 'subnet-1',
    name: 'Test Subnet',
    role: 'LAN',
    cidr: '192.168.1.0/24',
    gateway: '192.168.1.1',
    requestedHosts: 100,
    sortOrder: 0,
    ...overrides,
  };
}

/** Create a subnet without a VLAN ID (for exactOptionalPropertyTypes). */
function makeSubnetNoVlan(overrides: Partial<PlannedSubnet> = {}): PlannedSubnet {
  const { vlanId: _vlanId, ...rest } = overrides;
  return makeSubnet(rest);
}

function makePlan(overrides: Partial<NetworkPlan> = {}): NetworkPlan {
  return {
    id: 'plan-1',
    name: 'Test Plan',
    description: '',
    parentCidr: '192.168.0.0/16',
    profile: 'custom',
    subnets: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** A clean plan that should produce zero issues. */
function cleanPlan(): NetworkPlan {
  return makePlan({
    parentCidr: '192.168.0.0/22',
    subnets: [
      makeSubnet({
        id: 'lan-1',
        name: 'Corporate LAN',
        role: 'LAN',
        cidr: '192.168.0.0/25',
        vlanId: 10,
        gateway: '192.168.0.1',
        requestedHosts: 100,
      }),
      makeSubnet({
        id: 'servers-1',
        name: 'Servers',
        role: 'SERVERS',
        cidr: '192.168.0.128/25',
        vlanId: 20,
        gateway: '192.168.0.129',
        requestedHosts: 100,
      }),
      makeSubnet({
        id: 'mgmt-1',
        name: 'Management',
        role: 'MANAGEMENT',
        cidr: '192.168.1.0/28',
        vlanId: 30,
        gateway: '192.168.1.1',
        requestedHosts: 10,
      }),
      makeSubnet({
        id: 'guest-1',
        name: 'Guest WiFi',
        role: 'GUEST',
        cidr: '192.168.1.16/28',
        vlanId: 40,
        gateway: '192.168.1.17',
        requestedHosts: 10,
      }),
      makeSubnet({
        id: 'iot-1',
        name: 'IoT Devices',
        role: 'IOT',
        cidr: '192.168.1.32/28',
        vlanId: 50,
        gateway: '192.168.1.33',
        requestedHosts: 10,
      }),
      makeSubnet({
        id: 'dmz-1',
        name: 'DMZ',
        role: 'DMZ',
        cidr: '192.168.1.48/28',
        vlanId: 60,
        gateway: '192.168.1.49',
        requestedHosts: 10,
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Clean plan tests
 * ------------------------------------------------------------------ */

describe('auditPlan', () => {
  it('returns an empty array for a plan with no subnets', () => {
    const plan = makePlan({ subnets: [] });
    const issues = auditPlan(plan);
    expect(issues).toEqual([]);
  });

  it('returns an empty array for a clean plan', () => {
    const plan = cleanPlan();
    const issues = auditPlan(plan);
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-001: Overlapping subnets
 * ------------------------------------------------------------------ */

describe('SEC-001: Overlapping subnets', () => {
  it('detects overlapping subnets', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'a', name: 'Subnet A', cidr: '192.168.1.0/24' }),
        makeSubnet({ id: 'b', name: 'Subnet B', cidr: '192.168.1.128/25' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec001 = issues.filter((i) => i.ruleId === 'SEC-001');
    expect(sec001).toHaveLength(1);
    expect(sec001[0]?.severity).toBe('critical');
    expect(sec001[0]?.affectedSubnetIds).toContain('a');
    expect(sec001[0]?.affectedSubnetIds).toContain('b');
  });

  it('does not flag adjacent non-overlapping subnets', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'a', name: 'Subnet A', cidr: '192.168.1.0/25' }),
        makeSubnet({ id: 'b', name: 'Subnet B', cidr: '192.168.1.128/25' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec001 = issues.filter((i) => i.ruleId === 'SEC-001');
    expect(sec001).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-002: Duplicate VLAN IDs
 * ------------------------------------------------------------------ */

describe('SEC-002: Duplicate VLAN IDs', () => {
  it('detects duplicate VLAN IDs', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'a', name: 'Subnet A', vlanId: 10 }),
        makeSubnet({ id: 'b', name: 'Subnet B', vlanId: 10 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec002 = issues.filter((i) => i.ruleId === 'SEC-002');
    expect(sec002).toHaveLength(1);
    expect(sec002[0]?.severity).toBe('critical');
  });

  it('does not flag unique VLAN IDs', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'a', name: 'Subnet A', vlanId: 10 }),
        makeSubnet({ id: 'b', name: 'Subnet B', vlanId: 20 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec002 = issues.filter((i) => i.ruleId === 'SEC-002');
    expect(sec002).toHaveLength(0);
  });

  it('does not flag subnets without VLAN IDs', () => {
    const plan = makePlan({
      subnets: [
        makeSubnetNoVlan({ id: 'a', name: 'Subnet A' }),
        makeSubnetNoVlan({ id: 'b', name: 'Subnet B' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec002 = issues.filter((i) => i.ruleId === 'SEC-002');
    expect(sec002).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-003: Subnet not aligned to its network boundary
 * ------------------------------------------------------------------ */

describe('SEC-003: Subnet alignment', () => {
  it('detects a subnet not on its network boundary', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '192.168.1.50/24' })],
    });
    const issues = auditPlan(plan);
    const sec003 = issues.filter((i) => i.ruleId === 'SEC-003');
    expect(sec003).toHaveLength(1);
    expect(sec003[0]?.severity).toBe('critical');
  });

  it('does not flag a properly aligned subnet', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '192.168.1.0/24' })],
    });
    const issues = auditPlan(plan);
    const sec003 = issues.filter((i) => i.ruleId === 'SEC-003');
    expect(sec003).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-004: Gateway outside its subnet
 * ------------------------------------------------------------------ */

describe('SEC-004: Gateway outside subnet', () => {
  it('detects a gateway outside its subnet', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/24', gateway: '192.168.2.1' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec004 = issues.filter((i) => i.ruleId === 'SEC-004');
    expect(sec004).toHaveLength(1);
    expect(sec004[0]?.severity).toBe('critical');
  });

  it('does not flag a gateway inside its subnet', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/24', gateway: '192.168.1.1' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec004 = issues.filter((i) => i.ruleId === 'SEC-004');
    expect(sec004).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-005: Gateway equals network or broadcast address
 * ------------------------------------------------------------------ */

describe('SEC-005: Gateway equals network or broadcast', () => {
  it('detects gateway equal to network address', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/24', gateway: '192.168.1.0' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec005 = issues.filter((i) => i.ruleId === 'SEC-005');
    expect(sec005).toHaveLength(1);
    expect(sec005[0]?.severity).toBe('high');
  });

  it('detects gateway equal to broadcast address', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/24', gateway: '192.168.1.255' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec005 = issues.filter((i) => i.ruleId === 'SEC-005');
    expect(sec005).toHaveLength(1);
    expect(sec005[0]?.severity).toBe('high');
  });

  it('does not flag a valid gateway', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/24', gateway: '192.168.1.1' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec005 = issues.filter((i) => i.ruleId === 'SEC-005');
    expect(sec005).toHaveLength(0);
  });

  it('does not flag /31 or /32 subnets', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'p2p', cidr: '10.0.0.0/31', gateway: '10.0.0.0' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec005 = issues.filter((i) => i.ruleId === 'SEC-005');
    expect(sec005).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-006: VLAN ID out of range
 * ------------------------------------------------------------------ */

describe('SEC-006: VLAN ID range', () => {
  it('detects VLAN ID 0', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ vlanId: 0 })],
    });
    const issues = auditPlan(plan);
    const sec006 = issues.filter((i) => i.ruleId === 'SEC-006');
    expect(sec006).toHaveLength(1);
    expect(sec006[0]?.severity).toBe('high');
  });

  it('detects VLAN ID 4095', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ vlanId: 4095 })],
    });
    const issues = auditPlan(plan);
    const sec006 = issues.filter((i) => i.ruleId === 'SEC-006');
    expect(sec006).toHaveLength(1);
  });

  it('does not flag valid VLAN IDs', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ vlanId: 1 }), makeSubnet({ id: 'b', vlanId: 4094 })],
    });
    const issues = auditPlan(plan);
    const sec006 = issues.filter((i) => i.ruleId === 'SEC-006');
    expect(sec006).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-007: Guest shares a subnet with a trusted LAN
 * ------------------------------------------------------------------ */

describe('SEC-007: Guest isolation', () => {
  it('detects guest sharing VLAN with LAN', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'guest', name: 'Guest', role: 'GUEST', vlanId: 10 }),
        makeSubnet({ id: 'lan', name: 'LAN', role: 'LAN', vlanId: 10 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec007 = issues.filter((i) => i.ruleId === 'SEC-007');
    expect(sec007).toHaveLength(1);
    expect(sec007[0]?.severity).toBe('high');
  });

  it('does not flag guest on separate VLAN', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'guest', name: 'Guest', role: 'GUEST', vlanId: 10 }),
        makeSubnet({ id: 'lan', name: 'LAN', role: 'LAN', vlanId: 20 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec007 = issues.filter((i) => i.ruleId === 'SEC-007');
    expect(sec007).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-008: IoT not segmented from LAN/Guest
 * ------------------------------------------------------------------ */

describe('SEC-008: IoT segmentation', () => {
  it('detects IoT sharing VLAN with LAN', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'iot', name: 'IoT', role: 'IOT', vlanId: 10 }),
        makeSubnet({ id: 'lan', name: 'LAN', role: 'LAN', vlanId: 10 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec008 = issues.filter((i) => i.ruleId === 'SEC-008');
    expect(sec008).toHaveLength(1);
    expect(sec008[0]?.severity).toBe('high');
  });

  it('does not flag IoT on separate VLAN', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'iot', name: 'IoT', role: 'IOT', vlanId: 10 }),
        makeSubnet({ id: 'lan', name: 'LAN', role: 'LAN', vlanId: 20 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec008 = issues.filter((i) => i.ruleId === 'SEC-008');
    expect(sec008).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-009: Management subnet oversized
 * ------------------------------------------------------------------ */

describe('SEC-009: Management subnet size', () => {
  it('detects oversized management subnet', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ role: 'MANAGEMENT', cidr: '192.168.1.0/24' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec009 = issues.filter((i) => i.ruleId === 'SEC-009');
    expect(sec009).toHaveLength(1);
    expect(sec009[0]?.severity).toBe('medium');
  });

  it('does not flag appropriately sized management subnet', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ role: 'MANAGEMENT', cidr: '192.168.1.0/28' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec009 = issues.filter((i) => i.ruleId === 'SEC-009');
    expect(sec009).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-010: Excessive broadcast domain
 * ------------------------------------------------------------------ */

describe('SEC-010: Broadcast domain size', () => {
  it('detects /24 broadcast domain', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '192.168.1.0/24' })],
    });
    const issues = auditPlan(plan);
    const sec010 = issues.filter((i) => i.ruleId === 'SEC-010');
    expect(sec010).toHaveLength(1);
    expect(sec010[0]?.severity).toBe('medium');
  });

  it('does not flag /25 or smaller', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '192.168.1.0/25' })],
    });
    const issues = auditPlan(plan);
    const sec010 = issues.filter((i) => i.ruleId === 'SEC-010');
    expect(sec010).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-011: Subnet extends outside the parent CIDR
 * ------------------------------------------------------------------ */

describe('SEC-011: Subnet inside parent', () => {
  it('detects subnet outside parent', () => {
    const plan = makePlan({
      parentCidr: '192.168.1.0/24',
      subnets: [makeSubnet({ cidr: '192.168.2.0/24' })],
    });
    const issues = auditPlan(plan);
    const sec011 = issues.filter((i) => i.ruleId === 'SEC-011');
    expect(sec011).toHaveLength(1);
    expect(sec011[0]?.severity).toBe('medium');
  });

  it('does not flag subnet inside parent', () => {
    const plan = makePlan({
      parentCidr: '192.168.0.0/16',
      subnets: [makeSubnet({ cidr: '192.168.1.0/24' })],
    });
    const issues = auditPlan(plan);
    const sec011 = issues.filter((i) => i.ruleId === 'SEC-011');
    expect(sec011).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-012: Poor utilization
 * ------------------------------------------------------------------ */

describe('SEC-012: Poor utilization', () => {
  it('detects poor utilization on /25', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/25', requestedHosts: 10 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec012 = issues.filter((i) => i.ruleId === 'SEC-012');
    expect(sec012).toHaveLength(1);
    expect(sec012[0]?.severity).toBe('medium');
  });

  it('does not flag good utilization', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/25', requestedHosts: 100 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec012 = issues.filter((i) => i.ruleId === 'SEC-012');
    expect(sec012).toHaveLength(0);
  });

  it('does not flag /24 or larger subnets', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ cidr: '192.168.1.0/24', requestedHosts: 10 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec012 = issues.filter((i) => i.ruleId === 'SEC-012');
    expect(sec012).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-013: DMZ isolation
 * ------------------------------------------------------------------ */

describe('SEC-013: DMZ isolation', () => {
  it('detects DMZ sharing VLAN with LAN', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'dmz', name: 'DMZ', role: 'DMZ', vlanId: 10 }),
        makeSubnet({ id: 'lan', name: 'LAN', role: 'LAN', vlanId: 10 }),
      ],
    });
    const issues = auditPlan(plan);
    const sec013 = issues.filter((i) => i.ruleId === 'SEC-013');
    expect(sec013.length).toBeGreaterThanOrEqual(1);
    expect(sec013[0]?.severity).toBe('medium');
  });

  it('detects DMZ nested inside LAN', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'lan', name: 'LAN', role: 'LAN', cidr: '192.168.0.0/16' }),
        makeSubnet({ id: 'dmz', name: 'DMZ', role: 'DMZ', cidr: '192.168.1.0/24' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec013 = issues.filter((i) => i.ruleId === 'SEC-013');
    expect(sec013.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag isolated DMZ', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'dmz', name: 'DMZ', role: 'DMZ', vlanId: 10, cidr: '10.0.0.0/24' }),
        makeSubnet({ id: 'lan', name: 'LAN', role: 'LAN', vlanId: 20, cidr: '192.168.1.0/24' }),
      ],
    });
    const issues = auditPlan(plan);
    const sec013 = issues.filter((i) => i.ruleId === 'SEC-013');
    expect(sec013).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-014: Missing VLAN ID
 * ------------------------------------------------------------------ */

describe('SEC-014: Missing VLAN ID', () => {
  it('detects missing VLAN on LAN role', () => {
    const plan = makePlan({
      subnets: [makeSubnetNoVlan({ role: 'LAN' })],
    });
    const issues = auditPlan(plan);
    const sec014 = issues.filter((i) => i.ruleId === 'SEC-014');
    expect(sec014).toHaveLength(1);
    expect(sec014[0]?.severity).toBe('info');
  });

  it('does not flag missing VLAN on P2P role', () => {
    const plan = makePlan({
      subnets: [makeSubnetNoVlan({ role: 'POINT_TO_POINT' })],
    });
    const issues = auditPlan(plan);
    const sec014 = issues.filter((i) => i.ruleId === 'SEC-014');
    expect(sec014).toHaveLength(0);
  });

  it('does not flag present VLAN ID', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ role: 'LAN', vlanId: 10 })],
    });
    const issues = auditPlan(plan);
    const sec014 = issues.filter((i) => i.ruleId === 'SEC-014');
    expect(sec014).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-015: Reserved space in use
 * ------------------------------------------------------------------ */

describe('SEC-015: Reserved space', () => {
  it('detects loopback space in use', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '127.0.0.0/8' })],
    });
    const issues = auditPlan(plan);
    const sec015 = issues.filter((i) => i.ruleId === 'SEC-015');
    expect(sec015).toHaveLength(1);
    expect(sec015[0]?.severity).toBe('info');
  });

  it('does not flag RFC 1918 space', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '192.168.1.0/24' })],
    });
    const issues = auditPlan(plan);
    const sec015 = issues.filter((i) => i.ruleId === 'SEC-015');
    expect(sec015).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-016: Public address space
 * ------------------------------------------------------------------ */

describe('SEC-016: Public address space', () => {
  it('detects public address space', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '8.8.8.0/24' })],
    });
    const issues = auditPlan(plan);
    const sec016 = issues.filter((i) => i.ruleId === 'SEC-016');
    expect(sec016).toHaveLength(1);
    expect(sec016[0]?.severity).toBe('info');
  });

  it('does not flag private address space', () => {
    const plan = makePlan({
      subnets: [makeSubnet({ cidr: '10.0.0.0/8' })],
    });
    const issues = auditPlan(plan);
    const sec016 = issues.filter((i) => i.ruleId === 'SEC-016');
    expect(sec016).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * SEC-017: Address space hygiene
 * ------------------------------------------------------------------ */

describe('SEC-017: Address space hygiene', () => {
  it('detects mostly unused address space', () => {
    const plan = makePlan({
      parentCidr: '10.0.0.0/8',
      subnets: [makeSubnet({ cidr: '10.0.0.0/24' })],
    });
    const issues = auditPlan(plan);
    const sec017 = issues.filter((i) => i.ruleId === 'SEC-017');
    expect(sec017).toHaveLength(1);
    expect(sec017[0]?.severity).toBe('info');
  });

  it('does not flag well-utilized space', () => {
    const plan = makePlan({
      parentCidr: '192.168.1.0/24',
      subnets: [makeSubnet({ cidr: '192.168.1.0/25' })],
    });
    const issues = auditPlan(plan);
    const sec017 = issues.filter((i) => i.ruleId === 'SEC-017');
    expect(sec017).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Issue structure tests
 * ------------------------------------------------------------------ */

describe('issue structure', () => {
  it('every issue has all required fields', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'a', cidr: '192.168.1.0/24', gateway: '10.0.0.1' }),
      ],
    });
    const issues = auditPlan(plan);

    for (const issue of issues) {
      expect(issue.ruleId).toMatch(/^SEC-\d{3}$/);
      expect(issue.severity).toBeDefined();
      expect(issue.title).toBeTruthy();
      expect(issue.problem).toBeTruthy();
      expect(issue.whyItMatters).toBeTruthy();
      expect(issue.remediation).toBeTruthy();
      expect(issue.citation).toBeTruthy();
      expect(issue.affectedSubnetIds).toBeDefined();
      expect(issue.affectedSubnetIds.length).toBeGreaterThan(0);
    }
  });

  it('issues are sorted by severity (critical first)', () => {
    const plan = makePlan({
      subnets: [
        makeSubnet({ id: 'a', cidr: '192.168.1.0/24', gateway: '10.0.0.1', vlanId: 0 }),
      ],
    });
    const issues = auditPlan(plan);

    const severityOrder = { critical: 0, high: 1, medium: 2, info: 3 };
    for (let i = 1; i < issues.length; i++) {
      const prev = issues[i - 1];
      const curr = issues[i];
      if (prev && curr) {
        expect(severityOrder[prev.severity]).toBeLessThanOrEqual(severityOrder[curr.severity]);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Rule coverage tests
 * ------------------------------------------------------------------ */

describe('rule coverage', () => {
  it('all 17 rules are registered', () => {
    // This test ensures the rule registry is complete.
    // If a rule is added to the RULES array but not tested, this will fail.
    const expectedRules = [
      'SEC-001', 'SEC-002', 'SEC-003', 'SEC-004', 'SEC-005',
      'SEC-006', 'SEC-007', 'SEC-008', 'SEC-009', 'SEC-010',
      'SEC-011', 'SEC-012', 'SEC-013', 'SEC-014', 'SEC-015',
      'SEC-016', 'SEC-017',
    ];

    // Create a plan that triggers all rules.
    // Use a /8 parent so SEC-017 (>90% free) can still fire despite the subnets.
    const plan = makePlan({
      parentCidr: '10.0.0.0/8',
      subnets: [
        // SEC-001: Overlapping
        makeSubnet({ id: 'a', cidr: '10.0.0.0/24' }),
        makeSubnet({ id: 'b', cidr: '10.0.0.128/25' }),
        // SEC-002: Duplicate VLAN
        makeSubnet({ id: 'c', vlanId: 10 }),
        makeSubnet({ id: 'd', vlanId: 10 }),
        // SEC-003: Misaligned
        makeSubnet({ id: 'e', cidr: '10.0.1.50/24' }),
        // SEC-004: Gateway outside
        makeSubnet({ id: 'f', cidr: '10.0.2.0/24', gateway: '10.0.3.1' }),
        // SEC-005: Gateway is network
        makeSubnet({ id: 'g', cidr: '10.0.3.0/24', gateway: '10.0.3.0' }),
        // SEC-006: VLAN out of range
        makeSubnet({ id: 'h', vlanId: 0 }),
        // SEC-007: Guest with LAN
        makeSubnet({ id: 'i', role: 'GUEST', vlanId: 20 }),
        makeSubnet({ id: 'j', role: 'LAN', vlanId: 20 }),
        // SEC-008: IoT with LAN
        makeSubnet({ id: 'k', role: 'IOT', vlanId: 30 }),
        makeSubnet({ id: 'l', role: 'LAN', vlanId: 30 }),
        // SEC-009: Mgmt oversized
        makeSubnet({ id: 'm', role: 'MANAGEMENT', cidr: '10.0.4.0/24' }),
        // SEC-010: Broadcast domain
        makeSubnet({ id: 'n', cidr: '10.0.5.0/24' }),
        // SEC-011: Outside parent
        makeSubnet({ id: 'o', cidr: '192.168.0.0/16' }),
        // SEC-012: Poor utilization
        makeSubnet({ id: 'p', cidr: '10.0.6.0/25', requestedHosts: 5 }),
        // SEC-013: DMZ nested inside LAN
        makeSubnet({ id: 'q', role: 'DMZ', cidr: '10.0.7.0/25', vlanId: 40 }),
        makeSubnet({ id: 'r', role: 'LAN', cidr: '10.0.7.0/24', vlanId: 40 }),
        // SEC-014: Missing VLAN
        makeSubnetNoVlan({ id: 's', role: 'LAN' }),
        // SEC-015: Reserved space (loopback /24)
        makeSubnet({ id: 't', cidr: '127.0.0.0/24' }),
        // SEC-016: Public space
        makeSubnet({ id: 'u', cidr: '8.8.8.0/24' }),
      ],
    });

    const issues = auditPlan(plan);
    const firedRules = new Set(issues.map((i) => i.ruleId));

    for (const ruleId of expectedRules) {
      expect(firedRules.has(ruleId), `Rule ${ruleId} should fire`).toBe(true);
    }
  });
});
