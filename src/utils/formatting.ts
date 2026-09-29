/**
 * Display formatting.
 *
 * ## What belongs here and what does not
 *
 * The engine is deliberately string-free: it speaks in unsigned 32-bit integers
 * and {@link Cidr} objects, and it can therefore be tested to exhaustion without
 * touching a rendering layer. That means every screen needs *something* to turn
 * those numbers into text, and that something is this module.
 *
 * The rule this module follows, without exception: **it may format engine output
 * but it must never compute networking values.** There is no address arithmetic
 * here, no `2 ** (32 - prefix)`, no host-count formula. If a screen needs such a
 * number it must ask the engine for it, and the value shown on screen is then
 * provably the value the engine computed. Re-deriving a host count here to make a
 * label prettier is how a UI ends up disagreeing with the engine it is reporting.
 *
 * ## Why digits are grouped by hand rather than with `Intl.NumberFormat`
 *
 * `Intl.NumberFormat` produces locale-dependent output. A user whose device
 * locale uses `.` as the group separator would see `4.294.967.294` where the rest
 * of this app has written a dotted-quad `4.294.967.294` a few lines above - two
 * different readings of the same digits on the same screen, in a tool whose
 * entire job is making digits unambiguous.
 *
 * Grouping is also a fixed three-character convention for addresses, not a
 * linguistic one. So the separator is pinned here, and Hermes does not have to
 * ship a full ICU data set for it.
 *
 * `toLocaleString` therefore appears nowhere in this file, and neither does a
 * locale parameter.
 */

import {
  calculateWildcardMask,
  cidrToMask,
  integerToIPv4,
} from '@/core/ip-engine';
import type { Cidr } from '@/types/network';

/**
 * Rendered when a value cannot be shown as a number.
 *
 * An em dash rather than `0`, `NaN`, `-` or an empty string. Zero is a claim, and
 * a plan with 0 hosts is a different plan from one whose host count is unknown.
 */
export const EM_DASH = '—';

/** Group separator. Pinned, not locale-derived. See the module note. */
export const GROUP_SEPARATOR = ',';

/* ------------------------------------------------------------------ *
 * Digit grouping
 * ------------------------------------------------------------------ */

/**
 * Insert a group separator every three digits, counting from the right.
 *
 * Takes and returns digits, with no sign and no decimal point. Separating the
 * digits from the sign is what lets `-1234` and `1234.5` both reuse this.
 */
export const groupDigits = (digits: string): string => {
  if (digits.length <= 3) return digits;

  let out = '';
  // Walk right-to-left in threes, which is the only grouping that makes the
  // leftmost group the one of 1-3 digits. Counting from the left would put a
  // leading empty group on a 7-digit number.
  for (let i = digits.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    const group = digits.slice(start, i);
    out = out.length === 0 ? group : `${group}${GROUP_SEPARATOR}${out}`;
  }
  return out;
};

/**
 * Render a non-negative integer with thousands separators.
 *
 * This is the function that must not be naive: the largest address count the
 * engine can report is 4,294,967,294 (a `/0` minus its network and broadcast
 * addresses), and it has to come out as `4,294,967,294`. A version that stopped
 * at 999,999 or emitted a stray separator for a 10-digit number would be
 * exactly the class of cosmetic bug that makes an engineer stop trusting the
 * rest of the display.
 */
export const formatAddressCount = (value: number): string => {
  if (!Number.isSafeInteger(value) || value < 0) return EM_DASH;
  return groupDigits(String(value));
};

/* ------------------------------------------------------------------ *
 * Percentages
 * ------------------------------------------------------------------ */

/**
 * Render a percentage, trimming trailing zeros.
 *
 * ## Formatting decision, approved
 *
 * Three options were on the table and this one was chosen:
 *
 *   - one decimal, trimmed, unclamped — **this**: `49.6%`, `100%`, `118.1%`
 *   - rounded integer: `50%`, `100%`, `118%`
 *   - one decimal, never trimmed: `50.0%`, `100.0%`, `118.1%`
 *
 * One decimal because this is a teaching tool and the fractional part is the
 * lesson: a 300-host requirement in a 254-usable block is not "about 100%", it
 * is `118.1%`, and rounding to `118%` reads as more certain than it is. Trimmed
 * because trailing zeros are noise in a column of figures a user is comparing —
 * `100%` and not `100.0%` — and the number of significant figures is not a fact
 * about the value. Unclamped for the reason below.
 *
 * ## It does not clamp, deliberately
 *
 * A plan needing 300 hosts in a 254-usable subnet is over capacity, and that is
 * the single most important thing on the screen. A clamped `100%` reads as
 * "full" and loses the fact that it does not fit. A caller drawing a progress
 * bar should clamp *for the bar*; the number stays honest.
 */
export const formatPercent = (value: number, decimals = 1): string => {
  if (!Number.isFinite(value)) return EM_DASH;
  if (decimals < 0 || !Number.isInteger(decimals)) return EM_DASH;

  const negative = value < 0;
  const magnitude = Math.abs(value);

  // toFixed, then strip the fractional part entirely if it is all zeros. Doing
  // this with string surgery rather than a number avoids a second rounding
  // step, and therefore avoids the classic 1.005 -> 1.00 surprise.
  const fixed = magnitude.toFixed(decimals);
  const dotIndex = fixed.indexOf('.');
  const whole = dotIndex === -1 ? fixed : fixed.slice(0, dotIndex);
  let fraction = dotIndex === -1 ? '' : fixed.slice(dotIndex + 1);
  fraction = fraction.replace(/0+$/, '');

  const sign = negative ? '-' : '';
  return `${sign}${groupDigits(whole)}${fraction.length > 0 ? `.${fraction}` : ''}%`;
};

/* ------------------------------------------------------------------ *
 * Addresses
 * ------------------------------------------------------------------ */

/**
 * Render a CIDR using its canonical network address.
 *
 * The engine's own `formatCidr` prints the address it was given, because
 * `192.168.1.50/24` is a legitimate *reference* to the network 192.168.1.0/24
 * and round-tripping the user's own input is correct behaviour. A screen
 * displaying an allocated subnet needs the other thing: the network the
 * allocation actually denotes. Both are right; they are different questions, so
 * they are different functions.
 */
export const formatNetworkCidr = (cidr: Cidr): string => {
  const mask = cidrToMask(cidr.prefix);
  const network = (cidr.ip & mask) >>> 0;
  return `${integerToIPv4(network)}/${cidr.prefix}`;
};

/** The address half of a CIDR, with no prefix. For split-IP layouts. */
export const formatNetworkAddress = (cidr: Cidr): string =>
  integerToIPv4((cidr.ip & cidrToMask(cidr.prefix)) >>> 0);

/** A prefix length as it is written on screen: `24` becomes `/24`. */
export const formatPrefixBadge = (prefix: number): string => `/${prefix}`;

/** A subnet mask in dotted-quad form, e.g. `255.255.255.0`. */
export const formatMaskDotted = (prefix: number): string => integerToIPv4(cidrToMask(prefix));

/**
 * A wildcard mask in dotted-quad form, e.g. `0.0.0.255`.
 *
 * Delegates to the engine's {@link calculateWildcardMask} rather than inverting
 * the mask here. The inversion is one line of `~mask >>> 0`, and it is still the
 * wrong thing to write: it is address arithmetic, and a second implementation of
 * it in the view layer is a second thing that can be wrong.
 */
export const formatWildcardDotted = (prefix: number): string =>
  integerToIPv4(calculateWildcardMask(prefix));

/** A VLAN ID as it is written on screen: `VLAN 10`. */
export const formatVlan = (vlanId: number): string => `VLAN ${vlanId}`;

/** An inclusive address range as one line: `192.168.1.1 - 192.168.1.254`. */
export const formatAddressRange = (start: number, end: number): string =>
  `${integerToIPv4(start)} - ${integerToIPv4(end)}`;

/* ------------------------------------------------------------------ *
 * Counts and prose
 * ------------------------------------------------------------------ */

/** A count with its unit, e.g. `1 subnet` or `12 subnets`. */
export const pluralize = (count: number, singular: string, plural?: string): string =>
  `${formatAddressCount(count)} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;

/** A bit count with its unit: `24 bits`, `1 bit`. */
export const formatBits = (count: number): string => `${formatAddressCount(count)} bit${
  count === 1 ? '' : 's'
}`;

/**
 * Trim the middle of a string, keeping both ends readable.
 *
 * Addresses, mask strings and file names are all most identifiable by their
 * first and last characters. Truncating the middle keeps `192.168.1.0/24` and
 * `203.0.113.0/24` distinguishable in a narrow column, where a trailing ellipsis
 * would render them identical.
 */
export const truncateMiddle = (text: string, maxLength: number): string => {
  if (maxLength < 1) return '';
  if (text.length <= maxLength) return text;

  const ellipsis = '…';
  // maxLength 1 or 2 cannot fit both an end and the ellipsis; returning the head
  // is better than a string longer than the caller asked for.
  if (maxLength <= ellipsis.length + 1) return text.slice(0, maxLength);

  const keep = maxLength - ellipsis.length;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}${ellipsis}${text.slice(text.length - tail)}`;
};
