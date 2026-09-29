/**
 * NetArchitect IPv4 calculation engine.
 *
 * PURE MODULE. This file imports nothing from React, React Native, Expo, or any
 * UI module. That constraint is what makes the engine testable in Node, portable,
 * and trustworthy. If you find yourself wanting to import a component here, the
 * logic belongs somewhere else.
 *
 * ## Unsigned 32-bit arithmetic
 *
 * IPv4 addresses are represented as unsigned JS `number` values in
 * [0, 2^32-1]. `2^32` is below `Number.MAX_SAFE_INTEGER`, so plain numbers are
 * exact - PROVIDED every bitwise result is coerced with `>>> 0`. JavaScript's
 * bitwise operators operate on *signed* int32, so without that coercion values
 * above 2^31-1 come back negative. Every bitwise expression below is wrapped.
 *
 * Two specific traps are guarded here and pinned by tests:
 *
 *   1. `0xffffffff << 32` is NOT zero. JavaScript masks shift counts to 5 bits,
 *      so that expression evaluates to `0xffffffff << 0` === 0xffffffff. See
 *      `cidrToMask`, which special-cases prefix 0. Getting this wrong makes every
 *      /0 calculation silently return an all-ones mask.
 *
 *   2. `2147483648` (2^31) is the first value that goes negative under signed
 *      coercion. The test suite exercises it directly.
 *
 * ## Return values
 *
 * Engine functions return raw unsigned integers and structured records. They
 * never return display strings. Formatting lives in `src/utils/formatting.ts`,
 * which is what keeps this module string-free and testable.
 */

import type { AddressRange, Cidr, ReservedRangeKind, SubnetInfo } from '../types/network';
import {
  InvalidCIDRError,
  InvalidHostCountError,
  InvalidIPv4Error,
  InvalidPrefixError,
  InvalidSubnetBoundaryError,
  ScopeExhaustionError,
} from './errors';
import { CLASSIFICATION_BY_KIND, RESERVED_BLOCKS, type RangeClassification } from './standards';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** Bits in an IPv4 address. */
export const ADDRESS_BITS = 32;
export const MIN_PREFIX = 0;
export const MAX_PREFIX = 32;
export const OCTET_COUNT = 4;
export const MAX_OCTET = 255;
export const U32_MAX = 0xffffffff;

/** Largest possible address count, 2^32, for a /0. Exact in a double. */
export const MAX_ADDRESS_COUNT = 2 ** ADDRESS_BITS;

/** Number of octets in a valid IPv4 address. */
export const OCTET_PATTERN = /^(0|[1-9][0-9]{0,2})$/;

/** Prefix may be given bare (`24`), or with a leading slash for input forgiveness. */
const PREFIX_PATTERN = /^\/?(\d{1,2})$/;

/* ------------------------------------------------------------------ *
 * Coercion helpers
 * ------------------------------------------------------------------ */

/**
 * Coerce a number into a valid unsigned 32-bit integer.
 *
 * This is the single choke point for the signed/unsigned problem. Accepts an
 * already-unsigned integer, or a value that arrived as a signed int32 and needs
 * re-interpreting as unsigned.
 */
export function toUint32(value: number): number {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Expected an integer, received ${value}.`);
  }
  // Values in [0, 2^32-1] pass through. Values in [-2^31, -1] are the signed
  // image of a uint32 and get re-interpreted. Anything else is out of range.
  if (value < 0) {
    if (value >= -2147483648) return value >>> 0;
    throw new RangeError(`Value ${value} is out of range for a 32-bit unsigned integer.`);
  }
  if (value > U32_MAX) {
    throw new RangeError(`Value ${value} exceeds the maximum IPv4 address of ${U32_MAX}.`);
  }
  return value >>> 0;
}

/** Accept either a dotted-quad string or an unsigned integer, return an unsigned integer. */
export function toAddress(value: number | string): number {
  return typeof value === 'string' ? parseIPv4(value) : toUint32(value);
}

/** Validate a prefix length supplied as a number. */
export function validatePrefix(prefix: unknown): number {
  if (
    typeof prefix !== 'number' ||
    !Number.isInteger(prefix) ||
    prefix < MIN_PREFIX ||
    prefix > MAX_PREFIX
  ) {
    throw new InvalidPrefixError(prefix);
  }
  return prefix;
}

/* ------------------------------------------------------------------ *
 * Parsing and formatting of raw addresses
 * ------------------------------------------------------------------ */

/**
 * Parse a dotted-quad IPv4 address into an unsigned 32-bit integer.
 *
 * Strict by design. An addressing tool that guesses is an addressing tool that
 * silently produces a plan for the wrong network.
 *
 * Rejected: wrong octet count, non-numeric or empty octets, octets above 255,
 * whitespace inside the address, and leading zeros. Leading zeros matter:
 * "010.1.1.1" is ambiguous between decimal and octal, and silently reading it
 * as octal gives a different address than the user typed.
 */
export function parseIPv4(input: string): number {
  if (typeof input !== 'string') {
    throw new InvalidIPv4Error(String(input), 'input is not a string');
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InvalidIPv4Error(input, 'empty string');
  }

  const parts = trimmed.split('.');
  if (parts.length !== OCTET_COUNT) {
    throw new InvalidIPv4Error(input, `expected ${OCTET_COUNT} octets, received ${parts.length}`);
  }

  let value = 0;
  for (const part of parts) {
    if (!OCTET_PATTERN.test(part)) {
      throw new InvalidIPv4Error(
        input,
        part.length > 1 && part.startsWith('0')
          ? 'leading zeros are not permitted because they are ambiguous with octal notation'
          : `invalid octet "${part}"`,
      );
    }
    const octet = Number(part);
    if (octet > MAX_OCTET) {
      throw new InvalidIPv4Error(input, `octet ${octet} exceeds ${MAX_OCTET}`);
    }
    // Accumulates at most 4 octets of 255, so it can never exceed 2^32-1.
    value = (value * 256 + octet) >>> 0;
  }
  return value >>> 0;
}

/** Non-throwing variant of {@link parseIPv4}. */
export function isValidIPv4(input: string): boolean {
  try {
    parseIPv4(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert an unsigned 32-bit integer into a dotted-quad string.
 *
 * Unchecked conversion for values already known to be in range. Use
 * {@link toUint32} first when the value comes from outside.
 */
export function integerToIPv4(value: number): string {
  const n = toUint32(value);
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

/* ------------------------------------------------------------------ *
 * CIDR
 * ------------------------------------------------------------------ */

/**
 * Parse a prefix length.
 *
 * Accepts a number, or a string with an optional leading slash so that a user
 * who types "/24" into a separate prefix field is not punished for it.
 */
export function parsePrefix(input: string | number): number {
  if (typeof input === 'number') return validatePrefix(input);
  if (typeof input !== 'string') throw new InvalidPrefixError(input);

  const match = PREFIX_PATTERN.exec(input.trim());
  if (!match) throw new InvalidPrefixError(input);
  return validatePrefix(Number(match[1]));
}

/**
 * Parse CIDR notation into a {@link Cidr}.
 *
 * The address is NOT required to be a network boundary. `192.168.1.50/24` is a
 * valid CIDR reference: an address inside the network 192.168.1.0/24. Requiring
 * a boundary here would reject an extremely common and perfectly reasonable
 * thing for a user to type. Use {@link assertNetworkBoundary} when you need a
 * subnet *definition* rather than a reference.
 */
export function parseCidr(input: string): Cidr {
  if (typeof input !== 'string') throw new InvalidCIDRError(String(input), 'input is not a string');

  const trimmed = input.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    throw new InvalidCIDRError(
      input,
      'missing prefix length, expected a value like 192.168.1.0/24',
    );
  }
  if (trimmed.indexOf('/', slashIndex + 1) !== -1) {
    throw new InvalidCIDRError(input, 'multiple "/" separators');
  }

  const addressPart = trimmed.slice(0, slashIndex);
  const prefixPart = trimmed.slice(slashIndex + 1);
  if (addressPart.trim().length === 0) {
    throw new InvalidCIDRError(input, 'missing address before "/"');
  }
  if (prefixPart.trim().length === 0) {
    throw new InvalidCIDRError(input, 'missing prefix length after "/"');
  }

  const ip = parseIPv4(addressPart);
  const prefix = parsePrefix(prefixPart);
  return Object.freeze({ family: 'ipv4' as const, ip, prefix });
}

/** Non-throwing variant of {@link parseCidr}. */
export function isValidCidr(input: string): boolean {
  try {
    parseCidr(input);
    return true;
  } catch {
    return false;
  }
}

/** Render a {@link Cidr} back to CIDR notation. */
export function formatCidr(cidr: Cidr): string {
  return `${integerToIPv4(cidr.ip)}/${cidr.prefix}`;
}

/* ------------------------------------------------------------------ *
 * Masks
 * ------------------------------------------------------------------ */

/**
 * Convert a prefix length to a contiguous subnet mask, as an unsigned integer.
 *
 * The `prefix === 0` branch is not an optimisation, it is a correctness fix.
 * JavaScript masks shift counts to five bits, so `0xffffffff << 32` evaluates
 * to `0xffffffff << 0`, which is 0xffffffff. Without the guard, a /0 would
 * report an all-ones mask and every /0 result would be wrong.
 */
export function cidrToMask(prefix: number): number {
  const p = validatePrefix(prefix);
  return p === 0 ? 0 : (U32_MAX << (ADDRESS_BITS - p)) >>> 0;
}

/**
 * Inverse of {@link cidrToMask}.
 *
 * Rejects non-contiguous masks such as 255.0.255.0, which are not valid subnet
 * masks even though they are valid 32-bit patterns.
 */
export function maskToCidr(mask: number): number {
  const m = toUint32(mask);
  let prefix = 0;
  for (let bit = ADDRESS_BITS - 1; bit >= 0; bit -= 1) {
    if (((m >>> bit) & 1) === 0) break;
    prefix += 1;
  }
  if (cidrToMask(prefix) !== m) {
    throw new RangeError(`${integerToIPv4(m)} is not a contiguous subnet mask.`);
  }
  return prefix;
}

/** True when the pattern is a contiguous, all-ones-then-all-zeros mask. */
export function isValidSubnetMask(mask: number): boolean {
  try {
    maskToCidr(mask);
    return true;
  } catch {
    return false;
  }
}

/** Subnet mask for a prefix, as an unsigned integer. Named per the engine contract. */
export function calculateSubnetMask(prefix: number): number {
  return cidrToMask(prefix);
}

/** The exact bitwise inverse of a subnet mask. */
export function wildcardFromMask(mask: number): number {
  return ~toUint32(mask) >>> 0;
}

/**
 * Wildcard mask for a prefix, as an unsigned integer.
 *
 * Used by ACLs and OSPF network statements, where the wildcard is the bitwise
 * complement of the subnet mask. ACL wildcards can be non-contiguous, but the
 * wildcard for a *subnet* always is the complement.
 */
export function calculateWildcardMask(prefix: number): number {
  return wildcardFromMask(cidrToMask(prefix));
}

/* ------------------------------------------------------------------ *
 * Address derivation
 * ------------------------------------------------------------------ */

/** Network address for an address and prefix. */
export function calculateNetworkAddress(ip: number | string, prefix: number): number {
  const address = toAddress(ip);
  return (address & cidrToMask(prefix)) >>> 0;
}

/**
 * Broadcast address for an address and prefix.
 *
 * Takes the address rather than the network so that passing a host address works:
 * the broadcast is always derived from the containing network.
 */
export function calculateBroadcastAddress(ip: number | string, prefix: number): number {
  const address = toAddress(ip);
  const mask = cidrToMask(prefix);
  return ((address & mask) | wildcardFromMask(mask)) >>> 0;
}

/**
 * First and last assignable host addresses, as an inclusive range.
 *
 * Follows RFC 3021 for /31 (both addresses are usable endpoints) and treats /32
 * as a single-address host route.
 */
export function calculateHostRange(ip: number | string, prefix: number): AddressRange {
  const subnet = calculateSubnet(ip, prefix);
  return Object.freeze({ start: subnet.firstUsableHost, end: subnet.lastUsableHost });
}

/** Total addresses in a block, 2^(32 - prefix). Max 4294967296 at /0. */
export function calculateSubnetSize(prefix: number): number {
  return 2 ** (ADDRESS_BITS - validatePrefix(prefix));
}

/**
 * Number of assignable hosts in a block of the given prefix.
 *
 * - /0 to /30: total - 2, because the network and broadcast addresses are reserved.
 * - /31: 2. RFC 3021 defines both addresses of a point-to-point link as usable.
 * - /32: 1. A host route has exactly one address.
 */
export function calculateUsableHosts(prefix: number): number {
  const p = validatePrefix(prefix);
  if (p === MAX_PREFIX) return 1;
  if (p === 31) return 2;
  return calculateSubnetSize(p) - 2;
}

/** Host bits (bits available for hosts) for a prefix. */
export const calculateHostBits = (prefix: number): number => ADDRESS_BITS - validatePrefix(prefix);

/** Network bits (bits fixed by the mask) for a prefix. */
export const calculateNetworkBits = (prefix: number): number => validatePrefix(prefix);

/* ------------------------------------------------------------------ *
 * The main entry point
 * ------------------------------------------------------------------ */

/**
 * Resolve every derived property of a subnet.
 *
 * This is the single producer of {@link SubnetInfo}. The UI never computes an
 * address itself; it calls this.
 *
 * ```ts
 * calculateSubnet('192.168.1.50', 24);
 * // networkAddress    192.168.1.0
 * // broadcastAddress  192.168.1.255
 * // firstUsableHost   192.168.1.1
 * // lastUsableHost    192.168.1.254
 * // usableHosts       254
 * // hostBits          8
 * ```
 */
export function calculateSubnet(ip: number | string, prefix: number): SubnetInfo {
  const address = toAddress(ip);
  const p = validatePrefix(prefix);
  const mask = cidrToMask(p);
  const wildcard = wildcardFromMask(mask);

  const networkAddress = (address & mask) >>> 0;
  const totalAddresses = calculateSubnetSize(p);
  const broadcastAddress = (networkAddress | wildcard) >>> 0;

  // RFC 3021: in a /31 both addresses are usable endpoints, so neither the
  // network nor the broadcast address is reserved. /32 is a host route.
  // For every prefix <= 30 the first and last addresses are reserved.
  const reservesEdgeAddresses = p < 31;
  const firstUsableHost = reservesEdgeAddresses ? networkAddress + 1 : networkAddress;
  const lastUsableHost = reservesEdgeAddresses ? broadcastAddress - 1 : broadcastAddress;

  // Derived from the range rather than repeated as a formula, so the count can
  // never disagree with the endpoints it describes. This equals total - 2 for
  // /0-/30, 2 for /31, and 1 for /32.
  const usableHosts = lastUsableHost - firstUsableHost + 1;

  return Object.freeze({
    cidr: Object.freeze({ family: 'ipv4' as const, ip: address, prefix: p }),
    networkAddress,
    broadcastAddress,
    subnetMask: mask,
    wildcardMask: wildcard,
    firstUsableHost,
    lastUsableHost,
    totalAddresses,
    usableHosts,
    hostBits: ADDRESS_BITS - p,
    networkBits: p,
    isHostRoute: p === MAX_PREFIX,
    isPointToPoint: p === 31,
    addressSpace: classifyAddressSpace(networkAddress),
  });
}

/* ------------------------------------------------------------------ *
 * Sizing
 * ------------------------------------------------------------------ */

/**
 * Smallest number of host bits that can satisfy a required host count.
 *
 * Uses an integer search rather than `Math.log2`. Floating point is exactly
 * wrong at the boundaries that matter here, because N is very often an exact
 * power of two minus two - which is precisely the case subnetting revolves
 * around. `Math.ceil(Math.log2(n))` on such inputs is a coin flip.
 *
 * @param hosts          required host count, a positive integer
 * @param minHostBits    floor on host bits. 2 means a /30 is the smallest
 *                       allocatable LAN subnet (2 usable). 1 allows /31, which
 *                       is correct for point-to-point links per RFC 3021.
 * @returns host bits, 1-30
 */
export function smallestBlockForHosts(hosts: number, minHostBits = 2): number {
  if (!Number.isInteger(hosts) || hosts < 1) {
    throw new InvalidHostCountError(hosts);
  }
  const floor = Math.max(1, Math.min(minHostBits, 30));
  for (let bits = floor; bits <= 30; bits += 1) {
    // A /31 is the exception to the 2^n - 2 rule: RFC 3021 point-to-point links
    // reserve no addresses, so 1 host bit yields 2 usable addresses rather than 0.
    const usable = bits === 1 ? 2 : 2 ** bits - 2;
    if (usable >= hosts) return bits;
  }
  // A single IPv4 subnet cannot hold more than 2^30 - 2 usable addresses.
  throw new ScopeExhaustionError('requirement', hosts, hosts + 2, 2 ** 30 - 2);
}

/**
 * Smallest prefix length that can satisfy a required host count.
 *
 * Convenience wrapper over {@link smallestBlockForHosts}.
 */
export function smallestPrefixForHosts(hosts: number, minHostBits = 2): number {
  return ADDRESS_BITS - smallestBlockForHosts(hosts, minHostBits);
}

/**
 * The parent block a prefix must be carved from, i.e. the next legal boundary at
 * or above the given prefix.
 *
 * RFC 3021 Appendix A requires the two addresses of a /31 to be an even/odd
 * pair. A /31 is therefore only correctly allocated on an even boundary, so
 * VLSM aligns point-to-point allocations to two.
 */
export const minimumParentPrefix = (prefix: number): number => (prefix === 31 ? 30 : prefix);

/** True when an address is a legal base for a /31 pair, per RFC 3021 Appendix A. */
export const isValidPointToPointPairStart = (address: number): boolean =>
  (toUint32(address) & 0x1) === 0;

/* ------------------------------------------------------------------ *
 * Ranges and overlap
 * ------------------------------------------------------------------ */

/** Inclusive address range covered by a CIDR block. */
export function cidrRange(cidr: Cidr): AddressRange {
  const ip = toUint32(cidr.ip);
  const mask = cidrToMask(cidr.prefix);
  const start = (ip & mask) >>> 0;
  // The `>>> 0` on `end` is load-bearing. A bare `|` yields a signed int32, so any
  // range ending above 2^31-1 comes back negative and silently reports "no
  // overlap" against everything.
  return Object.freeze({ start, end: (start | wildcardFromMask(mask)) >>> 0 });
}

/** Inclusive address range for an address and prefix. */
export function rangeOf(ip: number | string, prefix: number): AddressRange {
  const address = toAddress(ip);
  const p = validatePrefix(prefix);
  const mask = cidrToMask(p);
  const start = (address & mask) >>> 0;
  return Object.freeze({ start, end: (start | wildcardFromMask(mask)) >>> 0 });
}

/** Number of addresses in an inclusive range. */
export const rangeSize = (range: AddressRange): number => range.end - range.start + 1;

/**
 * Do two inclusive ranges intersect?
 *
 * The single overlap primitive. Used by the VLSM post-condition tripwire, by
 * the security auditor, and by range-diffing for free-space discovery.
 */
export function rangesOverlap(a: AddressRange, b: AddressRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Do two CIDR blocks overlap?
 *
 * Normalises both to their network address first, so passing host addresses
 * still gives the right answer.
 */
export function detectOverlap(a: Cidr, b: Cidr): boolean {
  return rangesOverlap(cidrRange(a), cidrRange(b));
}

/** Does a CIDR block fall entirely inside a parent block? */
export function isWithin(child: Cidr, parent: Cidr): boolean {
  const c = cidrRange(child);
  const p = cidrRange(parent);
  return c.start >= p.start && c.end <= p.end;
}

/* ------------------------------------------------------------------ *
 * Boundaries and validation helpers
 * ------------------------------------------------------------------ */

/** True when a CIDR's address has no host bits set, i.e. it is a subnet definition. */
export function isNetworkBoundary(cidr: Cidr): boolean {
  const ip = toUint32(cidr.ip);
  return (ip & cidrToMask(cidr.prefix)) >>> 0 === ip;
}

/**
 * Return the canonical network address for a CIDR, or throw if the input is
 * meant to be a subnet definition and is not one.
 *
 * This is what the planner's subnet rows and auditor rule SEC-003 use. A
 * planner row of `192.168.1.50/24` is a mistake, because the subnet it
 * describes is `192.168.1.0/24` and storing the other value would make the plan
 * disagree with its own addressing.
 */
export function assertNetworkBoundary(cidr: Cidr): Cidr {
  if (isNetworkBoundary(cidr)) return cidr;
  const network = calculateNetworkAddress(cidr.ip, cidr.prefix);
  // The suggestion is a full CIDR, not a bare address. Told only
  // "192.168.1.50/25 is not a network address, use 192.168.1.0", a reader
  // cannot tell whether the prefix survived, and the obvious repair is to
  // replace the whole string with the address shown.
  throw new InvalidSubnetBoundaryError(
    formatCidr(cidr),
    formatCidr({ family: 'ipv4', ip: network, prefix: cidr.prefix }),
  );
}

/* ------------------------------------------------------------------ *
 * Address space classification
 * ------------------------------------------------------------------ */

/** Look up the full classification metadata for a kind. */
export const classificationFor = (kind: ReservedRangeKind): RangeClassification =>
  CLASSIFICATION_BY_KIND[kind];

/**
 * Classify an address against the IANA special-purpose registries.
 *
 * Every returned value is attributable to a published RFC, which is what the
 * calculator's address-space badge displays. See `standards.ts` for the table.
 */
export function classifyAddressSpace(ip: number | string): ReservedRangeKind {
  const address = toAddress(ip);
  // Reserved blocks are stored as inclusive [start, end] integer pairs, so
  // membership is two unsigned comparisons and no allocation.
  if (isInBlocks(address, RESERVED_BLOCKS.this_network)) return 'this_network';
  if (isInBlocks(address, RESERVED_BLOCKS.loopback)) return 'loopback';
  if (isInBlocks(address, RESERVED_BLOCKS.private)) return 'private';
  if (isInBlocks(address, RESERVED_BLOCKS.cgnat)) return 'cgnat';
  if (isInBlocks(address, RESERVED_BLOCKS.link_local)) return 'link_local';
  if (isInBlocks(address, RESERVED_BLOCKS.ietf_protocol_assignments))
    return 'ietf_protocol_assignments';
  if (isInBlocks(address, RESERVED_BLOCKS.documentation)) return 'documentation';
  if (isInBlocks(address, RESERVED_BLOCKS.benchmark)) return 'benchmark';
  if (isInBlocks(address, RESERVED_BLOCKS.multicast)) return 'multicast';
  if (isInBlocks(address, RESERVED_BLOCKS.reserved)) return 'reserved';
  return 'public';
}

/** Classify an address and return its full metadata, including the governing RFC. */
export function classifyAddress(ip: number | string): RangeClassification {
  return classificationFor(classifyAddressSpace(ip));
}

/** True when the address is RFC 1918 private space. */
export const isPrivateAddress = (ip: number | string): boolean =>
  classifyAddressSpace(ip) === 'private';

/** True when the address is routable on the public internet. */
export const isPublicAddress = (ip: number | string): boolean =>
  classifyAddressSpace(ip) === 'public';

const isInBlocks = (address: number, blocks: readonly (readonly [number, number])[]): boolean => {
  for (const [start, end] of blocks) {
    if (address >= start && address <= end) return true;
  }
  return false;
};

/* ------------------------------------------------------------------ *
 * Utilisation
 * ------------------------------------------------------------------ */

/**
 * Utilisation as a percentage, 0-100.
 *
 * Deliberately NOT clamped. A plan that needs 300 hosts in a 254-host subnet is
 * 118% utilised, and hiding that behind a capped bar is exactly the kind of
 * thing that makes a planning tool untrustworthy. Callers rendering a bar should
 * clamp for display while surfacing the real number as text.
 */
export function calculateUtilization(used: number, capacity: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) return 0;
  if (used <= 0) return 0;
  return (used / capacity) * 100;
}

/** Utilisation rounded to two decimals, for display. */
export const roundPercent = (value: number): number => Math.round(value * 100) / 100;
