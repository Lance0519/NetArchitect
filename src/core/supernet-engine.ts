/**
 * Route Summarization (Supernetting) Engine.
 *
 * PURE MODULE. No React, no React Native, no Expo.
 *
 * Calculates the minimal CIDR supernet that summarizes a set of subnets.
 * Analyzes coverage, efficiency, and identifies routing "holes" (unadvertised
 * subnets enclosed in the summary).
 */

import {
  calculateSubnet,
  cidrToMask,
  integerToIPv4,
  parseCidr,
  wildcardFromMask,
} from './ip-engine';

export interface RouteSummaryOutcome {
  readonly kind: 'ok' | 'empty' | 'error';
  readonly message?: string;
  readonly result?: RouteSummaryResult;
}

export interface RouteSummaryResult {
  readonly summaryCidr: string;
  readonly networkAddress: string;
  readonly broadcastAddress: string;
  readonly subnetMask: string;
  readonly totalAddresses: number;
  readonly inputSubnetCount: number;
  readonly coveredAddresses: number;
  readonly holeAddresses: number;
  readonly efficiencyPercent: number;
  readonly holes: readonly string[];
  readonly inputSubnets: readonly string[];
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

/** Merge overlapping or adjacent intervals. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;

    if (current.start <= last.end + 1) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, current.end),
      };
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/** Convert a start-end range [start, end] into minimal CIDR blocks. */
function rangeToCidrs(start: number, end: number): string[] {
  const cidrs: string[] = [];
  let current = start >>> 0;
  const last = end >>> 0;

  while (current <= last) {
    // Find the largest CIDR block starting at `current` that does not exceed `last`
    let maxBits = 0;
    while (maxBits < 32) {
      const bitMask = (1 << maxBits) >>> 0;
      if (maxBits < 31 && (current & bitMask) !== 0) {
        break;
      }
      const nextSize = 2 ** (maxBits + 1);
      if (current + nextSize - 1 > last || nextSize > 0xffffffff) {
        break;
      }
      maxBits++;
    }

    const prefix = 32 - maxBits;
    cidrs.push(`${integerToIPv4(current)}/${prefix}`);
    const size = 2 ** maxBits;
    if (current + size > 0xffffffff) break;
    current = (current + size) >>> 0;
  }

  return cidrs;
}

/**
 * Summarize an array of IPv4 subnets or CIDRs into their optimal summary route.
 */
export function summarizeRoutes(cidrInputs: readonly string[]): RouteSummaryOutcome {
  const cleaned = cidrInputs
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));

  if (cleaned.length === 0) {
    return { kind: 'empty' };
  }

  const parsedIntervals: Interval[] = [];
  const validCidrs: string[] = [];

  for (const input of cleaned) {
    try {
      const cidr = parseCidr(input);
      const info = calculateSubnet(cidr.ip, cidr.prefix);
      parsedIntervals.push({
        start: info.networkAddress,
        end: info.broadcastAddress,
      });
      validCidrs.push(`${integerToIPv4(info.networkAddress)}/${cidr.prefix}`);
    } catch (err) {
      return {
        kind: 'error',
        message: `Invalid subnet "${input}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const merged = mergeIntervals(parsedIntervals);
  const minIp = merged[0]!.start;
  const maxIp = merged[merged.length - 1]!.end;

  // Find common bits between minIp and maxIp
  let summaryPrefix = 0;
  for (let p = 32; p >= 0; p--) {
    const mask = cidrToMask(p);
    const net = (minIp & mask) >>> 0;
    const bcast = (net | wildcardFromMask(mask)) >>> 0;
    if (minIp >= net && maxIp <= bcast) {
      summaryPrefix = p;
      break;
    }
  }

  const summaryMask = cidrToMask(summaryPrefix);
  const summaryNet = (minIp & summaryMask) >>> 0;
  const summaryBcast = (summaryNet | wildcardFromMask(summaryMask)) >>> 0;
  const totalAddresses = 2 ** (32 - summaryPrefix);

  // Calculate covered addresses from merged intervals
  let coveredAddresses = 0;
  for (const interval of merged) {
    coveredAddresses += interval.end - interval.start + 1;
  }

  const holeAddresses = Math.max(0, totalAddresses - coveredAddresses);
  const efficiencyPercent =
    totalAddresses > 0 ? Math.round((coveredAddresses / totalAddresses) * 10000) / 100 : 0;

  // Calculate specific hole intervals within [summaryNet, summaryBcast]
  const holeCidrs: string[] = [];
  let pointer = summaryNet;

  for (const interval of merged) {
    if (interval.start > pointer) {
      const gapStart = pointer;
      const gapEnd = interval.start - 1;
      holeCidrs.push(...rangeToCidrs(gapStart, gapEnd));
    }
    pointer = Math.max(pointer, interval.end + 1);
  }

  if (pointer <= summaryBcast) {
    holeCidrs.push(...rangeToCidrs(pointer, summaryBcast));
  }

  return {
    kind: 'ok',
    result: {
      summaryCidr: `${integerToIPv4(summaryNet)}/${summaryPrefix}`,
      networkAddress: integerToIPv4(summaryNet),
      broadcastAddress: integerToIPv4(summaryBcast),
      subnetMask: integerToIPv4(summaryMask),
      totalAddresses,
      inputSubnetCount: validCidrs.length,
      coveredAddresses,
      holeAddresses,
      efficiencyPercent,
      holes: holeCidrs,
      inputSubnets: validCidrs,
    },
  };
}
