/**
 * Calculator input rules.
 *
 * PURE MODULE. No React, no React Native, no Expo, no styling. Everything here is
 * a function from what the user typed to either a resolved {@link SubnetInfo} or a
 * message explaining what to type instead.
 *
 * ## Why this exists separately from the engine
 *
 * The engine parses CIDR notation and nothing else: `parseCidr` requires a `/` and
 * rejects a space. That is correct for a CIDR - it is a defined notation, and
 * loosening it would change what every other caller of `parseCidr` means.
 *
 * A calculator *field* is not a CIDR, though. It is a box a person types into, and
 * what arrives there comes from a phone keyboard, a paste, or a habit. So this module
 * accepts the shapes a person actually produces and normalises them, then delegates
 * every judgement to the engine. It contains no networking logic whatsoever - if it
 * needed any, that would be a sign the engine should own it instead.
 *
 * ## Why a discriminated union rather than a nullable result
 *
 * `SubnetInfo | null` forces every caller to ask "is this null?" and a missed check
 * renders `undefined` in a subnet mask. Here the failure carries a `field`, so the
 * screen knows which input to mark without matching on the message text, and a
 * success cannot be destructured as a failure.
 *
 * ## The input rules, and why each one
 *
 * These were confirmed with the user rather than inferred, so they are decisions and
 * not accidents:
 *
 *   - **A leading slash on the prefix is accepted.** `/` sits on most phone numeric
 *     pads, so `/24` is a shape the platform actively invites. Rejecting it would be
 *     hostile to a keystroke.
 *   - **A space is accepted as the separator.** Pasting `192.168.1.50 24` from a
 *     document is common and unambiguous.
 *   - **A doubled separator is rejected.** `24/24` is two numbers in one field.
 *     Quietly picking one of them is the guessing this project refuses to do
 *     everywhere else, so it is reported rather than resolved.
 *   - **A missing prefix is a distinct error**, not a generic parse failure, because
 *     it is the most common thing a new user does and the fix is a visible example.
 */

import { isNetArchitectError } from './errors';
import { calculateSubnet, parseIPv4, parsePrefix } from './ip-engine';
import type { SubnetInfo } from '../types/network';

/** Which input a message belongs to, so the screen can mark the right one. */
export type CalculatorField = 'address' | 'prefix' | 'input';

/** How the calculator's inputs are arranged. */
export type CalculatorMode = 'combined' | 'split';

export type CalculatorOutcome =
  | {
      readonly ok: true;
      readonly subnet: SubnetInfo;
      /** True when the user typed a network address, false when they typed a host. */
      readonly inputWasNetworkBoundary: boolean;
      /** What the user actually typed, for echoing back in the copy text. */
      readonly inputText: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly field: CalculatorField;
    };

/* ------------------------------------------------------------------ *
 * Pinned user-facing copy
 *
 * Part of the product contract, asserted verbatim in
 * tests/calculator-input.test.ts so a copy change cannot land unnoticed.
 *
 * This is a separate registry from `MESSAGES` in validation.ts rather than an
 * extension of it. Those are attached as Zod schema issues and read by the form
 * layer; these come back as an outcome discriminant and are read by the screen.
 * Keeping them apart is what lets each string exist in exactly one place.
 * ------------------------------------------------------------------ */

export const CALCULATOR_MESSAGES = Object.freeze({
  /** Shown while the field is empty, or after the user clears it. */
  empty: 'Enter an address and prefix, for example 192.168.1.50/24.',

  /**
   * A lone address with no prefix. Deliberately its own message: it is the most
   * common first mistake, and naming the fix beats naming the fault.
   */
  missingPrefix: 'Add a prefix length, for example 192.168.1.50/24.',

  /** A lone prefix - `24` on its own. */
  prefixOnly: 'That is a prefix on its own. Enter an address too, for example 192.168.1.50/24.',

  /**
   * The `24/24` shape, and any other entry whose parts are both prefixes. Two prefix
   * lengths and no address is ambiguous, and this project will not guess which was
   * meant.
   *
   * There is deliberately no "the address is malformed" message here. A malformed
   * address is the engine's to describe, and its message is the authoritative one.
   */
  noAddress:
    'That is two prefix lengths with no address. Enter an address, for example 192.168.1.50/24.',

  /** More than one separator, e.g. `1.2.3.4/24/24`. */
  tooManyParts: 'Enter one address and one prefix, for example 192.168.1.50/24.',

  addressRequired: 'Enter the IPv4 address, for example 192.168.1.50.',
  prefixRequired: 'Enter the prefix length, 0 to 32, for example 24.',
} as const);

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

type Failure = Extract<CalculatorOutcome, { ok: false }>;

/**
 * A parse step, before it is folded into an outcome.
 *
 * This is a separate type from `CalculatorOutcome` on purpose. Returning
 * `T | CalculatorOutcome` and narrowing on `ok === false` leaves `T` sitting in a
 * union with the *success* object, so the compiler cannot tell a caller that a
 * successful parse yielded a number. Naming the success arm `{ ok: true; value: T }`
 * makes the narrowing total, which is the entire reason the guard exists.
 */
type Step<T> = { readonly ok: true; readonly value: T } | Failure;

const fail = (message: string, field: CalculatorField): Failure => ({
  ok: false,
  message,
  field,
});

const isFailure = (value: Step<unknown> | number): value is Failure => {
  if (typeof value === 'number') return false;
  return value.ok === false;
};

/**
 * Run an engine parse, turning a typed error into a field-scoped message.
 *
 * A non-NetArchitect error is rethrown rather than laundered into "type an address
 * properly". Bad input produces typed errors by design, so anything else is a bug,
 * and a bug behind a message about the user's typing is a bug nobody ever finds.
 */
const step = <T>(run: () => T, field: CalculatorField): Step<T> => {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (isNetArchitectError(error)) return fail(error.friendlyMessage, field);
    throw error;
  }
};

/** `true` when the text parses as an IPv4 address. Never throws. */
const isAddress = (text: string): boolean => {
  try {
    parseIPv4(text);
    return true;
  } catch {
    return false;
  }
};

/** `true` when the text parses as a prefix length. Never throws. */
const isPrefix = (text: string): boolean => {
  try {
    parsePrefix(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * The prefix as the user wrote it, minus any leading slash, for echoing back.
 *
 * The order of the two operations is load-bearing: trim FIRST, then strip slashes,
 * then trim again.
 *
 * Stripping first looks equivalent and is not. `'/24'.replace(/^\/+/, '')` is `'24'`,
 * but `'  /24 '` does not *begin* with a slash, so the anchored pattern matches
 * nothing and the result is `'/24'` with the slash still attached. The trim that
 * follows then leaves the slash in place, so a user who typed a padded `/24` and
 * switched layouts got `24` in one field and `/24` in the other.
 *
 * The trailing trim is there because stripping can expose whitespace that was hidden
 * behind the slash, as in `' / 24 '`, which a paste produces and a keyboard less so.
 */
const barePrefix = (raw: string): string => raw.trim().replace(/^\/+/, '').trim();

/* ------------------------------------------------------------------ *
 * Success construction
 * ------------------------------------------------------------------ */

const succeed = (ip: number, prefix: number, inputText: string): CalculatorOutcome => {
  const subnet = calculateSubnet(ip, prefix);
  return {
    ok: true,
    subnet,
    // The typed address is on its own block boundary when it equals the network
    // address the engine resolved. `192.168.1.0/24` is a boundary; `192.168.1.50/24`
    // is a reference to a host inside one. The screen says which, because a user who
    // typed a host address and is shown a network should be told why.
    inputWasNetworkBoundary: ip === subnet.networkAddress,
    inputText,
  };
};

/* ------------------------------------------------------------------ *
 * Combined field
 * ------------------------------------------------------------------ */

/**
 * Split a single-field entry into parts.
 *
 * `/` and any whitespace are both separators, and a run of them collapses, so
 * `192.168.1.50 / 24`, `192.168.1.50/24` and `192.168.1.50  24` all yield the same
 * two parts. Returns `null` for an empty entry, which the caller reports as the
 * empty state rather than as a parse failure.
 *
 * This deliberately does NOT stop at the first separator. `1.2.3.4/24/24` must come
 * back as three parts so the caller can reject it; splitting on the first separator
 * would silently truncate it to `1.2.3.4/24` and report success on malformed input.
 *
 * The character class is `[/\s]`, and the backslash there is load-bearing. Written as
 * `[/\\s]` - which is what an instinct borrowed from string escaping produces - it is
 * a class of slash, BACKSLASH and the letter `s`. A space then does not split, and
 * `192.168.1.50 24` comes back as one part and is reported as a missing prefix. That
 * failure is silent and entirely plausible, which is why it is written down here.
 */
const splitCombined = (raw: string): readonly string[] | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.split(/[/\s]+/).filter((part) => part.length > 0);
};

/**
 * Evaluate a single combined field such as `192.168.1.50/24`.
 *
 * Accepts `a.b.c.d/p`, `a.b.c.d p`, a bare `p` or a `/p` prefix, and any mixture of
 * `/` and whitespace as the separator. Rejects an empty field, a lone address, a
 * lone prefix, two prefixes, and any entry with more than two parts.
 */
export function evaluateCombined(raw: string): CalculatorOutcome {
  const parts = splitCombined(raw);

  if (parts === null || parts.length === 0) return fail(CALCULATOR_MESSAGES.empty, 'input');

  if (parts.length > 2) return fail(CALCULATOR_MESSAGES.tooManyParts, 'input');

  if (parts.length === 1) {
    // One part and no separator. Both recoverable mistakes, and they need different
    // corrections: `24` is a prefix that needs an address, while `192.168.1.50` is an
    // address that needs a prefix. Telling a user to add a prefix they already typed
    // reads as the app not understanding them.
    const only = parts[0] as string;
    if (isPrefix(only) && !isAddress(only)) return fail(CALCULATOR_MESSAGES.prefixOnly, 'input');
    return fail(CALCULATOR_MESSAGES.missingPrefix, 'input');
  }

  const addressPart = parts[0] as string;
  const prefixPart = parts[1] as string;

  // Shape detection only, and only for the ambiguous case. `24/24` has an address
  // slot holding a prefix, and saying so is clearer than "not a valid IPv4 address"
  // for something that is in fact a well-formed prefix in the wrong place.
  //
  // Everything else falls through to the parser. An earlier version tested
  // `isAddress` first and reported any failure as a generic badAddressPart, which
  // cost two things: `192.168.1.500/24` was blamed on the whole field rather than on
  // the address, and the engine's own message - which is the authoritative one and is
  // pinned by 100 tests - never reached the user. Reimplementing that judgement here
  // is exactly the duplicate-source-of-truth this project refuses to create.
  if (!isAddress(addressPart) && isPrefix(addressPart) && isPrefix(prefixPart)) {
    return fail(CALCULATOR_MESSAGES.noAddress, 'input');
  }

  const ip = step(() => parseIPv4(addressPart), 'address');
  if (isFailure(ip)) return ip;

  const prefix = step(() => parsePrefix(prefixPart), 'prefix');
  if (isFailure(prefix)) return prefix;

  return succeed(ip.value, prefix.value, raw.trim());
}

/* ------------------------------------------------------------------ *
 * Split fields
 * ------------------------------------------------------------------ */

/**
 * Evaluate separate address and prefix fields, for a tablet layout.
 *
 * Reported per field rather than as one message, because "the prefix is wrong" and
 * "the address is wrong" need different corrections and the screen has two boxes to
 * mark. Address is checked first: a half-typed address is the more common state
 * while typing, and reporting it first means the error does not flicker between the
 * two fields on every keystroke.
 */
export function evaluateSplit(address: string, prefix: string): CalculatorOutcome {
  const addressText = address.trim();
  const prefixText = prefix.trim();

  if (addressText.length === 0) return fail(CALCULATOR_MESSAGES.addressRequired, 'address');
  if (prefixText.length === 0) return fail(CALCULATOR_MESSAGES.prefixRequired, 'prefix');

  const ip = step(() => parseIPv4(addressText), 'address');
  if (isFailure(ip)) return ip;

  const length = step(() => parsePrefix(prefixText), 'prefix');
  if (isFailure(length)) return length;

  return succeed(ip.value, length.value, `${addressText}/${barePrefix(prefixText)}`);
}

/* ------------------------------------------------------------------ *
 * Converting between the two input layouts
 *
 * Both are pure string functions, and both live here rather than in the component
 * that calls them. A layout switch is not a detail of rendering: `compose` has to
 * decide what a half-filled entry becomes, and getting that wrong silently deletes
 * what the user typed. Under R4 the only way to prove it does not is to have it here
 * where Vitest can reach it, so `tests/calculator-input.test.ts` covers both.
 * ------------------------------------------------------------------ */

/**
 * Split already-typed text into the two separate fields.
 *
 * Returns `null` when the current text is not something that can be decomposed - an
 * empty field, a half-typed address, or a failure. Switching into the split layout
 * from an unparseable state must not invent a decomposition of it, because that
 * would change what the user typed without them doing anything.
 *
 * On success it echoes back what the user wrote, not the network the engine resolved
 * to. Someone who typed `192.168.1.50/24` and switches layouts is looking at the same
 * entry decomposed; being shown `192.168.1.0` instead would be the app quietly
 * rewriting their input.
 */
export function decomposeCombined(combined: string): { address: string; prefix: string } | null {
  const parts = splitCombined(combined);
  // Exactly two parts, both already validated by the same rules the field uses. This
  // reuses `splitCombined` rather than parsing again, so a shape the evaluator
  // accepts and a shape this accepts cannot drift apart.
  if (parts === null || parts.length !== 2) return null;
  if (!isAddress(parts[0] as string) || !isPrefix(parts[1] as string)) return null;
  return { address: parts[0] as string, prefix: barePrefix(parts[1] as string) };
}

/**
 * Reassemble the two fields into the single-field form.
 *
 * The half-empty cases are the whole point. A layout switch must never discard
 * something the user typed, and there are two ways to arrive with only one field
 * filled:
 *
 *   address only -> `192.168.1.50`  reports "add a prefix length"
 *   prefix only  -> `24`            reports "that is a prefix on its own"
 *
 * Returning `''` for the second case silently deleted the 24 the user had just typed,
 * and did it convincingly: the field went blank and the empty state appeared, as though
 * the app had reset itself. Both forms above are the honest rendering of half an entry,
 * and each yields a message naming which half is missing - which is the entire reason
 * the evaluator tolerates an incomplete field in the first place.
 */
export function composeSplit(address: string, prefix: string): string {
  const trimmedAddress = address.trim();
  const trimmedPrefix = barePrefix(prefix);
  if (trimmedAddress.length === 0) return trimmedPrefix;
  return trimmedPrefix.length === 0 ? trimmedAddress : `${trimmedAddress}/${trimmedPrefix}`;
}

/* ------------------------------------------------------------------ *
 * The input the screen should start with
 * ------------------------------------------------------------------ */

/**
 * A neutral starting example, offered as a placeholder rather than as a result.
 *
 * This is an empty-state hint and nothing more. The screen's premise is that a
 * number on screen is one the engine computed from the user's input, so an example
 * is never pre-filled as if it were an answer - the user has to type it for it to
 * become one.
 */
export const CALCULATOR_PLACEHOLDER = '192.168.1.50/24';

/** The same example rendered as the two separate fields, so both agree. */
export const CALCULATOR_PLACEHOLDER_ADDRESS = '192.168.1.50';
export const CALCULATOR_PLACEHOLDER_PREFIX = '24';
