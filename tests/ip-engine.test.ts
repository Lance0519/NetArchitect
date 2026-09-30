/**
 * IPv4 engine test suite.
 *
 * The central safety property of this file: it does not trust the engine.
 *
 * `REFERENCE` below is a deliberately independent implementation that works in
 * 32-character bit strings rather than 32-bit integers, and is evaluated over
 * every prefix from 0 to 32. If the engine's `>>> 0` discipline ever breaks, or
 * the `prefix === 0` shift guard regresses, the sweep catches it against a
 * method that cannot share the same mistake.
 */

import { describe, expect, it } from 'vitest';

import {
  ADDRESS_BITS,
  MAX_ADDRESS_COUNT,
  U32_MAX,
  assertNetworkBoundary,
  calculateBroadcastAddress,
  calculateHostRange,
  calculateNetworkAddress,
  calculateSubnet,
  calculateSubnetMask,
  calculateSubnetSize,
  calculateUsableHosts,
  calculateUtilization,
  calculateWildcardMask,
  computeHostAllocation,
  calculateHostBits,
  calculateNetworkBits,
  cidrRange,
  cidrToMask,
  classifyAddress,
  classifyAddressSpace,
  detectOverlap,
  formatCidr,
  integerToIPv4,
  isNetworkBoundary,
  isPrivateAddress,
  isPublicAddress,
  isValidCidr,
  isValidIPv4,
  isValidPointToPointPairStart,
  isValidSubnetMask,
  isWithin,
  maskToCidr,
  minimumParentPrefix,
  parseCidr,
  parseIPv4,
  parsePrefix,
  rangeOf,
  rangeSize,
  rangesOverlap,
  roundPercent,
  smallestBlockForHosts,
  smallestPrefixForHosts,
  toAddress,
  toUint32,
  wildcardFromMask,
} from '../src/core/ip-engine';
import {
  InvalidCIDRError,
  InvalidIPv4Error,
  InvalidPrefixError,
  InvalidSubnetBoundaryError,
  ScopeExhaustionError,
} from '../src/core/errors';

/* ================================================================== *
 * INDEPENDENT REFERENCE IMPLEMENTATION
 * Bit-string based. Shares no logic with the engine.
 * ================================================================== */

const bitsToIp = (bits: string): string => {
  const parts: number[] = [];
  for (let i = 0; i < bits.length; i += 8) parts.push(parseInt(bits.slice(i, i + 8), 2));
  return parts.join('.');
};

const ipToBits = (ip: string): string =>
  ip
    .split('.')
    .map((o) => parseInt(o, 10).toString(2).padStart(8, '0'))
    .join('');

/** Mask as a 32-char string: `prefix` ones then zeros. */
const refMaskBits = (prefix: number): string =>
  '1'.repeat(prefix) + '0'.repeat(ADDRESS_BITS - prefix);

const toBits = (value: number): string => toUint32(value).toString(2).padStart(ADDRESS_BITS, '0');

const refNetwork = (ip: string, prefix: number): string => {
  const bits = ipToBits(ip);
  return bitsToIp(
    refMaskBits(prefix)
      .split('')
      .map((m, i) => (m === '1' ? bits[i] : '0'))
      .join(''),
  );
};

const refBroadcast = (ip: string, prefix: number): string => {
  const bits = ipToBits(ip);
  return bitsToIp(
    refMaskBits(prefix)
      .split('')
      .map((m, i) => (m === '1' ? bits[i] : '1'))
      .join(''),
  );
};

const refUsable = (prefix: number): number => {
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return 2 ** (ADDRESS_BITS - prefix) - 2;
};

/**
 * Read or write a slot in the reference carry buffer, or fail loudly.
 *
 * `noUncheckedIndexedAccess` makes `array[i]` `number | undefined`. The tempting
 * fix is `?? 0`, and it would be the wrong one: this file is the *oracle* the
 * engine is checked against, so a helper that quietly invents a value could
 * make a broken engine agree with a broken test. An out-of-range index here is
 * a bug in the test and must announce itself.
 */
const refAt = (octets: readonly number[], index: number): number => {
  const value = octets[index];
  if (value === undefined) {
    throw new Error(`reference helper: no octet at index ${index} of [${octets.join('.')}]`);
  }
  return value;
};

const refSet = (octets: number[], index: number, value: number): void => {
  if (index < 0 || index >= octets.length) {
    throw new Error(`reference helper: cannot write index ${index} of [${octets.join('.')}]`);
  }
  octets[index] = value;
};

/**
 * Increment or decrement an address using base-256 array carry.
 *
 * Deliberately does no 32-bit integer arithmetic, so it cannot share a bug with
 * the engine's `>>> 0` discipline.
 */
const refShift = (ip: string, delta: number): string => {
  const [a, b, c, d] = ip.split('.');
  const octets: number[] = [Number(a), Number(b), Number(c), Number(d)];
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`reference helper: "${ip}" is not a dotted quad`);
  }

  for (let step = 0; step < Math.abs(delta); step += 1) {
    for (let i = 3; i >= 0; i -= 1) {
      if (delta > 0) {
        if (refAt(octets, i) < 255) {
          refSet(octets, i, refAt(octets, i) + 1);
          break;
        }
        refSet(octets, i, 0);
      } else {
        if (refAt(octets, i) > 0) {
          refSet(octets, i, refAt(octets, i) - 1);
          break;
        }
        refSet(octets, i, 255);
      }
    }
  }
  return octets.join('.');
};

const refFirstHost = (ip: string, prefix: number): string =>
  prefix >= 31 ? refNetwork(ip, prefix) : refShift(refNetwork(ip, prefix), 1);

const refLastHost = (ip: string, prefix: number): string =>
  prefix >= 31 ? refBroadcast(ip, prefix) : refShift(refBroadcast(ip, prefix), -1);

const ALL_PREFIXES = Array.from({ length: 33 }, (_, i) => i);
const SAMPLE_IPS = [
  '0.0.0.0',
  '255.255.255.255',
  '192.168.1.50',
  '10.0.0.1',
  '172.16.5.9',
  '1.2.3.4',
  '128.0.0.1',
  '223.255.255.254',
];

/* ================================================================== *
 * Parsing
 * ================================================================== */

describe('parseIPv4', () => {
  it('converts dotted quads to unsigned integers', () => {
    expect(parseIPv4('0.0.0.0')).toBe(0);
    expect(parseIPv4('0.0.0.1')).toBe(1);
    expect(parseIPv4('192.168.1.0')).toBe(3232235776);
    expect(parseIPv4('192.168.1.50')).toBe(3232235826);
    expect(parseIPv4('255.255.255.255')).toBe(4294967295);
  });

  it('matches an independent reference for every octet of 255.255.255.255', () => {
    expect(parseIPv4('255.255.255.255')).toBe(2 ** 32 - 1);
  });

  it('trims surrounding whitespace', () => {
    expect(parseIPv4('  192.168.1.1  ')).toBe(parseIPv4('192.168.1.1'));
  });

  describe('rejects', () => {
    const invalid = [
      ['256.1.1.1', 'octet above 255'],
      ['1.2.3', 'too few octets'],
      ['1.2.3.4.5', 'too many octets'],
      ['1.2.3.', 'trailing dot'],
      ['.1.2.3', 'leading dot'],
      ['', 'empty'],
      ['   ', 'whitespace only'],
      ['1.2.3.a', 'non-numeric octet'],
      ['1.2.3.-1', 'negative octet'],
      ['1.2.3.4/24', 'cidr passed to parseIPv4'],
      ['010.1.1.1', 'leading zero is ambiguous with octal'],
      ['1.02.3.4', 'leading zero is ambiguous with octal'],
      ['1.2.3.4 5', 'space inside address'],
      ['1..2.3', 'empty octet'],
      ['1.2.3.+4', 'signed octet'],
      ['1.2.3.1e2', 'scientific notation'],
    ] as const;

    it.each(invalid)('%s (%s)', (input) => {
      expect(() => parseIPv4(input)).toThrow(InvalidIPv4Error);
    });
  });

  it('gives a friendly message for the UI', () => {
    expect(() => parseIPv4('nope')).toThrow('Enter a valid IPv4 address.');
  });

  it('isValidIPv4 does not throw', () => {
    expect(isValidIPv4('192.168.1.1')).toBe(true);
    expect(isValidIPv4('999.1.1.1')).toBe(false);
  });
});

describe('parseCidr', () => {
  it('accepts dotted quad with prefix', () => {
    expect(parseCidr('192.168.1.0/24')).toEqual({ family: 'ipv4', ip: 3232235776, prefix: 24 });
  });

  it('accepts a host address as a CIDR reference', () => {
    // 192.168.1.50/24 is a valid reference to an address inside a network.
    // Only subnet *definitions* require a network boundary.
    expect(parseCidr('192.168.1.50/24').ip).toBe(3232235826);
  });

  it('accepts the full prefix range', () => {
    expect(parseCidr('0.0.0.0/0').prefix).toBe(0);
    expect(parseCidr('255.255.255.255/32').prefix).toBe(32);
  });

  it('rejects malformed notation', () => {
    expect(() => parseCidr('192.168.1.0')).toThrow(InvalidCIDRError);
    expect(() => parseCidr('192.168.1.0/')).toThrow(InvalidCIDRError);
    expect(() => parseCidr('/24')).toThrow(InvalidCIDRError);
    expect(() => parseCidr('192.168.1.0/33')).toThrow(InvalidPrefixError);
    // A negative prefix is a prefix problem, not a notation problem.
    expect(() => parseCidr('192.168.1.0/-1')).toThrow(InvalidPrefixError);
    expect(() => parseCidr('192.168.1.0/24/8')).toThrow(InvalidCIDRError);
  });
});

describe('parsePrefix', () => {
  it('accepts bare, slashed, and string forms', () => {
    expect(parsePrefix(24)).toBe(24);
    expect(parsePrefix('24')).toBe(24);
    expect(parsePrefix('/24')).toBe(24);
    expect(parsePrefix(' 0 ')).toBe(0);
    expect(parsePrefix(32)).toBe(32);
  });

  it('rejects out-of-range and non-integer prefixes', () => {
    for (const bad of [-1, 33, 100, 2.5, Number.NaN, '24.5', '', 'abc', '0x18']) {
      expect(() => parsePrefix(bad as string | number)).toThrow(InvalidPrefixError);
    }
  });

  it('uses the spec wording', () => {
    expect(() => parsePrefix(99)).toThrow('CIDR must be between /0 and /32.');
  });
});

/* ================================================================== *
 * Conversion round trip
 * ================================================================== */

describe('ip <-> integer conversion', () => {
  it('reverses exactly for representative addresses', () => {
    for (const ip of SAMPLE_IPS) {
      expect(integerToIPv4(parseIPv4(ip))).toBe(ip);
    }
  });

  it('round-trips across the signed int32 boundary', () => {
    // 2^31 is the first value that turns negative under signed coercion.
    // 2^31 - 1 is the last that does not.
    const boundary = [0, 1, 2147483647, 2147483648, 2147483649, 4294967294, 4294967295];
    for (const value of boundary) {
      expect(parseIPv4(integerToIPv4(value))).toBe(value);
    }
    expect(integerToIPv4(2147483647)).toBe('127.255.255.255');
    expect(integerToIPv4(2147483648)).toBe('128.0.0.0');
  });

  it('round-trips a deterministic sweep of 5000 values', () => {
    for (let i = 0; i < 5000; i += 1) {
      // Multiply by 858993 to spread samples across the whole 32-bit space
      // while staying exact in a double.
      const value = (i * 858993) % MAX_ADDRESS_COUNT;
      expect(parseIPv4(integerToIPv4(value))).toBe(value);
    }
  });

  it('re-interprets negative signed int32 as unsigned', () => {
    expect(toUint32(-1)).toBe(4294967295);
    expect(toUint32(-2147483648)).toBe(2147483648);
  });

  it('rejects values outside 32-bit unsigned range', () => {
    expect(() => toUint32(4294967296)).toThrow(RangeError);
    expect(() => toUint32(1.5)).toThrow(TypeError);
  });
});

/* ================================================================== *
 * Masks
 * ================================================================== */

describe('masks', () => {
  it('matches the reference for every prefix', () => {
    for (const prefix of ALL_PREFIXES) {
      expect(toBits(cidrToMask(prefix))).toBe(refMaskBits(prefix));
    }
  });

  it('produces a zero mask for /0 (the JS shift-by-32 trap)', () => {
    // `0xffffffff << 32` is `0xffffffff << 0` in JavaScript, which is 0xffffffff.
    // If the guard in cidrToMask is ever removed, this is the test that fails.
    expect(cidrToMask(0)).toBe(0);
    expect(cidrToMask(0)).not.toBe(0xffffffff);
  });

  it('produces an all-ones mask for /32', () => {
    expect(cidrToMask(32)).toBe(U32_MAX);
  });

  it('produces well-known masks', () => {
    expect(integerToIPv4(cidrToMask(8))).toBe('255.0.0.0');
    expect(integerToIPv4(cidrToMask(16))).toBe('255.255.0.0');
    expect(integerToIPv4(cidrToMask(24))).toBe('255.255.255.0');
    expect(integerToIPv4(cidrToMask(30))).toBe('255.255.255.252');
    expect(integerToIPv4(cidrToMask(31))).toBe('255.255.255.254');
  });

  it('wildcard is the exact bitwise complement for every prefix', () => {
    for (const prefix of ALL_PREFIXES) {
      const mask = cidrToMask(prefix);
      const wildcard = calculateWildcardMask(prefix);
      expect((mask | wildcard) >>> 0).toBe(U32_MAX);
      expect((mask & wildcard) >>> 0).toBe(0);
    }
  });

  it('produces well-known wildcard masks', () => {
    expect(integerToIPv4(calculateWildcardMask(24))).toBe('0.0.0.255');
    expect(integerToIPv4(calculateWildcardMask(0))).toBe('255.255.255.255');
    expect(integerToIPv4(calculateWildcardMask(32))).toBe('0.0.0.0');
  });

  it('maskToCidr inverts cidrToMask for every prefix', () => {
    for (const prefix of ALL_PREFIXES) {
      expect(maskToCidr(cidrToMask(prefix))).toBe(prefix);
    }
  });

  it('rejects non-contiguous masks', () => {
    expect(() => maskToCidr(parseIPv4('255.0.255.0'))).toThrow(RangeError);
    expect(isValidSubnetMask(parseIPv4('255.255.255.0'))).toBe(true);
    expect(isValidSubnetMask(parseIPv4('255.0.255.0'))).toBe(false);
  });
});

/* ================================================================== *
 * The /0 - /32 sweep against the independent reference
 * ================================================================== */

describe('full prefix sweep against reference implementation', () => {
  for (const ip of SAMPLE_IPS) {
    it(`resolves every prefix correctly for ${ip}`, () => {
      for (const prefix of ALL_PREFIXES) {
        const subnet = calculateSubnet(ip, prefix);
        const label = `${ip}/${prefix}`;

        expect(integerToIPv4(subnet.networkAddress), label).toBe(refNetwork(ip, prefix));
        expect(integerToIPv4(subnet.broadcastAddress), label).toBe(refBroadcast(ip, prefix));
        expect(integerToIPv4(subnet.firstUsableHost), label).toBe(refFirstHost(ip, prefix));
        expect(integerToIPv4(subnet.lastUsableHost), label).toBe(refLastHost(ip, prefix));
        expect(subnet.usableHosts, label).toBe(refUsable(prefix));
        expect(subnet.totalAddresses, label).toBe(2 ** (ADDRESS_BITS - prefix));
        expect(subnet.hostBits, label).toBe(ADDRESS_BITS - prefix);
        expect(subnet.networkBits, label).toBe(prefix);
        expect(subnet.subnetMask, label).toBe(cidrToMask(prefix));
        expect(subnet.wildcardMask, label).toBe(calculateWildcardMask(prefix));
        expect(subnet.isHostRoute, label).toBe(prefix === 32);
        expect(subnet.isPointToPoint, label).toBe(prefix === 31);
      }
    });
  }

  it('usable count always agrees with the range it describes', () => {
    for (const ip of SAMPLE_IPS) {
      for (const prefix of ALL_PREFIXES) {
        const subnet = calculateSubnet(ip, prefix);
        expect(subnet.lastUsableHost - subnet.firstUsableHost + 1).toBe(subnet.usableHosts);
      }
    }
  });

  it('network and broadcast always bound the usable range', () => {
    for (const ip of SAMPLE_IPS) {
      for (const prefix of ALL_PREFIXES) {
        const subnet = calculateSubnet(ip, prefix);
        expect(subnet.firstUsableHost).toBeGreaterThanOrEqual(subnet.networkAddress);
        expect(subnet.lastUsableHost).toBeLessThanOrEqual(subnet.broadcastAddress);
        expect(subnet.broadcastAddress - subnet.networkAddress + 1).toBe(subnet.totalAddresses);
      }
    }
  });
});

/* ================================================================== *
 * The specification's worked example
 * ================================================================== */

describe('specification example: 192.168.1.50/24', () => {
  const subnet = calculateSubnet('192.168.1.50', 24);

  it('matches every field in the spec', () => {
    expect(integerToIPv4(subnet.networkAddress)).toBe('192.168.1.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('192.168.1.255');
    expect(integerToIPv4(subnet.firstUsableHost)).toBe('192.168.1.1');
    expect(integerToIPv4(subnet.lastUsableHost)).toBe('192.168.1.254');
    expect(subnet.totalAddresses).toBe(256);
    expect(subnet.usableHosts).toBe(254);
    expect(subnet.hostBits).toBe(8);
    expect(subnet.networkBits).toBe(24);
  });

  it('reports the correct masks', () => {
    expect(integerToIPv4(subnet.subnetMask)).toBe('255.255.255.0');
    expect(integerToIPv4(subnet.wildcardMask)).toBe('0.0.0.255');
  });
});

/* ================================================================== *
 * Special cases called out in the spec
 * ================================================================== */

describe('special prefix handling', () => {
  it('/0 covers the entire address space', () => {
    const subnet = calculateSubnet('1.2.3.4', 0);
    expect(integerToIPv4(subnet.networkAddress)).toBe('0.0.0.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('255.255.255.255');
    expect(integerToIPv4(subnet.firstUsableHost)).toBe('0.0.0.1');
    expect(integerToIPv4(subnet.lastUsableHost)).toBe('255.255.255.254');
    expect(subnet.totalAddresses).toBe(4294967296);
    expect(subnet.usableHosts).toBe(4294967294);
    expect(subnet.subnetMask).toBe(0);
    expect(subnet.wildcardMask).toBe(U32_MAX);
    expect(subnet.isHostRoute).toBe(false);
    expect(subnet.isPointToPoint).toBe(false);
  });

  it('/0 total equals 2^32 and stays an exact double', () => {
    expect(MAX_ADDRESS_COUNT).toBe(4294967296);
    expect(calculateSubnetSize(0)).toBe(4294967296);
    expect(Number.isSafeInteger(MAX_ADDRESS_COUNT)).toBe(true);
  });

  it('/1 splits the space in half on the top bit', () => {
    const subnet = calculateSubnet('192.168.1.50', 1);
    expect(integerToIPv4(subnet.networkAddress)).toBe('128.0.0.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('255.255.255.255');
    expect(subnet.usableHosts).toBe(2147483646);
  });

  it('/8 for 10.0.0.0/8', () => {
    const subnet = calculateSubnet('10.0.0.0', 8);
    expect(integerToIPv4(subnet.networkAddress)).toBe('10.0.0.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('10.255.255.255');
    expect(subnet.usableHosts).toBe(16777214);
    expect(subnet.addressSpace).toBe('private');
  });

  it('/12 boundary for 172.16.0.0/12 covers 172.16 - 172.31', () => {
    const subnet = calculateSubnet('172.16.0.0', 12);
    expect(integerToIPv4(subnet.networkAddress)).toBe('172.16.0.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('172.31.255.255');
    expect(subnet.addressSpace).toBe('private');
  });

  it('/12 UPPER boundary: 172.31.255.255 is still private', () => {
    expect(classifyAddressSpace('172.31.255.255')).toBe('private');
    expect(classifyAddressSpace('172.31.0.0')).toBe('private');
  });

  it('/12 boundary: 172.32.0.0 is PUBLIC, the most common addressing mistake', () => {
    expect(classifyAddressSpace('172.32.0.0')).toBe('public');
    expect(classifyAddressSpace('172.15.255.255')).toBe('public');
  });

  it('/16 for 192.168.1.0/24 as a /16', () => {
    const subnet = calculateSubnet('192.168.1.0', 16);
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('192.168.255.255');
    expect(subnet.usableHosts).toBe(65534);
  });

  it('/30 reserves network and broadcast, leaving exactly 2', () => {
    const subnet = calculateSubnet('192.168.1.0', 30);
    expect(integerToIPv4(subnet.networkAddress)).toBe('192.168.1.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('192.168.1.3');
    expect(integerToIPv4(subnet.firstUsableHost)).toBe('192.168.1.1');
    expect(integerToIPv4(subnet.lastUsableHost)).toBe('192.168.1.2');
    expect(subnet.usableHosts).toBe(2);
  });

  it('/31 follows RFC 3021: both addresses usable, no reserved network or broadcast', () => {
    const subnet = calculateSubnet('192.168.1.0', 31);
    expect(integerToIPv4(subnet.networkAddress)).toBe('192.168.1.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('192.168.1.1');
    expect(integerToIPv4(subnet.firstUsableHost)).toBe('192.168.1.0');
    expect(integerToIPv4(subnet.lastUsableHost)).toBe('192.168.1.1');
    expect(subnet.usableHosts).toBe(2);
    expect(subnet.isPointToPoint).toBe(true);
  });

  it('/31 pair must start on an even address per RFC 3021 Appendix A', () => {
    expect(isValidPointToPointPairStart(parseIPv4('192.168.1.0'))).toBe(true);
    expect(isValidPointToPointPairStart(parseIPv4('192.168.1.2'))).toBe(true);
    expect(isValidPointToPointPairStart(parseIPv4('192.168.1.1'))).toBe(false);
    expect(isValidPointToPointPairStart(parseIPv4('192.168.1.3'))).toBe(false);
  });

  it('/32 is a host route where every address field is the address', () => {
    const subnet = calculateSubnet('192.168.1.50', 32);
    expect(integerToIPv4(subnet.networkAddress)).toBe('192.168.1.50');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('192.168.1.50');
    expect(integerToIPv4(subnet.firstUsableHost)).toBe('192.168.1.50');
    expect(integerToIPv4(subnet.lastUsableHost)).toBe('192.168.1.50');
    expect(subnet.totalAddresses).toBe(1);
    expect(subnet.usableHosts).toBe(1);
    expect(subnet.hostBits).toBe(0);
    expect(subnet.isHostRoute).toBe(true);
  });

  it('handles the extreme addresses', () => {
    expect(integerToIPv4(calculateSubnet('0.0.0.0', 32).networkAddress)).toBe('0.0.0.0');
    expect(integerToIPv4(calculateSubnet('255.255.255.255', 32).networkAddress)).toBe(
      '255.255.255.255',
    );
    // The maximum address must not overflow when the broadcast is computed.
    expect(integerToIPv4(calculateSubnet('255.255.255.255', 32).broadcastAddress)).toBe(
      '255.255.255.255',
    );
  });

  it('rejects prefixes outside 0-32', () => {
    for (const bad of [-1, 33, 64, 2.5, Number.NaN]) {
      expect(() => calculateSubnet('192.168.1.1', bad as number)).toThrow(InvalidPrefixError);
    }
  });
});

/* ================================================================== *
 * Address space classification
 * ================================================================== */

describe('address space classification', () => {
  const cases: readonly [string, string][] = [
    ['0.0.0.0', 'this_network'],
    ['0.255.255.255', 'this_network'],
    ['10.0.0.0', 'private'],
    ['10.255.255.255', 'private'],
    ['172.16.0.0', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.0.0', 'private'],
    ['192.168.255.255', 'private'],
    ['100.64.0.0', 'cgnat'],
    ['100.127.255.255', 'cgnat'],
    ['100.128.0.0', 'public'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback'],
    ['169.254.1.1', 'link_local'],
    ['169.254.255.255', 'link_local'],
    ['192.0.0.1', 'ietf_protocol_assignments'],
    ['192.0.2.1', 'documentation'],
    ['198.51.100.1', 'documentation'],
    ['203.0.113.1', 'documentation'],
    ['198.18.0.1', 'benchmark'],
    ['198.19.255.255', 'benchmark'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],
    ['172.15.255.255', 'public'],
    ['172.32.0.0', 'public'],
    ['192.169.0.0', 'public'],
    ['11.0.0.0', 'public'],
    ['9.255.255.255', 'public'],
  ];

  it.each(cases)('classifies %s as %s', (ip, expected) => {
    expect(classifyAddressSpace(ip)).toBe(expected);
  });

  it('returns a citation for every classification', () => {
    for (const [ip] of cases) {
      const classification = classifyAddress(ip);
      expect(classification.label.length).toBeGreaterThan(0);
      expect(classification.citation).toMatch(/^(RFC|IEEE|NIST|CIS)/);
    }
  });

  it('gives private space actionable guidance and public space none', () => {
    expect(classifyAddress('192.168.1.1').guidance).toContain('RFC 1918');
    expect(classifyAddress('8.8.8.8').guidance).toBeNull();
  });
});

/* ================================================================== *
 * Overlap and containment
 * ================================================================== */

describe('overlap detection', () => {
  const cidr = (s: string) => parseCidr(s);

  it('detects identical ranges', () => {
    expect(detectOverlap(cidr('192.168.1.0/24'), cidr('192.168.1.0/24'))).toBe(true);
  });

  it('detects containment in both directions', () => {
    expect(detectOverlap(cidr('192.168.1.0/24'), cidr('192.168.1.128/25'))).toBe(true);
    expect(detectOverlap(cidr('192.168.1.128/25'), cidr('192.168.1.0/24'))).toBe(true);
  });

  it('treats adjacent sibling subnets as non-overlapping', () => {
    // The classic false positive: /25 siblings share no addresses.
    expect(detectOverlap(cidr('192.168.1.0/25'), cidr('192.168.1.128/25'))).toBe(false);
    expect(detectOverlap(cidr('192.168.1.0/26'), cidr('192.168.1.64/26'))).toBe(false);
  });

  it('detects fully disjoint ranges', () => {
    expect(detectOverlap(cidr('10.0.0.0/24'), cidr('10.0.1.0/24'))).toBe(false);
  });

  it('handles a /0 spanning everything', () => {
    expect(detectOverlap(cidr('0.0.0.0/0'), cidr('10.0.0.0/8'))).toBe(true);
    expect(detectOverlap(cidr('0.0.0.0/0'), cidr('0.0.0.0/0'))).toBe(true);
  });

  it('overlaps identical /31 and /32 blocks', () => {
    expect(detectOverlap(cidr('192.168.1.0/31'), cidr('192.168.1.0/31'))).toBe(true);
    expect(detectOverlap(cidr('192.168.1.5/32'), cidr('192.168.1.5/32'))).toBe(true);
    expect(detectOverlap(cidr('192.168.1.4/31'), cidr('192.168.1.6/31'))).toBe(false);
  });

  it('normalises host addresses before comparing', () => {
    // 192.168.1.50/25 normalises to 192.168.1.0/25, which does overlap the /24.
    expect(detectOverlap(cidr('192.168.1.50/25'), cidr('192.168.1.0/24'))).toBe(true);
  });

  it('rangesOverlap is the underlying primitive', () => {
    expect(rangesOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(true);
    expect(rangesOverlap({ start: 0, end: 10 }, { start: 11, end: 20 })).toBe(false);
  });

  it('computes range size inclusively', () => {
    expect(rangeSize(cidrRange(cidr('192.168.1.0/24')))).toBe(256);
    expect(rangeSize(cidrRange(cidr('192.168.1.0/30')))).toBe(4);
    expect(rangeSize(cidrRange(cidr('192.168.1.0/32')))).toBe(1);
  });

  it('checks containment against a parent', () => {
    expect(isWithin(cidr('192.168.1.128/25'), cidr('192.168.1.0/24'))).toBe(true);
    expect(isWithin(cidr('192.168.2.0/24'), cidr('192.168.1.0/24'))).toBe(false);
  });
});

/* ================================================================== *
 * Boundaries
 * ================================================================== */

describe('network boundaries', () => {
  it('recognises a valid subnet definition', () => {
    expect(isNetworkBoundary(parseCidr('192.168.1.0/24'))).toBe(true);
    expect(isNetworkBoundary(parseCidr('10.0.0.0/8'))).toBe(true);
    expect(isNetworkBoundary(parseCidr('192.168.1.50/32'))).toBe(true);
    expect(isNetworkBoundary(parseCidr('0.0.0.0/0'))).toBe(true);
  });

  it('rejects a subnet definition with host bits set', () => {
    expect(isNetworkBoundary(parseCidr('192.168.1.50/24'))).toBe(false);
    expect(isNetworkBoundary(parseCidr('10.0.0.1/8'))).toBe(false);
  });

  it('assertNetworkBoundary passes through valid input', () => {
    const cidr = parseCidr('192.168.1.0/24');
    expect(assertNetworkBoundary(cidr)).toBe(cidr);
  });

  it('assertNetworkBoundary explains what to use instead', () => {
    expect(() => assertNetworkBoundary(parseCidr('192.168.1.50/24'))).toThrow(
      InvalidSubnetBoundaryError,
    );
    // The suggestion is a complete CIDR. A bare address would leave the reader
    // unable to tell whether the prefix survived the correction.
    expect(() => assertNetworkBoundary(parseCidr('192.168.1.50/24'))).toThrow(
      'Use 192.168.1.0/24 instead.',
    );
    expect(() => assertNetworkBoundary(parseCidr('10.0.0.1/30'))).toThrow(
      '10.0.0.1/30 is not a network address. Use 10.0.0.0/30 instead.',
    );
  });
});

/* ================================================================== *
 * Sizing
 * ================================================================== */

describe('smallestBlockForHosts', () => {
  it('matches the specification examples', () => {
    expect(smallestPrefixForHosts(100)).toBe(25);
    expect(smallestPrefixForHosts(50)).toBe(26);
    expect(smallestPrefixForHosts(25)).toBe(27);
    expect(smallestPrefixForHosts(10)).toBe(28);
  });

  it('handles exact powers of two minus two, where float log2 fails', () => {
    // 2^n - 2 is exactly representable and sits on the boundary. Math.log2
    // returns n - epsilon here, and Math.ceil rounds up to the wrong answer.
    for (const bits of [2, 3, 4, 5, 6, 7, 8, 16]) {
      const hosts = 2 ** bits - 2;
      expect(smallestPrefixForHosts(hosts), `${hosts} hosts`).toBe(32 - bits);
    }
  });

  it('handles one more than exact fit', () => {
    for (const bits of [2, 3, 4, 7]) {
      expect(smallestPrefixForHosts(2 ** bits - 1)).toBe(32 - (bits + 1));
    }
  });

  it('never floors a LAN subnet below /30', () => {
    expect(smallestPrefixForHosts(1)).toBe(30);
    expect(smallestPrefixForHosts(2)).toBe(30);
  });

  it('allows /31 for point-to-point links per RFC 3021', () => {
    expect(smallestPrefixForHosts(2, 1)).toBe(31);
    expect(smallestBlockForHosts(2, 1)).toBe(1);
  });

  it('scales to large networks', () => {
    expect(smallestPrefixForHosts(1000)).toBe(22);
    expect(smallestPrefixForHosts(65534)).toBe(16);
  });

  it('rejects non-positive host counts', () => {
    for (const bad of [0, -1, -100, 1.5, Number.NaN]) {
      expect(() => smallestBlockForHosts(bad as number)).toThrow(
        'Required hosts must be greater than 0.',
      );
    }
  });

  it('rejects a requirement too large for any single IPv4 subnet', () => {
    expect(() => smallestBlockForHosts(2 ** 31)).toThrow(ScopeExhaustionError);
  });

  it('always produces a block that can hold the requirement', () => {
    for (let hosts = 1; hosts <= 5000; hosts += 1) {
      const prefix = smallestPrefixForHosts(hosts);
      expect(calculateUsableHosts(prefix), `${hosts} hosts -> /${prefix}`).toBeGreaterThanOrEqual(
        hosts,
      );
    }
  });

  it('never allocates a block larger than necessary, or VLSM wastes the space', () => {
    // A LARGER prefix is a SMALLER block. So the minimality check looks at
    // prefix + 1: if that smaller block cannot hold the hosts, then the chosen
    // prefix really is the tightest fit.
    for (let hosts = 1; hosts <= 5000; hosts += 1) {
      const prefix = smallestPrefixForHosts(hosts);
      // Skip anything already at the floor: a LAN block is never smaller than
      // a /30 (2 usable), so for 1-2 hosts the /30 is correct by construction
      // and there is no tighter block to compare against.
      if (32 - prefix <= 2) continue;
      expect(calculateUsableHosts(prefix + 1), `${hosts} hosts -> /${prefix}`).toBeLessThan(hosts);
    }
  });
});

/* ================================================================== *
 * Derived helpers
 * ================================================================== */

describe('derive network and broadcast independently', () => {
  it('agrees with calculateSubnet', () => {
    for (const ip of SAMPLE_IPS) {
      for (const prefix of ALL_PREFIXES) {
        expect(calculateNetworkAddress(ip, prefix)).toBe(
          calculateSubnet(ip, prefix).networkAddress,
        );
        expect(calculateBroadcastAddress(ip, prefix)).toBe(
          calculateSubnet(ip, prefix).broadcastAddress,
        );
      }
    }
  });

  it('computes a host range matching the subnet', () => {
    const range = calculateHostRange('192.168.1.50', 24);
    expect(integerToIPv4(range.start)).toBe('192.168.1.1');
    expect(integerToIPv4(range.end)).toBe('192.168.1.254');
  });

  it('calculateUsableHosts agrees with calculateSubnet for every prefix', () => {
    for (const prefix of ALL_PREFIXES) {
      expect(calculateUsableHosts(prefix)).toBe(calculateSubnet('192.168.1.1', prefix).usableHosts);
    }
  });
});

describe('calculateUtilization', () => {
  it('computes a percentage', () => {
    // 126 / 254 = 49.606299...%
    expect(calculateUtilization(126, 254)).toBeCloseTo(49.6063, 3);
    expect(calculateUtilization(254, 254)).toBe(100);
  });

  it('reports over-capacity honestly rather than clamping', () => {
    // Hiding 118% behind a capped bar is what makes a planning tool untrustworthy.
    expect(calculateUtilization(300, 254)).toBeGreaterThan(100);
  });

  it('guards against zero and empty capacity', () => {
    expect(calculateUtilization(10, 0)).toBe(0);
    expect(calculateUtilization(0, 254)).toBe(0);
    expect(calculateUtilization(10, -5)).toBe(0);
  });
});

describe('formatCidr', () => {
  it('renders a CIDR string', () => {
    expect(formatCidr(parseCidr('192.168.1.0/24'))).toBe('192.168.1.0/24');
  });
});

/* ================================================================== *
 * Remaining public API surface
 * Every exported helper ships as part of the engine contract, so each is
 * exercised directly rather than only through a caller.
 * ================================================================== */

describe('remaining public helpers', () => {
  it('isValidCidr does not throw', () => {
    expect(isValidCidr('192.168.1.0/24')).toBe(true);
    expect(isValidCidr('192.168.1.0')).toBe(false);
    expect(isValidCidr('not a cidr')).toBe(false);
  });

  it('calculateSubnetMask matches cidrToMask', () => {
    for (const prefix of ALL_PREFIXES) {
      expect(calculateSubnetMask(prefix)).toBe(cidrToMask(prefix));
    }
  });

  it('reports host and network bits', () => {
    expect(calculateHostBits(24)).toBe(8);
    expect(calculateHostBits(0)).toBe(32);
    expect(calculateHostBits(32)).toBe(0);
    expect(calculateNetworkBits(24)).toBe(24);
    expect(calculateNetworkBits(0)).toBe(0);
    expect(calculateNetworkBits(32)).toBe(32);
  });

  it('minimumParentPrefix keeps a /31 inside a /30 boundary', () => {
    // RFC 3021: a /31 pair must start on an even address, so it can only be
    // carved from a /30.
    expect(minimumParentPrefix(31)).toBe(30);
    expect(minimumParentPrefix(24)).toBe(24);
    expect(minimumParentPrefix(0)).toBe(0);
    expect(minimumParentPrefix(32)).toBe(32);
  });

  it('rangeOf matches cidrRange for a block', () => {
    for (const prefix of ALL_PREFIXES) {
      // Both normalise a host address to its containing network, so they must
      // agree exactly for every prefix.
      const fromHost = rangeOf('192.168.1.50', prefix);
      const fromCidr = cidrRange(parseCidr(`192.168.1.50/${prefix}`));
      expect(fromHost).toEqual(fromCidr);
      expect(rangeSize(fromHost)).toBe(2 ** (ADDRESS_BITS - prefix));
    }
    expect(rangeOf('192.168.1.50', 24).start).toBe(parseIPv4('192.168.1.0'));
    expect(rangeOf('192.168.1.50', 24).end).toBe(parseIPv4('192.168.1.255'));
  });

  it('distinguishes private from public addresses', () => {
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);

    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('192.168.1.1')).toBe(false);
    // CGNAT is not public and not private.
    expect(isPublicAddress('100.64.0.1')).toBe(false);
    expect(isPrivateAddress('100.64.0.1')).toBe(false);
  });

  it('rounds percentages to two decimals for display', () => {
    expect(roundPercent(49.60629921259843)).toBe(49.61);
    expect(roundPercent(100)).toBe(100);
    expect(roundPercent(0)).toBe(0);
  });

  it('toAddress accepts either a string or an integer', () => {
    expect(toAddress('192.168.1.1')).toBe(parseIPv4('192.168.1.1'));
    expect(toAddress(parseIPv4('192.168.1.1'))).toBe(parseIPv4('192.168.1.1'));
  });

  it('wildcardFromMask is the complement of any mask', () => {
    for (const prefix of ALL_PREFIXES) {
      const mask = cidrToMask(prefix);
      expect((mask | wildcardFromMask(mask)) >>> 0).toBe(U32_MAX);
    }
  });

  describe('computeHostAllocation', () => {
    it('allocates gateway, static infrastructure (.2-.10), and DHCP pool (.11+) on a /24', () => {
      const alloc = computeHostAllocation('192.168.1.0/24');
      expect(alloc.networkAddress).toBe('192.168.1.0');
      expect(alloc.gateway).toBe('192.168.1.1');
      expect(alloc.staticRange).toEqual({
        start: '192.168.1.2',
        end: '192.168.1.10',
        count: 9,
      });
      expect(alloc.dhcpPool).toEqual({
        start: '192.168.1.11',
        end: '192.168.1.254',
        count: 244,
      });
      expect(alloc.broadcastAddress).toBe('192.168.1.255');
      expect(alloc.totalAssignable).toBe(254);
    });

    it('honors a custom gateway assignment', () => {
      const alloc = computeHostAllocation('10.0.0.0/24', '10.0.0.254');
      expect(alloc.gateway).toBe('10.0.0.254');
    });

    it('handles smaller subnets like /28 proportionally', () => {
      const alloc = computeHostAllocation('172.16.1.0/28');
      expect(alloc.networkAddress).toBe('172.16.1.0');
      expect(alloc.gateway).toBe('172.16.1.1');
      expect(alloc.staticRange?.start).toBe('172.16.1.2');
      expect(alloc.dhcpPool?.end).toBe('172.16.1.14');
      expect(alloc.broadcastAddress).toBe('172.16.1.15');
      expect(alloc.totalAssignable).toBe(14);
    });

    it('handles /30 point-to-point subnets with 2 assignable hosts', () => {
      const alloc = computeHostAllocation('10.0.0.0/30');
      expect(alloc.networkAddress).toBe('10.0.0.0');
      expect(alloc.gateway).toBe('10.0.0.1');
      expect(alloc.staticRange).toEqual({
        start: '10.0.0.2',
        end: '10.0.0.2',
        count: 1,
      });
      expect(alloc.dhcpPool).toBeNull();
      expect(alloc.broadcastAddress).toBe('10.0.0.3');
      expect(alloc.totalAssignable).toBe(2);
    });

    it('handles RFC 3021 /31 point-to-point links with no broadcast overhead', () => {
      const alloc = computeHostAllocation('10.0.0.0/31');
      expect(alloc.networkAddress).toBe('10.0.0.0');
      expect(alloc.gateway).toBe('10.0.0.0');
      expect(alloc.staticRange).toEqual({
        start: '10.0.0.1',
        end: '10.0.0.1',
        count: 1,
      });
      expect(alloc.dhcpPool).toBeNull();
      expect(alloc.broadcastAddress).toBeNull();
      expect(alloc.totalAssignable).toBe(2);
    });

    it('handles /32 host routes', () => {
      const alloc = computeHostAllocation('10.0.0.5/32');
      expect(alloc.networkAddress).toBe('10.0.0.5');
      expect(alloc.gateway).toBe('10.0.0.5');
      expect(alloc.staticRange).toBeNull();
      expect(alloc.dhcpPool).toBeNull();
      expect(alloc.broadcastAddress).toBeNull();
      expect(alloc.totalAssignable).toBe(1);
    });
  });
});
