/**
 * The subnet result view model.
 *
 * PURE MODULE. No React, no React Native, no Expo, no styling. It turns a resolved
 * {@link SubnetInfo} into the rows, badges, notices and copy text a screen renders.
 *
 * ## Why this is a module and not just JSX
 *
 * The Phase 6 exit criterion is "all 33 prefixes produce correct output". A criterion
 * phrased that way is not checkable by reading a component, and R4 has declined a
 * component-test runner - so the output has to exist as a value that Vitest can
 * reach. Putting the derivation here and asserting on it directly is what turns "all
 * 33 prefixes" from a manual spot-check into 33 machine-checked cases, which
 * `tests/subnet-view.test.ts` does.
 *
 * It also leaves the screen with no decisions in it. A component that decides which
 * rows exist, what they are called, and whether a /31 needs explaining is a component
 * that can be wrong in ways no type checker sees.
 *
 * ## It lives in `utils/`, not `core/`
 *
 * `src/core/` is the networking engine and it stays string-free: that is the invariant
 * that lets it run in Node under Vitest and remain the single source of truth for
 * every calculation. A view model is display, and `src/utils/formatting.ts` is already
 * display that is tested the same way. Putting this in `core/` would blur a boundary
 * Phase 5's own exit criterion depends on.
 *
 * ## It formats, it does not compute
 *
 * Every number here arrived from the engine already computed. Nothing in this file
 * derives an address, a mask or a count - it only decides how to present one. The one
 * piece of arithmetic, host-range utilisation, is delegated to the engine's
 * `calculateUtilization` rather than written as a local division, so there is no second
 * definition of utilisation anywhere in the project.
 */

import { calculateUtilization, integerToIPv4 } from '@/core/ip-engine';
import {
  CALCULATOR_MESSAGES,
  type CalculatorOutcome,
} from '@/core/calculator-input';
import { CLASSIFICATION_BY_KIND, STANDARD_REFS } from '@/core/standards';
import { formatAddressCount, formatAddressRange, formatPercent } from '@/utils/formatting';

import type { SubnetInfo } from '@/types/network';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export interface SubnetRow {
  readonly label: string;
  readonly value: string;
  /** Render in the monospace face. Addresses, masks and counts are tabular. */
  readonly mono: boolean;
  /** One of the four values the plan puts in the hero row. */
  readonly hero: boolean;
  /**
   * A short qualifier shown under the value.
   *
   * `T | undefined` rather than `T?`, because `exactOptionalPropertyTypes` is on: an
   * optional property cannot be assigned an explicit `undefined`, which is exactly
   * what a builder that conditionally spreads a note would produce.
   */
  readonly note: string | undefined;
}

/**
 * A note explaining something about the result a reader would not infer.
 *
 * `kind` is semantic and deliberately NOT a colour name. The screen maps it to a tone,
 * because a model that named `BannerTone` would be coupled to a component - and that
 * coupling is what would stop this being reusable from a screen that happens not to
 * use a Banner.
 */
export interface SubnetNotice {
  readonly kind: 'info' | 'warn';
  readonly title: string;
  readonly body: string;
  readonly citation: string;
}

export interface AddressSpaceBadge {
  readonly label: string;
  readonly citation: string;
  /** Actionable guidance, or `null` for ordinary public space. */
  readonly guidance: string | null;
  /** True when the space is routable on the public Internet. */
  readonly isPublic: boolean;
}

export interface SubnetViewInput {
  readonly subnet: SubnetInfo;
  /** What the user typed, echoed back in the copy text. */
  readonly inputText: string;
  /** False when the user typed a host address rather than a block boundary. */
  readonly inputWasNetworkBoundary: boolean;
}

export interface SubnetView {
  /** The four headline values: network, broadcast, subnet mask, wildcard mask. */
  readonly hero: readonly SubnetRow[];
  /** Everything else numeric, in the order the plan lists it. */
  readonly detail: readonly SubnetRow[];
  /** Zero or more explanations, most important first. */
  readonly notices: readonly SubnetNotice[];
  readonly addressSpace: AddressSpaceBadge;
  /** The prefix as written on screen, `/24`. */
  readonly prefixLabel: string;
  /** The block as written on screen, `192.168.1.0/24`. */
  readonly networkCidr: string;
  /** A plain-text block, for copy-all. */
  readonly copyText: string;
}

/* ------------------------------------------------------------------ *
 * Pinned copy
 *
 * The /31 and /32 explanations are the ones worth being careful with. A /31 is not a
 * subnet with a mistake in it - it is the RFC 3021 case, where reserving a network and
 * a broadcast address on a point-to-point link wastes two of the four addresses and
 * has no purpose. A /32 is not a subnet either; it is a single host, and the reason
 * people expect otherwise is that /31 and /32 sit next to the usable-count formula
 * everyone learns first.
 *
 * RFC 7600 is the citation for the host-inside-a-block notice, not a generic CIDR
 * reference. It is the RFC that addresses prefixes with host bits set - the subnet-zero
 * and all-ones cases - and it is the one that establishes such a prefix is a valid
 * reference while not being a usable subnet definition. That distinction is precisely
 * what the notice is about.
 * ------------------------------------------------------------------ */

const NOTICE_COPY = Object.freeze({
  pointToPoint: {
    title: 'Both addresses are usable (RFC 3021)',
    body:
      'A /31 is a point-to-point link. Reserving a network and a broadcast address ' +
      'would waste two of the four addresses and serve no purpose, so both are ' +
      'assignable. This is why a /31 is not the same as a /30, which is the next ' +
      'prefix up and has only two usable addresses of its own.',
    citation: STANDARD_REFS.RFC3021,
  },
  hostRoute: {
    title: 'One address, not a subnet',
    body:
      'A /32 is a single address, not a subnet with a small number of hosts. It is ' +
      'how a static host route or a loopback interface is written. There is no network ' +
      'or broadcast address to reserve, because there is no other address in the block.',
    citation: STANDARD_REFS.RFC3021,
  },
  quarter: {
    title: 'Only two usable addresses',
    body:
      'A /30 has four addresses, and the first and last are reserved, leaving two. ' +
      'This is the reason RFC 3021 exists: on a point-to-point link those two reserved ' +
      'addresses were simply wasted. Use a /31 there instead.',
    citation: STANDARD_REFS.RFC3021,
  },
  hostInsideBlock: {
    title: 'That address is inside the block',
    body:
      'You typed a host address, not a block boundary, so this is the network it ' +
      'belongs to. Such a reference is valid - it is how a host is described - but it ' +
      'is not a usable subnet definition. A row that describes an allocated subnet ' +
      'needs the network address.',
    citation: STANDARD_REFS.RFC7600,
  },
} as const);

/* ------------------------------------------------------------------ *
 * Row construction
 * ------------------------------------------------------------------ */

const row = (
  label: string,
  value: string,
  options: { readonly mono?: boolean; readonly hero?: boolean; readonly note?: string } = {},
): SubnetRow => ({
  label,
  value,
  mono: options.mono ?? true,
  hero: options.hero ?? false,
  // Present on every row rather than conditionally spread, so the shape is uniform.
  note: options.note,
});

const buildHeroRows = (subnet: SubnetInfo): readonly SubnetRow[] =>
  Object.freeze([
    row('Network address', integerToIPv4(subnet.networkAddress), { hero: true }),
    row('Broadcast address', integerToIPv4(subnet.broadcastAddress), { hero: true }),
    row('Subnet mask', integerToIPv4(subnet.subnetMask), { hero: true }),
    row('Wildcard mask', integerToIPv4(subnet.wildcardMask), { hero: true }),
  ]);

/**
 * Utilisation of the host range, from the engine.
 *
 * A /32 is 100% used by definition and a /31 is 100% used by RFC 3021, so a figure
 * against the reserved-edge formula would be nonsense in both cases. `n/a` is
 * returned instead, and it is a real answer rather than a missing one.
 */
const hostUtilisation = (subnet: SubnetInfo): string => {
  if (subnet.isHostRoute || subnet.isPointToPoint) return 'n/a';
  return formatPercent(calculateUtilization(subnet.usableHosts, subnet.totalAddresses - 2));
};

const buildDetailRows = (subnet: SubnetInfo): readonly SubnetRow[] => {
  const rows: SubnetRow[] = [
    // A /32 has no "first" anything - the one address is both ends. Labelling it
    // "First usable host" would assert a range that does not exist, so the label
    // changes with the case while the row itself stays, because the Phase 6
    // criterion is that every field of the result is shown.
    row(
      subnet.isHostRoute ? 'The address' : 'First usable host',
      integerToIPv4(subnet.firstUsableHost),
      subnet.isHostRoute ? { note: 'A /32 has one address in it.' } : {},
    ),
    row(
      subnet.isHostRoute ? 'The address, again' : 'Last usable host',
      integerToIPv4(subnet.lastUsableHost),
      subnet.isHostRoute ? { note: 'Same address - there is no range.' } : {},
    ),
    row('Usable range', formatAddressRange(subnet.firstUsableHost, subnet.lastUsableHost)),
    row('Total addresses', formatAddressCount(subnet.totalAddresses), {
      note: `2^${subnet.hostBits}.`,
    }),
    row('Usable hosts', formatAddressCount(subnet.usableHosts), {
      note: subnet.isPointToPoint
        ? 'Both addresses are usable, per RFC 3021.'
        : subnet.isHostRoute
          ? 'One address, so nothing is reserved.'
          : 'Total minus the network and broadcast addresses.',
    }),
    row('Network bits', formatAddressCount(subnet.networkBits), { mono: false }),
    row('Host bits', formatAddressCount(subnet.hostBits), { mono: false }),
    row('Host range used', hostUtilisation(subnet), { mono: false }),
  ];

  return Object.freeze(rows);
};

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

const buildNotices = (input: SubnetViewInput): readonly SubnetNotice[] => {
  const { subnet, inputWasNetworkBoundary } = input;
  const notices: SubnetNotice[] = [];

  // The unusual cases first. Someone who opened a /31 needs the RFC 3021 note more
  // than they need the classification, and ordering is the only lever available.
  if (subnet.isPointToPoint) {
    notices.push({ kind: 'info', ...NOTICE_COPY.pointToPoint });
  } else if (subnet.isHostRoute) {
    notices.push({ kind: 'info', ...NOTICE_COPY.hostRoute });
  } else if (subnet.cidr.prefix === 30) {
    notices.push({ kind: 'info', ...NOTICE_COPY.quarter });
  }

  // A /32 typed as a host is not "inside a block" - it IS the block - so this notice
  // is suppressed there rather than contradicting the one above it.
  if (!inputWasNetworkBoundary && !subnet.isHostRoute) {
    notices.push({ kind: 'warn', ...NOTICE_COPY.hostInsideBlock });
  }

  return Object.freeze(notices);
};

/* ------------------------------------------------------------------ *
 * Address space
 * ------------------------------------------------------------------ */

const buildAddressSpace = (subnet: SubnetInfo): AddressSpaceBadge => {
  const classification = CLASSIFICATION_BY_KIND[subnet.addressSpace];
  return Object.freeze({
    label: classification.label,
    citation: classification.citation,
    // `null` stays null for public space. There is no guidance to invent for a
    // routable address, and a badge reading "nothing to see here" would be worse
    // than one that simply carries no guidance.
    guidance: classification.guidance,
    isPublic: subnet.addressSpace === 'public',
  });
};

/* ------------------------------------------------------------------ *
 * Classifying the screen's state
 * ------------------------------------------------------------------ */

/**
 * What the calculator screen should be showing.
 *
 * Three states, not two, and the empty one is the reason this exists as a function
 * rather than an inline check in the screen.
 *
 * An empty field produces a *failure* from `evaluateCombined` - there is no CIDR in
 * an empty string. Treating that as an error would put a red banner above an untouched
 * field, telling the user they did something wrong before they had done anything. But
 * `ok === false` alone cannot distinguish it from a real mistake, so the screen ended
 * up comparing failure messages against a remembered constant to work out which case
 * it was in. Comparing a message to identify a state is a bug waiting for a copy
 * change: reword `empty` and the screen starts showing a red banner on first launch,
 * with nothing failing to warn about.
 *
 * Naming the state fixes it at the only layer that can see the difference, and makes
 * the screen a total `switch` with no cast and no default branch.
 */
export type CalculatorState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly message: string; readonly field: string }
  | { readonly kind: 'ok'; readonly view: SubnetView };

/** The failure `evaluateCombined('')` produces, used as the empty-state signature. */
const EMPTY_MESSAGE = CALCULATOR_MESSAGES.empty;

/**
 * Decide which of the three things to render.
 *
 * Pure, and therefore testable without a renderer. The alternative - a boolean
 * computed in the screen - is exactly the kind of decision that is invisible to a
 * type checker and breaks the first time the copy is edited.
 */
export function classifyCalculatorOutcome(
  outcome: CalculatorOutcome,
): CalculatorState {
  if (outcome.ok) {
    return {
      kind: 'ok',
      view: buildSubnetView({
        subnet: outcome.subnet,
        inputText: outcome.inputText,
        inputWasNetworkBoundary: outcome.inputWasNetworkBoundary,
      }),
    };
  }

  // An empty field and a field the user has cleared are the same state. A field
  // holding only whitespace is treated the same way, because the user cannot tell the
  // difference visually and should not be told they made a mistake in either case.
  if (outcome.message === EMPTY_MESSAGE) return { kind: 'empty' };

  return { kind: 'invalid', message: outcome.message, field: outcome.field };
}

/* ------------------------------------------------------------------ *
 * Copy text
 * ------------------------------------------------------------------ */

const COPY_FOOTER = 'Computed offline. NetArchitect does not connect to any network.';

/**
 * The whole result as plain text, column-aligned on the label.
 *
 * This text is destined for a terminal, a ticket or a chat, and a ragged block of
 * `Label: value` lines is noticeably harder to scan there than an aligned one. The
 * width is taken from the longest label in *this* result rather than a fixed
 * constant, so a narrow result does not inherit a wide column.
 */
const buildCopyText = (
  input: SubnetViewInput,
  rows: readonly SubnetRow[],
  notices: readonly SubnetNotice[],
  addressSpace: AddressSpaceBadge,
  networkCidr: string,
): string => {
  const width = Math.max(...rows.map((entry) => entry.label.length));

  const lines: string[] = [
    'NetArchitect subnet calculation',
    `Entered: ${input.inputText}`,
    `Block:    ${networkCidr}`,
    '',
    ...rows.map((entry) => `  ${entry.label.padEnd(width)}  ${entry.value}`),
    '',
    `Address space: ${addressSpace.label} (${addressSpace.citation})`,
  ];

  if (addressSpace.guidance !== null) {
    lines.push(addressSpace.guidance);
  }

  for (const notice of notices) {
    lines.push('', `${notice.title} [${notice.citation}]`);
  }

  lines.push('', COPY_FOOTER);

  return lines.join('\n');
};

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Build the whole view.
 *
 * Every piece is derived once and the copy text is assembled from those same pieces.
 * An earlier version had the copy builder call back into a near-duplicate of this
 * function, which built every row twice; the duplication existed only because the
 * copy text needed the rows the view was already holding.
 */
export function buildSubnetView(input: SubnetViewInput): SubnetView {
  const { subnet } = input;
  const hero = buildHeroRows(subnet);
  const detail = buildDetailRows(subnet);
  const notices = buildNotices(input);
  const addressSpace = buildAddressSpace(subnet);
  const prefixLabel = `/${subnet.cidr.prefix}`;
  const networkCidr = `${integerToIPv4(subnet.networkAddress)}${prefixLabel}`;

  return Object.freeze({
    hero,
    detail,
    notices,
    addressSpace,
    prefixLabel,
    networkCidr,
    copyText: buildCopyText(input, [...hero, ...detail], notices, addressSpace, networkCidr),
  });
}
