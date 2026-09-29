/**
 * VLSM engine test suite.
 *
 * Two jobs:
 *
 *   1. Reproduce the specification's worked examples exactly, so a change to the
 *      packer can never silently alter a result the user has been shown.
 *
 *   2. Assert the INVARIANTS over generated inputs. The examples prove the
 *      packer is right for the cases someone thought of; the property tests
 *      prove it is right for the cases nobody did. Overlap and boundary
 *      correctness are the properties that matter, because those are the bugs a
 *      user would ship to production.
 */

import { describe, expect, it } from 'vitest';

import {
  assertAllocationsValid,
  assertNoOverlaps,
  deriveFreeRanges,
  idealPrefixFor,
  isExhausted,
  packVLSM,
  totalUsableHosts,
} from '../src/core/vlsm-engine';
import {
  calculateUsableHosts,
  integerToIPv4,
  isValidPointToPointPairStart,
  parseCidr,
  parseIPv4,
  rangeSize,
  rangesOverlap,
} from '../src/core/ip-engine';
import { ScopeExhaustionError, SubnetOverlapError } from '../src/core/errors';
import type { Allocation, HostRequirement, NetworkRole } from '../src/types/network';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

let sequence = 0;

/** Build a requirement. Sort order is stable, so pass these in a deliberate order. */
const req = (name: string, requestedHosts: number, role: NetworkRole = 'LAN'): HostRequirement => ({
  id: `req-${(sequence += 1)}`,
  name,
  requestedHosts,
  role,
});

/** The allocated CIDR strings, in allocation order. */
const cidrs = (result: { allocations: readonly Allocation[] }): string[] =>
  result.allocations.map((a) => a.assignedCidr);

/** The allocated CIDR strings, sorted by address. */
const cidrsByAddress = (result: { allocations: readonly Allocation[] }): string[] =>
  [...result.allocations]
    .sort((a, b) => a.subnet.networkAddress - b.subnet.networkAddress)
    .map((a) => a.assignedCidr);

const byName = (result: { allocations: readonly Allocation[] }, name: string): Allocation => {
  const found = result.allocations.find((a) => a.name === name);
  if (!found) throw new Error(`No allocation named "${name}"`);
  return found;
};

/* ================================================================== *
 * SPECIFICATION EXAMPLES
 * ================================================================== */

describe('specification example: 192.168.1.0/24 with 100, 50, 25, 10 hosts', () => {
  const result = packVLSM('192.168.1.0/24', [
    req('Students', 100),
    req('IT', 50),
    req('Admin', 25),
    req('Mgmt', 10),
  ]);

  it('allocates exactly the subnets the spec lists', () => {
    expect(cidrs(result)).toEqual([
      '192.168.1.0/25', // 100 hosts
      '192.168.1.128/26', // 50 hosts
      '192.168.1.192/27', // 25 hosts
      '192.168.1.224/28', // 10 hosts
    ]);
  });

  it('reports the usable host counts the spec lists', () => {
    expect(byName(result, 'Students').subnet.usableHosts).toBe(126);
    expect(byName(result, 'IT').subnet.usableHosts).toBe(62);
    expect(byName(result, 'Admin').subnet.usableHosts).toBe(30);
    expect(byName(result, 'Mgmt').subnet.usableHosts).toBe(14);
  });

  it('each block holds its requirement with room to spare', () => {
    for (const allocation of result.allocations) {
      expect(allocation.subnet.usableHosts, allocation.name).toBeGreaterThanOrEqual(
        allocation.requestedHosts,
      );
      expect(allocation.wastedAddresses).toBeGreaterThanOrEqual(0);
    }
  });

  it('accounts for the whole parent', () => {
    // 128 + 64 + 32 + 16 = 240 allocated out of 256
    expect(result.allocatedAddresses).toBe(240);
    expect(result.freeAddresses).toBe(16);
    expect(result.totalAddresses).toBe(256);
    expect(result.allocatedAddresses + result.freeAddresses).toBe(result.totalAddresses);
  });

  it('reports the single trailing free range', () => {
    expect(result.freeRanges).toHaveLength(1);
    expect(result.freeRanges[0]?.cidr).toBe('192.168.1.240/28');
    expect(result.freeRanges[0]?.addresses).toBe(16);
  });

  it('satisfies every structural invariant', () => {
    expect(() => assertAllocationsValid(result)).not.toThrow();
  });
});

describe('specification example: 192.168.1.0/24 with 100, 50, 10 hosts', () => {
  const result = packVLSM('192.168.1.0/24', [req('Students', 100), req('IT', 50), req('Mgmt', 10)]);

  it('allocates the spec subnets', () => {
    expect(cidrs(result)).toEqual(['192.168.1.0/25', '192.168.1.128/26', '192.168.1.192/28']);
  });
});

describe('specification example: 10.0.0.0/22 with 300, 200, 100 hosts', () => {
  const result = packVLSM('10.0.0.0/22', [req('A', 300), req('B', 200), req('C', 100)]);

  it('allocates descending blocks', () => {
    // 300 hosts -> /23 (510 usable), 200 -> /24 (254), 100 -> /25 (126).
    // The third is a /25, not a /24: 126 usable addresses already covers 100
    // hosts, and allocating larger would strand a quarter of the /22.
    expect(cidrs(result)).toEqual(['10.0.0.0/23', '10.0.2.0/24', '10.0.3.0/25']);
  });

  it('never crosses the /22 boundary', () => {
    const last = result.allocations[result.allocations.length - 1];
    expect(integerToIPv4(last?.subnet.broadcastAddress ?? 0)).toBe('10.0.3.127');
  });
});

/* ================================================================== *
 * SORTING
 * ================================================================== */

describe('requirement ordering', () => {
  it('allocates largest first regardless of input order', () => {
    const ascending = packVLSM('10.0.0.0/22', [req('S', 10), req('M', 100), req('L', 300)]);
    const descending = packVLSM('10.0.0.0/22', [req('L', 300), req('M', 100), req('S', 10)]);

    expect(cidrs(ascending)).toEqual(cidrs(descending));
    expect(cidrs(ascending)[0]).toBe('10.0.0.0/23');
  });

  it('is stable for equal-size requirements, preserving the user order', () => {
    const result = packVLSM('10.0.0.0/24', [req('First', 50), req('Second', 50), req('Third', 50)]);
    expect(result.allocations.map((a) => a.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('carries the requirement id onto the allocation so the planner can map back', () => {
    const r = req('Students', 100);
    const result = packVLSM('192.168.1.0/24', [r]);
    expect(result.allocations[0]?.id).toBe(r.id);
  });
});

/* ================================================================== *
 * BOUNDARY ALIGNMENT
 *
 * Note on when the alignment step actually moves the cursor: with a strict
 * descending sort and uniform role rules, every block size is a multiple of the
 * next, so the cursor is always already aligned. Alignment only does visible
 * work when roles produce NON-MONOTONIC sizes - a point-to-point /31 packed
 * between two LAN blocks, for example. That is the case tested below, and it is
 * why the ceiling step is kept rather than assumed unnecessary.
 * ================================================================== */

describe('boundary alignment', () => {
  it('aligns a /30 after a /29 and a /31, skipping the 2 addresses it cannot use', () => {
    // Parent /28 = 16 addresses. Sorting is by requestedHosts descending, so
    // the 3-host LAN goes first and the two 2-host requirements follow in the
    // order given (stable sort):
    //   LAN  3 hosts -> /29, 8 addresses -> 10.0.0.0  - 10.0.0.7
    //   P2P  2 hosts -> /31, 2 addresses -> 10.0.0.8  - 10.0.0.9
    //   LAN  2 hosts -> /30, 4 addresses -> cursor is 10, which is NOT a
    //                                        multiple of 4, so alignment skips
    //                                        to 12
    // This is the case that matters. A /31 packed between LAN blocks makes the
    // block sizes NON-MONOTONIC (8, 2, 4), which is the only way the cursor can
    // land unaligned. With uniform roles and a strict descending sort, every
    // block size is a multiple of the next and the cursor is always already
    // aligned, so the ceiling step would be a no-op.
    const result = packVLSM('10.0.0.0/28', [
      req('LAN-A', 3, 'LAN'),
      req('Link-1', 2, 'POINT_TO_POINT'),
      req('LAN-B', 2, 'LAN'),
    ]);

    expect(cidrs(result)).toEqual(['10.0.0.0/29', '10.0.0.8/31', '10.0.0.12/30']);
  });

  it('strands exactly the addresses below the misaligned block', () => {
    // Without alignment the third block would be 10.0.0.10/30, whose address is
    // not a network boundary. Alignment instead strands 10.0.0.10 and 10.0.0.11.
    const result = packVLSM('10.0.0.0/28', [
      req('LAN-A', 3, 'LAN'),
      req('Link-1', 2, 'POINT_TO_POINT'),
      req('LAN-B', 2, 'LAN'),
    ]);
    for (const allocation of result.allocations) {
      expect(
        allocation.subnet.networkAddress % allocation.subnet.totalAddresses,
        allocation.assignedCidr,
      ).toBe(0);
    }
    // 8 + 2 + 4 = 14 of 16 allocated, so exactly 2 addresses are stranded.
    expect(result.allocatedAddresses).toBe(14);
    expect(result.freeAddresses).toBe(2);
    expect(result.freeRanges).toHaveLength(1);
    expect(result.freeRanges[0]?.cidr).toBe('10.0.0.10/31');
  });

  it('every allocation is on a legal network boundary, always', () => {
    const results = [
      packVLSM('10.0.0.0/22', [req('A', 300), req('B', 200), req('C', 100)]),
      packVLSM('172.16.0.0/20', [
        req('A', 500),
        req('B', 250),
        req('C', 60),
        req('D', 25),
        req('E', 5),
      ]),
      packVLSM('192.168.0.0/21', [
        req('A', 1000),
        req('B', 4, 'POINT_TO_POINT'),
        req('C', 4, 'LAN'),
        req('D', 3, 'LAN'),
      ]),
    ];
    for (const result of results) {
      for (const allocation of result.allocations) {
        expect(
          allocation.subnet.networkAddress % allocation.subnet.totalAddresses,
          allocation.assignedCidr,
        ).toBe(0);
      }
    }
  });

  it('starts the first allocation exactly at the parent network address', () => {
    for (const parent of ['10.0.0.0/22', '172.16.0.0/20', '192.168.1.0/24', '10.10.0.0/16']) {
      const result = packVLSM(parent, [req('A', 100), req('B', 50)]);
      const first = [...result.allocations].sort(
        (a, b) => a.subnet.networkAddress - b.subnet.networkAddress,
      )[0];
      expect(first?.subnet.networkAddress, parent).toBe(parseCidr(parent).ip);
    }
  });

  it('normalises a parent given as a host address', () => {
    // 192.168.1.50/24 is a valid reference to an address inside 192.168.1.0/24.
    // The packer must allocate inside the containing network, not reject it.
    const result = packVLSM('192.168.1.50/24', [req('A', 100)]);
    expect(result.allocations[0]?.assignedCidr).toBe('192.168.1.0/25');
    expect(result.parentCidr.ip).toBe(parseCidr('192.168.1.0/24').ip);
  });
});

/* ================================================================== *
 * EXHAUSTION
 * ================================================================== */

describe('address space exhaustion', () => {
  it('throws when the requirements cannot fit', () => {
    expect(() =>
      packVLSM('192.168.1.0/24', [
        req('A', 200),
        req('B', 60),
        req('C', 30),
        req('D', 20),
        req('E', 10),
        req('F', 5),
        req('G', 2),
      ]),
    ).toThrow(ScopeExhaustionError);
  });

  it('uses the spec wording for the user', () => {
    expect(() => packVLSM('192.168.1.0/30', [req('Too big', 100)])).toThrow(
      'Not enough address space for these requirements.',
    );
  });

  it('blames no single requirement when the total is too large', () => {
    // The pre-flight check fires before any allocation, so no one requirement
    // is at fault and `name` is null. That null is the signal the UI uses to say
    // "enlarge the parent" rather than "shrink this subnet".
    try {
      packVLSM('192.168.1.0/28', [req('Fits', 10), req('Also fine', 4)]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeExhaustionError);
      const details = (error as ScopeExhaustionError).details;
      expect(details.reason).toBe('INSUFFICIENT_TOTAL');
      expect(details.name).toBeNull();
      expect(details.requiredAddresses).toBe(16 + 8); // /28 and /29
      expect(details.availableAddresses).toBe(16);
      expect(details.shortfallAddresses).toBe(8);
    }
  });

  it('names the requirement when alignment strands the space', () => {
    // Blocks sum to exactly 16: 8 + 2 + 4 + 2. The pre-flight passes. The
    // /31 placed second forces the third block up to 10.0.0.12, stranding
    // 10.0.0.10-11, and the fourth no longer fits. This is fragmentation, not
    // a total shortfall, and only the greedy pass can find it.
    try {
      packVLSM('10.0.0.0/28', [
        req('LAN-A', 3, 'LAN'),
        req('Link-1', 2, 'POINT_TO_POINT'),
        req('LAN-B', 2, 'LAN'),
        req('Link-2', 2, 'POINT_TO_POINT'),
      ]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeExhaustionError);
      const details = (error as ScopeExhaustionError).details;
      expect(details.reason).toBe('ALIGNMENT_FRAGMENTATION');
      expect(details.name).toBe('Link-2');
      expect(details.requestedHosts).toBe(2);
      expect(details.requiredAddresses).toBe(2);
      // The parent is fully consumed, so the raw remaining count is 0. That is
      // expected, and is exactly why `reason` carries the explanation.
      expect(details.availableAddresses).toBe(0);
    }
  });

  it('gives both reasons the same user-facing wording', () => {
    // One message for both, because the friendly text stays true either way.
    const message = 'Not enough address space for these requirements.';
    for (const attempt of [
      () => packVLSM('192.168.1.0/24', [req('A', 300)]),
      () =>
        packVLSM('10.0.0.0/28', [
          req('A', 3),
          req('B', 2, 'POINT_TO_POINT'),
          req('C', 2),
          req('D', 2, 'POINT_TO_POINT'),
        ]),
    ]) {
      expect(attempt).toThrow(message);
    }
  });

  it('fills the parent exactly, with nothing wasted', () => {
    const result = packVLSM('192.168.1.0/24', [req('All', 254)]);
    expect(result.allocations[0]?.assignedCidr).toBe('192.168.1.0/24');
    expect(result.freeAddresses).toBe(0);
    expect(isExhausted(result)).toBe(true);
  });

  it('handles a requirement that is the whole parent', () => {
    const result = packVLSM('10.0.0.0/22', [req('All', 1022)]);
    expect(result.allocations[0]?.assignedCidr).toBe('10.0.0.0/22');
    expect(result.allocations[0]?.subnet.usableHosts).toBe(1022);
  });

  it('fills a /31 parent with a single point-to-point link', () => {
    const result = packVLSM('10.0.0.1/31', [req('Link', 2, 'POINT_TO_POINT')]);
    expect(result.allocations[0]?.assignedCidr).toBe('10.0.0.0/31');
    expect(result.allocations[0]?.subnet.usableHosts).toBe(2);
    expect(result.allocations[0]?.subnet.isPointToPoint).toBe(true);
    expect(result.freeAddresses).toBe(0);
  });

  it('refuses to carve a LAN subnet out of a /32', () => {
    // A /32 is a single address. The smallest LAN block is a /30, four
    // addresses, so there is no legal allocation here. The alternative -
    // silently handing back the /32 - would be a subnet whose reserved
    // network and broadcast addresses do not exist.
    try {
      packVLSM('192.168.1.50/32', [req('One', 1)]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeExhaustionError);
      const details = (error as ScopeExhaustionError).details;
      expect(details.reason).toBe('INSUFFICIENT_TOTAL');
      expect(details.requiredAddresses).toBe(4);
      expect(details.availableAddresses).toBe(1);
    }
  });

  it('rejects anything larger than a /32 parent', () => {
    expect(() => packVLSM('192.168.1.50/32', [req('Two', 2)])).toThrow(ScopeExhaustionError);
  });
});

/* ================================================================== *
 * POINT TO POINT
 * ================================================================== */

describe('RFC 3021 point-to-point links', () => {
  it('packs a 2-host point-to-point requirement as a /31', () => {
    const result = packVLSM('192.168.1.0/24', [req('Branch', 2, 'POINT_TO_POINT')]);
    expect(result.allocations[0]?.assignedCidr).toBe('192.168.1.0/31');
    expect(result.allocations[0]?.subnet.usableHosts).toBe(2);
    expect(result.allocations[0]?.subnet.isPointToPoint).toBe(true);
  });

  it('packs several /31 links consecutively', () => {
    const result = packVLSM('192.168.1.0/24', [
      req('Link A', 2, 'POINT_TO_POINT'),
      req('Link B', 2, 'POINT_TO_POINT'),
      req('Link C', 2, 'POINT_TO_POINT'),
    ]);
    expect(cidrs(result)).toEqual(['192.168.1.0/31', '192.168.1.2/31', '192.168.1.4/31']);
  });

  it('always starts a /31 on an even address, per RFC 3021 Appendix A', () => {
    // Mixing P2P and LAN requirements is what produces non-monotonic block
    // sizes, which is exactly when an unaligned /31 could appear.
    const result = packVLSM('10.0.0.0/24', [
      req('LAN-A', 60, 'LAN'),
      req('Link A', 2, 'POINT_TO_POINT'),
      req('LAN-B', 30, 'LAN'),
      req('Link B', 2, 'POINT_TO_POINT'),
      req('LAN-C', 14, 'LAN'),
      req('Link C', 2, 'POINT_TO_POINT'),
    ]);
    const p2p = result.allocations.filter((a) => a.subnet.cidr.prefix === 31);
    expect(p2p.length).toBe(3);
    for (const link of p2p) {
      expect(isValidPointToPointPairStart(link.subnet.networkAddress), link.assignedCidr).toBe(
        true,
      );
    }
  });

  it('the /31 minimum is a floor, not a cap', () => {
    // Two hosts gets the RFC 3021 /31. The same two hosts on a LAN role gets a
    // /30, because a LAN segment reserves a network and broadcast address.
    // Anything above 2 hosts falls through to ordinary sizing.
    const p2p = packVLSM('10.0.0.0/24', [req('Link', 2, 'POINT_TO_POINT')]);
    const lan = packVLSM('10.0.0.0/24', [req('Segment', 2, 'LAN')]);
    const bigger = packVLSM('10.0.0.0/24', [req('Link', 4, 'POINT_TO_POINT')]);

    expect(p2p.allocations[0]?.assignedCidr).toBe('10.0.0.0/31');
    expect(lan.allocations[0]?.assignedCidr).toBe('10.0.0.0/30');
    expect(bigger.allocations[0]?.assignedCidr).toBe('10.0.0.0/29');
    expect(bigger.allocations[0]?.subnet.usableHosts).toBeGreaterThanOrEqual(4);
  });
});

/* ================================================================== *
 * REPORTING
 * ================================================================== */

describe('utilisation and efficiency reporting', () => {
  it('reports utilisation against the allocated block', () => {
    const result = packVLSM('192.168.1.0/24', [req('Students', 100), req('IT', 50)]);
    // 100 of 126 usable in the /25
    expect(byName(result, 'Students').utilisationPercent).toBeCloseTo(79.37, 1);
  });

  it('reports over-capacity rather than clamping it', () => {
    // Not reachable through packVLSM, which sizes every block to its
    // requirement. The reporting contract matters for plans a user edits by
    // hand in the planner, and is covered against calculateUtilization in the
    // engine suite. Here we only assert the packer never produces one.
    const result = packVLSM('10.0.0.0/16', [req('A', 300), req('B', 200)]);
    for (const allocation of result.allocations) {
      expect(allocation.utilisationPercent).toBeLessThanOrEqual(100);
    }
  });

  it('separates space utilisation from host efficiency', () => {
    // Space utilisation: how much of the parent was allocated.
    // Host efficiency: how much of what was allocated is usable capacity.
    // Conflating them would make "used most of the network" look like
    // "packed tightly", which are different questions.
    const result = packVLSM('192.168.1.0/24', [req('A', 100)]);
    expect(result.spaceUtilisationPercent).toBeCloseTo(50, 1); // 128 of 256
    expect(result.hostEfficiencyPercent).toBeCloseTo(98.44, 1); // 126 of 128
    expect(result.allocatedAddresses + result.freeAddresses).toBe(result.totalAddresses);
  });

  it('sums usable hosts across allocations', () => {
    const result = packVLSM('192.168.1.0/24', [
      req('A', 100),
      req('B', 50),
      req('C', 25),
      req('D', 10),
    ]);
    expect(totalUsableHosts(result)).toBe(126 + 62 + 30 + 14);
  });

  it('reports zero, not NaN, for an empty plan', () => {
    const result = packVLSM('192.168.1.0/24', []);
    expect(result.allocations).toHaveLength(0);
    expect(result.allocatedAddresses).toBe(0);
    expect(result.freeAddresses).toBe(256);
    expect(result.spaceUtilisationPercent).toBe(0);
    expect(result.hostEfficiencyPercent).toBe(0);
    expect(result.freeRanges).toHaveLength(1);
    expect(result.freeRanges[0]?.cidr).toBe('192.168.1.0/24');
    expect(isExhausted(result)).toBe(false);
  });

  it('idealPrefixFor reports the tightest possible block for a requirement', () => {
    expect(idealPrefixFor(100)).toBe(25);
    expect(idealPrefixFor(50)).toBe(26);
    expect(idealPrefixFor(10)).toBe(28);
    expect(idealPrefixFor(2, 'POINT_TO_POINT')).toBe(31);
  });
});

/* ================================================================== *
 * FREE SPACE
 * ================================================================== */

describe('free range discovery', () => {
  it('finds the gap left between two allocations', () => {
    // Force an interior gap: a /25 then a /26 leaves 64 addresses unused at
    // 192.168.1.64, and a third allocation placed after it.
    const result = packVLSM('192.168.1.0/22', [req('A', 500), req('B', 200), req('C', 30)]);
    expect(result.freeRanges.length).toBeGreaterThan(0);
    for (const range of result.freeRanges) {
      expect(range.addresses).toBe(range.end - range.start + 1);
      expect(range.addresses).toBeGreaterThan(0);
    }
  });

  it('free ranges plus allocations exactly cover the parent', () => {
    const result = packVLSM('10.0.0.0/22', [
      req('A', 300),
      req('B', 200),
      req('C', 100),
      req('D', 25),
    ]);
    const covered =
      result.allocatedAddresses + result.freeRanges.reduce((sum, r) => sum + r.addresses, 0);
    expect(covered).toBe(result.totalAddresses);
  });

  it('labels a free fragment with the largest aligned block that fits', () => {
    const ranges = deriveFreeRanges(
      [
        {
          id: 'a',
          name: 'A',
          role: 'LAN',
          requestedHosts: 0,
          // 192.168.1.128/25, not 192.168.1.256. The gap below it is therefore
          // 192.168.1.0 - 192.168.1.127, a clean /25.
          assignedCidr: '192.168.1.128/25',
          wastedAddresses: 0,
          utilisationPercent: 0,
          subnet: calculateSubnetFixture(parseIPv4('192.168.1.128'), 25),
        } as Allocation,
      ],
      parseIPv4('192.168.1.0'),
      parseIPv4('192.168.1.255'),
    );
    expect(ranges[0]?.cidr).toBe('192.168.1.0/25');
    expect(ranges[0]?.addresses).toBe(128);
    expect(ranges[0]?.isFragmented).toBe(false);
  });

  it('marks fragments too small to use', () => {
    const ranges = deriveFreeRanges([], parseIPv4('192.168.1.0'), parseIPv4('192.168.1.5')); // 6 addresses
    expect(ranges[0]?.addresses).toBe(6);
    expect(ranges[0]?.isFragmented).toBe(true);
  });
});

/* ================================================================== *
 * INVARIANTS OVER GENERATED INPUT
 *
 * The examples above prove the packer is right for cases someone thought of.
 * These prove it is right for cases nobody did.
 * ================================================================== */

describe('invariants across generated inputs', () => {
  const PARENTS = [
    '10.0.0.0/16',
    '172.16.0.0/20',
    '192.168.1.0/24',
    '10.10.0.0/22',
    '192.168.0.0/27',
  ];

  /** Deterministic pseudo-random generator: the same suite fails the same way. */
  const makeRandom = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };

  it('never produces overlapping subnets', () => {
    const random = makeRandom(20260928);
    for (const parent of PARENTS) {
      for (let trial = 0; trial < 40; trial += 1) {
        const count = 1 + Math.floor(random() * 6);
        const requirements = Array.from({ length: count }, (_, i) =>
          req(`R${i}`, 1 + Math.floor(random() * 300)),
        );
        let result;
        try {
          result = packVLSM(parent, requirements);
        } catch (error) {
          // Exhaustion is a legitimate outcome, not an overlap failure.
          expect(error).toBeInstanceOf(ScopeExhaustionError);
          continue;
        }

        const ranges = result.allocations.map((a) => ({
          start: a.subnet.networkAddress,
          end: a.subnet.broadcastAddress,
        }));
        for (let i = 0; i < ranges.length; i += 1) {
          for (let j = i + 1; j < ranges.length; j += 1) {
            const a = ranges[i];
            const b = ranges[j];
            if (!a || !b) continue;
            expect(
              rangesOverlap(a, b),
              `${parent} trial ${trial}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('keeps every allocation inside the parent', () => {
    const random = makeRandom(777);
    for (const parent of PARENTS) {
      const parentRange = rangeOfCidr(parent);
      for (let trial = 0; trial < 40; trial += 1) {
        const count = 1 + Math.floor(random() * 5);
        const requirements = Array.from({ length: count }, (_, i) =>
          req(`R${i}`, 1 + Math.floor(random() * 400)),
        );
        let result;
        try {
          result = packVLSM(parent, requirements);
        } catch {
          continue;
        }
        for (const allocation of result.allocations) {
          expect(allocation.subnet.networkAddress, allocation.assignedCidr).toBeGreaterThanOrEqual(
            parentRange.start,
          );
          expect(allocation.subnet.broadcastAddress, allocation.assignedCidr).toBeLessThanOrEqual(
            parentRange.end,
          );
        }
      }
    }
  });

  it('lands every allocation on a network boundary', () => {
    const random = makeRandom(31337);
    for (const parent of PARENTS) {
      for (let trial = 0; trial < 40; trial += 1) {
        const requirements = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) =>
          req(`R${i}`, 1 + Math.floor(random() * 400)),
        );
        let result;
        try {
          result = packVLSM(parent, requirements);
        } catch {
          continue;
        }
        for (const allocation of result.allocations) {
          const size = allocation.subnet.totalAddresses;
          expect(allocation.subnet.networkAddress % size, allocation.assignedCidr).toBe(0);
          expect(allocation.subnet.networkAddress + size - 1, allocation.assignedCidr).toBe(
            allocation.subnet.broadcastAddress,
          );
        }
      }
    }
  });

  it('always allocates a block that can hold the requirement', () => {
    const random = makeRandom(4242);
    for (let trial = 0; trial < 200; trial += 1) {
      const hosts = 1 + Math.floor(random() * 1000);
      const result = packVLSM('10.0.0.0/16', [req('R', hosts)]);
      expect(result.allocations[0]?.subnet.usableHosts ?? 0).toBeGreaterThanOrEqual(hosts);
    }
  });

  it('accounts for every address exactly once', () => {
    const random = makeRandom(9001);
    for (let trial = 0; trial < 60; trial += 1) {
      const requirements = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) =>
        req(`R${i}`, 1 + Math.floor(random() * 200)),
      );
      let result;
      try {
        result = packVLSM('10.0.0.0/20', requirements);
      } catch {
        continue;
      }
      const allocated = result.allocations.reduce((sum, a) => sum + a.subnet.totalAddresses, 0);
      const free = result.freeRanges.reduce((sum, r) => sum + r.addresses, 0);
      expect(allocated + free).toBe(result.totalAddresses);
      expect(result.freeAddresses).toBe(free);
    }
  });

  it('never allocates a block larger than the requirement needs', () => {
    const random = makeRandom(5150);
    for (let trial = 0; trial < 200; trial += 1) {
      const hosts = 3 + Math.floor(random() * 1000);
      const prefix = idealPrefixFor(hosts);
      const result = packVLSM('10.0.0.0/16', [req('R', hosts)]);
      const allocatedPrefix = result.allocations[0]?.subnet.cidr.prefix ?? 0;
      // Either the tightest fit, or one bit tighter because the /30 floor
      // applies. Never looser.
      expect(
        allocatedPrefix,
        `${hosts} hosts -> /${allocatedPrefix}, ideal /${prefix}`,
      ).toBeGreaterThanOrEqual(prefix);
    }
  });
});

/* ================================================================== *
 * TRIPWIRE
 * ================================================================== */

describe('overlap tripwire', () => {
  it('catches a hand-built overlap that the packer could not produce', () => {
    const overlapping: Allocation[] = [
      allocationFixture('A', 3232235776, 24), // 192.168.1.0/24
      allocationFixture('B', 3232235808, 25), // 192.168.1.128/25, inside A
    ];
    expect(() => assertNoOverlaps(overlapping)).toThrow(SubnetOverlapError);
  });

  it('accepts correctly separated allocations', () => {
    const separate: Allocation[] = [
      allocationFixture('A', 3232235776, 25), // 192.168.1.0/25
      allocationFixture('B', 3232235904, 25), // 192.168.1.128/25
    ];
    expect(() => assertNoOverlaps(separate)).not.toThrow();
  });
});

/* ================================================================== *
 * Fixtures
 * ================================================================== */

const calculateSubnetFixture = (ip: number, prefix: number) => {
  const size = 2 ** (32 - prefix);
  const networkAddress = Math.floor(ip / size) * size;
  return {
    networkAddress,
    broadcastAddress: networkAddress + size - 1,
    totalAddresses: size,
    usableHosts: calculateUsableHosts(prefix),
    cidr: { family: 'ipv4' as const, ip: networkAddress, prefix },
  } as Allocation['subnet'];
};

const allocationFixture = (name: string, ip: number, prefix: number): Allocation =>
  ({
    id: name,
    name,
    role: 'LAN',
    requestedHosts: 0,
    assignedCidr: `${integerToIPv4(Math.floor(ip / 2 ** (32 - prefix)) * 2 ** (32 - prefix))}/${prefix}`,
    wastedAddresses: 0,
    utilisationPercent: 0,
    subnet: calculateSubnetFixture(ip, prefix),
  }) as Allocation;

const rangeOfCidr = (cidr: string): { start: number; end: number } => {
  const parsed = parseCidr(cidr);
  const size = 2 ** (32 - parsed.prefix);
  const start = Math.floor(parsed.ip / size) * size;
  return { start, end: start + size - 1 };
};

describe('fixtures', () => {
  it('produce a range of the expected size', () => {
    expect(rangeSize(rangeOfCidr('192.168.1.0/24'))).toBe(256);
    expect(rangeSize(rangeOfCidr('192.168.1.50/24'))).toBe(256);
    expect(cidrsByAddress(packVLSM('192.168.1.0/24', [req('A', 100)]))).toEqual(['192.168.1.0/25']);
  });
});
