/**
 * NetArchitect VLSM allocation engine.
 *
 * PURE MODULE. No React, no React Native, no Expo. Depends only on
 * `ip-engine`, which is itself pure.
 *
 * ## The invariant
 *
 * The packer CANNOT produce overlapping subnets, because it walks the parent
 * address space once with a monotonic cursor and only ever moves forward. Every
 * allocation is aligned to its own size, so each one also lands on a legal
 * network boundary.
 *
 * A `detectOverlap` sweep runs over the finished allocations anyway, purely as
 * a tripwire. It is unreachable by construction, and that is the point: if a
 * future refactor breaks the cursor discipline, the suite goes red rather than
 * the user shipping a plan with two subnets claiming the same addresses.
 */

import type {
  AddressRange,
  Cidr,
  FreeRange,
  Allocation,
  HostRequirement,
  VlsmResult,
} from '../types/network';
import {
  ADDRESS_BITS,
  calculateSubnet,
  calculateSubnetSize,
  calculateUsableHosts,
  cidrRange,
  cidrToMask,
  formatCidr,
  isValidPointToPointPairStart,
  parseCidr,
  rangesOverlap,
  roundPercent,
  smallestBlockForHosts,
  toUint32,
} from './ip-engine';
import { ScopeExhaustionError, SubnetOverlapError } from './errors';
import { STANDARD_REFS } from './standards';

/** A free fragment smaller than a /29 cannot usefully host anything. */
const USABLE_FRAGMENT_SIZE = 8;

/** Requirement roles that should be packed as RFC 3021 point-to-point links. */
const isPointToPointRole = (role: HostRequirement['role']): boolean => role === 'POINT_TO_POINT';

/**
 * Pack requirements into a parent network using Variable Length Subnet Masking.
 *
 * Requirements are sorted largest-first, which is what makes the single-pass
 * cursor approach optimal: a larger block placed later could not have fitted in
 * the gap that a smaller block is skipping over now.
 *
 * @param parent        the parent network. A host address is accepted and
 *                      normalised to its network address.
 * @param requirements  host requirements. Order in the result is allocation
 *                      order, largest first.
 * @throws {ScopeExhaustionError} when the requirements cannot fit. `reason`
 *         distinguishes a total shortfall, which the pre-flight check catches
 *         before any allocation happens, from alignment fragmentation, which
 *         only the greedy pass can discover.
 */
export function packVLSM(
  parent: Cidr | string,
  requirements: readonly HostRequirement[],
): VlsmResult {
  const parentCidr = typeof parent === 'string' ? parseCidr(parent) : parent;
  const parentSubnet = calculateSubnet(parentCidr.ip, parentCidr.prefix);

  const parentStart = parentSubnet.networkAddress;
  const parentEnd = parentSubnet.broadcastAddress;
  const totalAddresses = parentSubnet.totalAddresses;

  // Sort largest-first. Array.prototype.sort is stability-guaranteed since
  // ES2019, so requirements of equal size keep the order the user entered,
  // which makes the result stable and explainable rather than arbitrary.
  const ordered = [...requirements].sort((a, b) => b.requestedHosts - a.requestedHosts);

  // PRE-FLIGHT TOTAL.
  //
  // Sum every block the requirements need and compare against the parent before
  // allocating anything. This catches the overwhelmingly common failure -
  // simply asking for more than the parent holds - and reports it with real
  // totals instead of blaming whichever requirement happened to be packed last.
  //
  // Necessary but NOT sufficient: alignment can strand addresses below a block
  // that then cannot start, so the greedy pass below still has to check.
  const blockSizeFor = (requirement: HostRequirement): number =>
    calculateSubnetSize(
      ADDRESS_BITS -
        smallestBlockForHosts(
          requirement.requestedHosts,
          isPointToPointRole(requirement.role) ? 1 : 2,
        ),
    );

  const requiredTotal = ordered.reduce((sum, requirement) => sum + blockSizeFor(requirement), 0);

  if (requiredTotal > totalAddresses) {
    throw new ScopeExhaustionError(
      null,
      ordered.reduce((sum, r) => sum + r.requestedHosts, 0),
      requiredTotal,
      totalAddresses,
      'INSUFFICIENT_TOTAL',
    );
  }

  const allocations: Allocation[] = [];
  let cursor = parentStart;

  for (const requirement of ordered) {
    const pointToPoint = isPointToPointRole(requirement.role);

    // A /31 reserves no addresses, so its minimum host-bit count is 1. Every
    // other role floors at 2, making a /30 the smallest allocatable LAN subnet.
    const hostBits = smallestBlockForHosts(requirement.requestedHosts, pointToPoint ? 1 : 2);
    const prefix = ADDRESS_BITS - hostBits;
    const blockSize = calculateSubnetSize(prefix);

    // ALIGNMENT. Without this, a /27 allocated after a /25 would start at
    // x.x.x.128 rather than x.x.x.160, producing a subnet whose address is not
    // a legal network boundary. Ceiling the cursor to a multiple of the block
    // size is the whole trick.
    //
    // For a /31 the block size is 2, so this also lands the pair on an even
    // address, which is what RFC 3021 Appendix A requires of a point-to-point
    // link. Both requirements are satisfied by the same expression.
    const start = Math.ceil(cursor / blockSize) * blockSize;
    const end = start + blockSize - 1;

    if (end > parentEnd) {
      // The pre-flight total passed, so this is alignment fragmentation: the
      // blocks add up to no more than the parent, but one of them cannot start
      // where the cursor landed. The addresses stranded below it are the cause,
      // and they are reported as the shortfall so the UI can size a suggestion.
      throw new ScopeExhaustionError(
        requirement.name,
        requirement.requestedHosts,
        blockSize,
        Math.max(0, parentEnd - cursor + 1),
        'ALIGNMENT_FRAGMENTATION',
      );
    }

    // RFC 3021 sanity assertion. Kept as a guard rather than an assumption.
    if (pointToPoint && prefix === 31 && !isValidPointToPointPairStart(start)) {
      throw new ScopeExhaustionError(
        requirement.name,
        requirement.requestedHosts,
        blockSize,
        0,
        'ALIGNMENT_FRAGMENTATION',
      );
    }

    const subnet = calculateSubnet(start, prefix);
    const assignedCidr = formatCidr({ family: 'ipv4', ip: subnet.networkAddress, prefix });

    allocations.push(
      Object.freeze({
        id: requirement.id,
        name: requirement.name,
        role: requirement.role,
        requestedHosts: requirement.requestedHosts,
        subnet,
        assignedCidr,
        wastedAddresses: subnet.usableHosts - requirement.requestedHosts,
        utilisationPercent: roundPercent((requirement.requestedHosts / subnet.usableHosts) * 100),
      }),
    );

    cursor = end + 1;
  }

  // Tripwire. Unreachable while the cursor discipline above holds. If this ever
  // fires, the allocation is wrong regardless of what the arithmetic says.
  assertNoOverlaps(allocations);

  const freeRanges = deriveFreeRanges(allocations, parentStart, parentEnd);
  const allocatedAddresses = allocations.reduce((sum, a) => sum + a.subnet.totalAddresses, 0);
  const freeAddresses = totalAddresses - allocatedAddresses;
  const usableHosts = allocations.reduce((sum, a) => sum + a.subnet.usableHosts, 0);

  return Object.freeze({
    parentCidr: Object.freeze({
      family: 'ipv4' as const,
      ip: parentStart,
      prefix: parentCidr.prefix,
    }),
    allocations: Object.freeze(allocations),
    freeRanges: Object.freeze(freeRanges),
    totalAddresses,
    allocatedAddresses,
    freeAddresses,
    spaceUtilisationPercent: roundPercent((allocatedAddresses / totalAddresses) * 100),
    // Efficiency is measured against ALLOCATED space, not against the parent.
    // Measuring against the parent conflates "tight packing" with "used most of
    // the network", which are different questions and only one of them is about
    // the quality of a VLSM plan.
    hostEfficiencyPercent:
      allocatedAddresses === 0 ? 0 : roundPercent((usableHosts / allocatedAddresses) * 100),
  });
}

/* ------------------------------------------------------------------ *
 * Invariants
 * ------------------------------------------------------------------ */

/** Throw if any two allocations claim intersecting address space. */
export function assertNoOverlaps(allocations: readonly Allocation[]): void {
  for (let i = 0; i < allocations.length; i += 1) {
    for (let j = i + 1; j < allocations.length; j += 1) {
      const a = allocations[i];
      const b = allocations[j];
      if (!a || !b) continue;
      if (rangesOverlap(overlapRange(a), overlapRange(b))) {
        throw new SubnetOverlapError(a.assignedCidr, b.assignedCidr);
      }
    }
  }
}

const overlapRange = (allocation: Allocation): AddressRange =>
  Object.freeze({
    start: allocation.subnet.networkAddress,
    end: allocation.subnet.broadcastAddress,
  });

/**
 * Assert the structural invariants every result must satisfy: no overlaps, and
 * every allocation wholly inside the parent and on a legal network boundary.
 *
 * Tests and callers use this as a post-condition. Production code already
 * guarantees it by construction.
 */
export function assertAllocationsValid(result: VlsmResult): void {
  const parent = calculateSubnet(result.parentCidr.ip, result.parentCidr.prefix);
  const parentRange: AddressRange = { start: parent.networkAddress, end: parent.broadcastAddress };

  for (const allocation of result.allocations) {
    const range = overlapRange(allocation);

    if (range.start < parentRange.start || range.end > parentRange.end) {
      throw new ScopeExhaustionError(`${allocation.name} escapes the parent network`, 0, 0, 0);
    }

    // A subnet definition must have no host bits set in its own address.
    if (allocation.subnet.networkAddress !== cidrRange(allocation.subnet.cidr).start) {
      throw new ScopeExhaustionError(
        `${allocation.assignedCidr} is not on a network boundary`,
        0,
        0,
        0,
      );
    }
  }
  assertNoOverlaps(result.allocations);
}

/* ------------------------------------------------------------------ *
 * Free space
 * ------------------------------------------------------------------ */

/**
 * Walk the parent address space and collect the gaps between allocations.
 *
 * The first allocation always begins exactly at the parent network address,
 * because a parent base is a multiple of every block size that can fit inside
 * it. So gaps only ever appear BETWEEN allocations, plus one trailing range
 * when space remains above the last allocation. A parent with no requirements
 * yields a single free range covering all of it.
 */
export function deriveFreeRanges(
  allocations: readonly Allocation[],
  parentStart: number,
  parentEnd: number,
): readonly FreeRange[] {
  const byAddress = [...allocations].sort(
    (a, b) => a.subnet.networkAddress - b.subnet.networkAddress,
  );
  const ranges: FreeRange[] = [];
  let cursor = parentStart;

  for (const allocation of byAddress) {
    if (allocation.subnet.networkAddress > cursor) {
      ranges.push(makeFreeRange(cursor, allocation.subnet.networkAddress - 1));
    }
    cursor = allocation.subnet.broadcastAddress + 1;
  }
  if (cursor <= parentEnd) {
    ranges.push(makeFreeRange(cursor, parentEnd));
  }
  return Object.freeze(ranges);
}

const makeFreeRange = (start: number, end: number): FreeRange => {
  const size = end - start + 1;
  // The largest legal block that fits at this exact address. Reported as the
  // range's CIDR label; `addresses` remains the true count, which is larger
  // when the gap is not a power of two.
  const prefix = largestAlignedPrefix(start, size);
  return Object.freeze({
    start,
    end,
    addresses: size,
    cidr: formatCidr({ family: 'ipv4', ip: start, prefix }),
    isFragmented: size < USABLE_FRAGMENT_SIZE,
  });
};

/** Deepest prefix whose block is aligned to `start` and fits within `size`. */
const largestAlignedPrefix = (start: number, size: number): number => {
  const alignment = trailingZeroBits(start);
  const bySize = floorLog2(size);
  const hostBits = Math.max(0, Math.min(alignment, bySize));
  return ADDRESS_BITS - hostBits;
};

/**
 * floor(log2(value)) using integer bit operations.
 *
 * Deliberately not `Math.log2`. The IP engine's own rule is that floating point
 * is untrustworthy at the boundaries that matter in subnetting, and the free-
 * range labelling should not be the one place that rule is quietly broken.
 */
const floorLog2 = (value: number): number => {
  if (value < 1) return 0;
  return 31 - Math.clz32(Math.floor(value));
};

/** Number of trailing zero bits, capped at 32 so an address of 0 aligns to anything. */
const trailingZeroBits = (value: number): number => {
  const n = toUint32(value);
  if (n === 0) return ADDRESS_BITS;
  let bits = 0;
  let remaining = n;
  while ((remaining & 1) === 0) {
    bits += 1;
    remaining >>>= 1;
  }
  return bits;
};

/* ------------------------------------------------------------------ *
 * Analysis helpers
 * ------------------------------------------------------------------ */

/** Total host capacity across all allocations, ignoring free space. */
export const totalUsableHosts = (result: VlsmResult): number =>
  result.allocations.reduce((sum, a) => sum + a.subnet.usableHosts, 0);

/** True when the requirements consumed the parent network exactly. */
export const isExhausted = (result: VlsmResult): boolean => result.freeAddresses === 0;

/**
 * The smallest block a single requirement could ever occupy.
 *
 * Used by the planner and Learning Mode to show a user the "best case" size
 * alongside what was actually allocated.
 */
export const idealPrefixFor = (hosts: number, role: HostRequirement['role'] = 'LAN'): number =>
  ADDRESS_BITS - smallestBlockForHosts(hosts, isPointToPointRole(role) ? 1 : 2);

/** Reference attached to findings about point-to-point sizing. */
export const P2P_REFERENCE = STANDARD_REFS.RFC3021;

/** Mask for a prefix, re-exported so callers need only one import for packing maths. */
export { cidrToMask, calculateUsableHosts };
