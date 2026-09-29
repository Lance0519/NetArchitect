/**
 * Tests for the display formatting layer.
 *
 * Two things are being defended here.
 *
 * First, *correctness at the edges that a network engineer would actually hit*.
 * The largest count the app can print is 4,294,967,294 and the smallest prefix is
 * 0, and both of those are where grouping and mask arithmetic tend to be wrong in
 * ways that are invisible on the easy inputs.
 *
 * Second, the boundary this module claims for itself: it formats, it does not
 * compute. The cross-checks at the bottom assert that its output agrees with the
 * engine across every prefix rather than agreeing with a handful of hand-written
 * expectations, so the moment the two drift apart the test fails.
 */

import { describe, expect, it } from 'vitest';

import {
  calculateSubnetMask,
  calculateWildcardMask,
  calculateNetworkAddress,
  integerToIPv4,
  parseCidr,
} from '@/core/ip-engine';
import {
  EM_DASH,
  formatAddressCount,
  formatAddressRange,
  formatBits,
  formatMaskDotted,
  formatNetworkAddress,
  formatNetworkCidr,
  formatPercent,
  formatPrefixBadge,
  formatVlan,
  formatWildcardDotted,
  groupDigits,
  pluralize,
  truncateMiddle,
} from '@/utils/formatting';

/** Every prefix the engine accepts. Shared by the sweep tests below. */
const ALL_PREFIXES = Array.from({ length: 33 }, (_, i) => i);

describe('groupDigits', () => {
  it('leaves one, two and three digit runs untouched', () => {
    expect(groupDigits('0')).toBe('0');
    expect(groupDigits('7')).toBe('7');
    expect(groupDigits('42')).toBe('42');
    expect(groupDigits('254')).toBe('254');
  });

  it('groups from the right, not from the left', () => {
    // Counting from the left is the classic error: it produces "1,024" for 1024
    // and an empty leading group for seven digits.
    expect(groupDigits('1024')).toBe('1,024');
    expect(groupDigits('12345')).toBe('12,345');
    expect(groupDigits('123456')).toBe('123,456');
  });

  it('gives the leftmost group one to three digits for every length', () => {
    for (let digits = 4; digits <= 20; digits += 1) {
      const grouped = groupDigits('1'.repeat(digits));
      const groups = grouped.split(',');
      expect(groups[0]?.length).toBeLessThanOrEqual(3);
      expect(groups[0]?.length).toBeGreaterThan(0);
      expect(groups.slice(1).every((g) => g.length === 3)).toBe(true);
      // Round-trips: the separators are the only thing added.
      expect(grouped.replaceAll(',', '')).toBe('1'.repeat(digits));
    }
  });
});

describe('formatAddressCount', () => {
  it('renders the largest count the engine can report', () => {
    // A /0 holds 2^32 addresses; two are unassignable. If this renders as
    // 4294967294 the column is unreadable, and if it renders with a stray
    // separator it is actively wrong.
    expect(formatAddressCount(4_294_967_294)).toBe('4,294,967,294');
  });

  it('renders the full IPv4 address space too', () => {
    expect(formatAddressCount(4_294_967_296)).toBe('4,294,967,296');
  });

  it('renders ordinary subnet counts', () => {
    expect(formatAddressCount(0)).toBe('0');
    expect(formatAddressCount(2)).toBe('2');
    expect(formatAddressCount(254)).toBe('254');
    expect(formatAddressCount(1022)).toBe('1,022');
    expect(formatAddressCount(65_534)).toBe('65,534');
  });

  it('refuses to invent a number for input that is not a count', () => {
    // Zero is a real answer; these are not answers at all, and rendering them
    // as numbers would be a lie about a plan's size.
    expect(formatAddressCount(-1)).toBe(EM_DASH);
    expect(formatAddressCount(1.5)).toBe(EM_DASH);
    expect(formatAddressCount(Number.NaN)).toBe(EM_DASH);
    expect(formatAddressCount(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
    expect(formatAddressCount(2 ** 53)).toBe(EM_DASH);
  });
});

describe('formatPercent', () => {
  it('trims trailing zeros instead of padding to a fixed width', () => {
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(49.6)).toBe('49.6%');
    expect(formatPercent(49)).toBe('49%');
  });

  it('rounds to the requested precision', () => {
    // 126 used of 254 is the canonical example and is 49.6063...
    expect(formatPercent(49.60629921)).toBe('49.6%');
    expect(formatPercent(49.60629921, 2)).toBe('49.61%');
    expect(formatPercent(49.60629921, 0)).toBe('50%');
    expect(formatPercent(49.4, 0)).toBe('49%');
  });

  it('does not clamp over-capacity, which is the point of the number', () => {
    // 300 hosts in a 254-host subnet. A capped bar is fine; a capped figure is
    // a lie that hides the single most useful thing on the screen.
    expect(formatPercent(118.11)).toBe('118.1%');
    expect(formatPercent(500)).toBe('500%');
  });

  it('groups a whole-number part, since utilisation can exceed 1000%', () => {
    expect(formatPercent(1_234.5)).toBe('1,234.5%');
  });

  it('keeps the sign on a negative value', () => {
    // Should not occur from the engine, which returns 0 for a non-positive
    // capacity, but a negative bar width from any source must not read as
    // positive.
    expect(formatPercent(-12.5)).toBe('-12.5%');
  });

  it('refuses nonsense rather than printing it', () => {
    expect(formatPercent(Number.NaN)).toBe(EM_DASH);
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
    expect(formatPercent(10, -1)).toBe(EM_DASH);
    expect(formatPercent(10, 1.5)).toBe(EM_DASH);
  });
});

describe('CIDR display', () => {
  it('uses the canonical network address, not the address that was typed', () => {
    // 192.168.1.50/24 denotes 192.168.1.0/24. A screen showing an allocated
    // subnet shows the network it allocated.
    expect(formatNetworkCidr(parseCidr('192.168.1.50/24'))).toBe('192.168.1.0/24');
    expect(formatNetworkAddress(parseCidr('192.168.1.50/24'))).toBe('192.168.1.0');
  });

  it('leaves an address that is already on its boundary alone', () => {
    expect(formatNetworkCidr(parseCidr('10.0.0.0/22'))).toBe('10.0.0.0/22');
    expect(formatNetworkCidr(parseCidr('172.16.0.0/12'))).toBe('172.16.0.0/12');
  });

  it('handles the /0 and /32 extremes', () => {
    expect(formatNetworkCidr(parseCidr('192.168.1.0/0'))).toBe('0.0.0.0/0');
    expect(formatNetworkCidr(parseCidr('8.8.8.8/32'))).toBe('8.8.8.8/32');
  });

  it('shows the boundary shift, not just the prefix', () => {
    // 192.168.1.255/23 is the last host of 192.168.1.0/23, and the network is
    // 192.168.0.0. Getting this wrong shows a host address as if it were a
    // network.
    expect(formatNetworkCidr(parseCidr('192.168.1.255/23'))).toBe('192.168.0.0/23');
  });

  it('renders prefix badges with the leading slash', () => {
    expect(formatPrefixBadge(0)).toBe('/0');
    expect(formatPrefixBadge(24)).toBe('/24');
    expect(formatPrefixBadge(32)).toBe('/32');
  });

  it('renders masks and wildcards as dotted quads', () => {
    expect(formatMaskDotted(24)).toBe('255.255.255.0');
    expect(formatWildcardDotted(24)).toBe('0.0.0.255');
    // The two extremes, where an unguarded shift inverts the result.
    expect(formatMaskDotted(0)).toBe('0.0.0.0');
    expect(formatWildcardDotted(0)).toBe('255.255.255.255');
    expect(formatMaskDotted(32)).toBe('255.255.255.255');
    expect(formatWildcardDotted(32)).toBe('0.0.0.0');
  });

  it('agrees with the engine on every mask and wildcard', () => {
    for (const prefix of ALL_PREFIXES) {
      expect(formatMaskDotted(prefix)).toBe(integerToIPv4(calculateSubnetMask(prefix)));
      expect(formatWildcardDotted(prefix)).toBe(integerToIPv4(calculateWildcardMask(prefix)));
      // The load-bearing property: a subnet wildcard is the exact bitwise
      // complement of the mask, on every prefix including the two extremes
      // where an unguarded shift breaks.
      expect((calculateSubnetMask(prefix) + calculateWildcardMask(prefix)) >>> 0).toBe(0xffffffff);
    }
  });

  it('agrees with the engine network address on every prefix', () => {
    for (const prefix of ALL_PREFIXES) {
      const cidr = parseCidr(`203.0.113.77/${prefix}`);
      expect(formatNetworkAddress(cidr)).toBe(integerToIPv4(calculateNetworkAddress(cidr.ip, prefix)));
    }
  });

  it('renders VLAN ids with their unit', () => {
    expect(formatVlan(1)).toBe('VLAN 1');
    expect(formatVlan(4094)).toBe('VLAN 4094');
  });

  it('renders an inclusive range on one line', () => {
    expect(formatAddressRange(0xc0a80101, 0xc0a801fe)).toBe('192.168.1.1 - 192.168.1.254');
    expect(formatAddressRange(0, 0)).toBe('0.0.0.0 - 0.0.0.0');
  });
});

describe('counts and prose', () => {
  it('agrees with the singular', () => {
    expect(pluralize(1, 'subnet')).toBe('1 subnet');
    expect(pluralize(0, 'subnet')).toBe('0 subnets');
    expect(pluralize(2, 'subnet')).toBe('2 subnets');
    expect(pluralize(1_024, 'subnet')).toBe('1,024 subnets');
  });

  it('accepts an irregular plural', () => {
    expect(pluralize(1, 'entry', 'entries')).toBe('1 entry');
    expect(pluralize(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('agrees with bit counts, including the singular one bit', () => {
    expect(formatBits(1)).toBe('1 bit');
    expect(formatBits(0)).toBe('0 bits');
    expect(formatBits(24)).toBe('24 bits');
    expect(formatBits(32)).toBe('32 bits');
  });
});

describe('truncateMiddle', () => {
  it('leaves short strings untouched', () => {
    expect(truncateMiddle('192.168.1.0/24', 20)).toBe('192.168.1.0/24');
    expect(truncateMiddle('abc', 3)).toBe('abc');
    expect(truncateMiddle('', 5)).toBe('');
  });

  it('keeps both ends, which is what identifies an address', () => {
    // 18 characters down to 12: 6 from the head, ellipsis, 5 from the tail.
    const result = truncateMiddle('192.168.100.200/24', 12);
    expect(result).toBe('192.16…00/24');
    expect(result.length).toBe(12);
  });

  it('keeps two distinct addresses distinct', () => {
    // The reason for trimming the middle rather than the tail: a trailing
    // ellipsis would render these two identical in a narrow column.
    expect(truncateMiddle('192.168.1.0/24', 10)).not.toBe(truncateMiddle('203.0.113.0/24', 10));
  });

  it('never exceeds the requested length', () => {
    const source = 'a'.repeat(40);
    for (let max = 0; max <= 40; max += 1) {
      expect(truncateMiddle(source, max).length).toBeLessThanOrEqual(Math.max(max, 0));
    }
  });

  it('degrades to a head when there is no room for both ends', () => {
    expect(truncateMiddle('abcdef', 1)).toBe('a');
    expect(truncateMiddle('abcdef', 2)).toBe('ab');
  });
});
