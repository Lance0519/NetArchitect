/**
 * The VLSM result view model.
 *
 * PURE MODULE. No React, no React Native, no Expo, no styling. It turns a
 * {@link VlsmResult} into the table rows, summary figures, notices and bar segments a
 * screen renders, and a {@link VlsmOutcome} into whatever the screen should say when
 * there is no result at all.
 *
 * ## Why this is a module and not just JSX
 *
 * The Phase 7 exit criteria are "the spec example reproduces exactly", "exhaustion is
 * recoverable" and "the table scrolls without clipping". The first two are checkable
 * only by rendering something, and R4 has declined a component-test runner - so the
 * output has to exist as a value Vitest can reach. The third is not checkable at all
 * without a device, and is recorded as unverified rather than claimed.
 *
 * Keeping the derivation here also leaves the screen with no decisions in it. A
 * component that decides what the columns are, when a /31 needs explaining and how wide
 * a bar segment should be can be wrong in ways no type checker sees.
 *
 * ## It formats, it does not compute
 *
 * Every number here arrived from the engine already computed. Nothing in this file
 * derives an address, a mask, a count or a percentage - `spaceUtilisationPercent`,
 * `hostEfficiencyPercent` and each allocation's `utilisationPercent` are all read, not
 * recalculated. The only arithmetic is the width of a bar segment, which is a share of
 * a whole and has no other home.
 *
 * ## Why there is no VLAN column
 *
 * The plan lists VLAN as an optional column here. It is not built, because the VLSM
 * screen has no VLAN input and inventing a placeholder column of dashes teaches the
 * reader nothing. VLANs arrive with the "Send to Network Planner" action, which is the
 * screen that collects them. Recorded as a Phase 7 deviation in `PLAN.md`.
 */

import { integerToIPv4 } from '@/core/ip-engine';
import { ROLE_DEFINITION_BY_ROLE } from '@/core/roles';
import { STANDARD_REFS } from '@/core/standards';
import type { VlsmOutcome } from '@/core/vlsm-input';
import { formatAddressCount, formatAddressRange, formatPercent } from '@/utils/formatting';

import type { Allocation, NetworkRole, VlsmResult } from '@/types/network';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/**
 * One line of the allocation table.
 *
 * Every field is already a string. The table is a `ScrollView` of `AppText`, and
 * formatting at the edge keeps the row component free of decisions while still letting
 * Vitest assert on the exact text a user will read.
 */
export interface VlsmTableRow {
  /** The draft row id. The React key, and the target of an inline exhaustion error. */
  readonly id: string;
  readonly name: string;
  readonly role: NetworkRole;
  readonly roleLabel: string;
  /** Drives the bar colour and the trust badge, and the Phase 11 audit. */
  readonly isUntrusted: boolean;
  /** True when the block was packed as an RFC 3021 link, so no network/broadcast exist. */
  readonly isPointToPoint: boolean;
  readonly cidr: string;
  readonly network: string;
  readonly broadcast: string;
  readonly firstHost: string;
  readonly lastHost: string;
  readonly capacity: string;
  readonly requested: string;
  /** Requested as a share of capacity, e.g. `79.4%`. */
  readonly utilisation: string;
  /** Addresses inside the block that no requirement asked for. */
  readonly wasted: string;
}

/** A run of unallocated addresses inside the parent. */
export interface FreeRangeRow {
  readonly cidr: string;
  readonly range: string;
  readonly addresses: string;
  /**
   * True when the run is too small to be useful.
   *
   * The engine calls this "fragmented". A /28 of stranded addresses is a real result and
   * is reported, but it is flagged so the reader is not offered four addresses as if
   * they were a subnet to plan with.
   */
  readonly isFragmented: boolean;
}

/** A headline figure in the summary card. */
export interface VlsmSummaryFigure {
  readonly label: string;
  readonly value: string;
  /** A short qualifier, e.g. `of 256 total`. */
  readonly detail: string | null;
  /** Render the value in the monospace face. Counts are tabular. */
  readonly mono: boolean;
}

export interface VlsmSummary {
  readonly parentCidr: string;
  readonly figures: readonly VlsmSummaryFigure[];
  readonly freeRanges: readonly FreeRangeRow[];
  /** How many requirements were packed. */
  readonly subnetCount: number;
  /** True when the parent is completely used, so there is no room to grow. */
  readonly isFull: boolean;
}

export interface VlsmNotice {
  readonly kind: 'info' | 'warn';
  readonly title: string;
  readonly body: string;
  readonly citation: string;
}

/**
 * One segment of the stacked bar.
 *
 * `share` is a fraction of the parent, and the shares of a result sum to 1. That is
 * asserted in the tests rather than assumed, because a bar whose segments do not add up
 * silently misreports how full the address space is - the one number the bar exists to
 * convey.
 */
export interface VlsmBarSegment {
  readonly id: string;
  readonly label: string;
  readonly share: number;
  readonly isFree: boolean;
  readonly role: NetworkRole | null;
  /** Fraction of the bar's width, as a percentage, for the accessibility label. */
  readonly percentLabel: string;
}

export interface VlsmView {
  readonly rows: readonly VlsmTableRow[];
  readonly summary: VlsmSummary;
  readonly notices: readonly VlsmNotice[];
  readonly segments: readonly VlsmBarSegment[];
}

/* ------------------------------------------------------------------ *
 * Pinned copy
 *
 * Each of these is a claim about address space, so each carries the reference that
 * supports it. The VLSM screen has three things worth explaining that the numbers alone
 * do not: a /31 that looks too small, address space stranded below a misaligned block,
 * and carved-out space that is mostly unused.
 * ------------------------------------------------------------------ */

const NOTICE_COPY = Object.freeze({
  pointToPoint: {
    title: 'Point-to-point links are sized as /31',
    body:
      'A link between exactly two devices is packed as a /31, where both addresses are ' +
      'usable. Reserving a network and a broadcast address on a link with no third ' +
      'device to receive them would waste two of every four addresses. The same device ' +
      'count on a LAN is a /30, because a LAN does have other devices on it.',
    citation: STANDARD_REFS.RFC3021,
  },
  fragmented: {
    title: 'Some free space is too small to use',
    body:
      'Subnets are aligned to their own size, so a block that cannot start where the ' +
      'previous one ended skips the addresses below it. Those gaps are reported as free ' +
      'space because they are genuinely unallocated, but a run this small cannot hold a ' +
      'subnet worth planning. The alternative - packing a block onto an address that is ' +
      'not its network boundary - produces a subnet no router will accept.',
    citation: STANDARD_REFS.RFC7600,
  },
  noFreeSpace: {
    title: 'The parent is fully allocated',
    body:
      'Every address in the parent is now spoken for, so there is no room left for a ' +
      'new subnet without enlarging the block or reducing a requirement. This is worth ' +
      'knowing before you add the next one, rather than after.',
    citation: '',
  },
  wasteful: (name: string, requested: string, capacity: string) => ({
    title: `${name} is mostly unused`,
    body:
      `${name} asked for ${requested} hosts and was given a block of ${capacity}. ` +
      'Subnet sizes are powers of two, so a block is never sized to a requirement ' +
      'exactly, and the usual cause of a gap this size is a requirement sitting just ' +
      'above a power of two: asking for 65 hosts needs a block of 126, because the size ' +
      'below it holds only 62. If the headroom is not wanted, the block can often be ' +
      'shared with another requirement of a similar size - which is what the planner is ' +
      'for.',
    citation: '',
  }),
} as const);

/**
 * Below this, a block is mostly wasted space.
 *
 * A fixed threshold rather than a derived one on purpose. Any formula would be a claim
 * about what a good VLSM plan looks like, and the honest amount of waste in a real plan
 * depends on the network. Two thirds is the point at which a block is more empty than
 * full, which is a fact about the block rather than a judgement about the plan.
 */
const LOW_UTILISATION_PERCENT = 66.7;

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

/** Addresses as text, e.g. `254`. */
const count = (value: number): string => formatAddressCount(value);

const tableRow = (allocation: Allocation): VlsmTableRow => {
  const { subnet } = allocation;
  const definition = ROLE_DEFINITION_BY_ROLE[allocation.role];
  return {
    id: allocation.id,
    name: allocation.name,
    role: allocation.role,
    roleLabel: definition.label,
    isUntrusted: definition.isUntrusted,
    // A /31 has no network or broadcast address, so the first and last addresses are
    // both usable hosts. That is the whole point of RFC 3021. Read off the engine's own
    // flag rather than re-derived from the prefix, so this cannot disagree with the
    // engine about what a /31 is.
    isPointToPoint: subnet.isPointToPoint,
    cidr: allocation.assignedCidr,
    network: integerToIPv4(subnet.networkAddress),
    broadcast: integerToIPv4(subnet.broadcastAddress),
    firstHost: integerToIPv4(subnet.firstUsableHost),
    lastHost: integerToIPv4(subnet.lastUsableHost),
    capacity: count(subnet.usableHosts),
    requested: count(allocation.requestedHosts),
    utilisation: formatPercent(allocation.utilisationPercent),
    wasted: count(allocation.wastedAddresses),
  };
};

/**
 * Build the whole view for a successful allocation.
 *
 * No error plumbing, deliberately. The table only ever renders when the outcome is `ok`,
 * and `ok` means every row validated and the packer succeeded - so there is no error to
 * attach to a table row. Errors belong to the requirement list, which is on screen at the
 * same time and is where the user is looking. An earlier version threaded a `rowErrors`
 * map through here for symmetry with the calculator's result card; it could never be
 * non-empty, and an unreachable parameter is a lie about what this accepts.
 */
export const buildVlsmView = (result: VlsmResult): VlsmView => ({
  rows: result.allocations.map(tableRow),
  summary: buildSummary(result),
  notices: buildNotices(result),
  segments: buildSegments(result),
});

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

const buildSummary = (result: VlsmResult): VlsmSummary => {
  const figures: VlsmSummaryFigure[] = [
    {
      label: 'Allocated',
      value: count(result.allocatedAddresses),
      detail: `of ${count(result.totalAddresses)} in the parent`,
      mono: true,
    },
    {
      label: 'Free',
      value: count(result.freeAddresses),
      detail: result.freeAddresses === 0 ? 'nothing left' : 'still unallocated',
      mono: true,
    },
    {
      // Read from the engine, not recomputed. Space utilisation and host efficiency are
      // different questions and both are already answered there.
      label: 'Space used',
      value: formatPercent(result.spaceUtilisationPercent),
      detail: 'of the parent block',
      mono: false,
    },
    {
      label: 'Host efficiency',
      value: formatPercent(result.hostEfficiencyPercent),
      // Describes what the engine actually computes: usable / allocated, i.e. how much
      // of the carved-out space is lost to network and broadcast addresses. It is NOT
      // the share a requirement asked for - that is per-row `utilisation`, and confusing
      // the two would put a number on screen that answers a question nobody asked.
      detail: 'of allocated addresses can be assigned to hosts',
      mono: false,
    },
  ];

  return {
    parentCidr: `${integerToIPv4(result.parentCidr.ip)}/${result.parentCidr.prefix}`,
    figures,
    freeRanges: result.freeRanges.map((free) => ({
      cidr: free.cidr,
      range: formatAddressRange(free.start, free.end),
      addresses: count(free.addresses),
      isFragmented: free.isFragmented,
    })),
    subnetCount: result.allocations.length,
    isFull: result.freeAddresses === 0,
  };
};

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

const buildNotices = (result: VlsmResult): readonly VlsmNotice[] => {
  const notices: VlsmNotice[] = [];

  if (result.allocations.some((allocation) => allocation.subnet.isPointToPoint)) {
    notices.push({ kind: 'info', ...NOTICE_COPY.pointToPoint });
  }

  if (result.freeRanges.some((free) => free.isFragmented)) {
    notices.push({ kind: 'warn', ...NOTICE_COPY.fragmented });
  }

  if (result.freeAddresses === 0) {
    notices.push({ kind: 'warn', ...NOTICE_COPY.noFreeSpace });
  }

  // Per block, not aggregate, and it names the block. An aggregate "your plan is 51%
  // efficient" is neither actionable nor true of any particular row, whereas "Students
  // asked for 65 and got 126" points straight at the number to change.
  //
  // The threshold is compared against `utilisationPercent`, which the engine already
  // computes per allocation. Nothing here divides, so the "this view formats, it does not
  // compute" rule still holds.
  const worst = result.allocations
    .filter((allocation) => allocation.utilisationPercent < LOW_UTILISATION_PERCENT)
    .sort((a, b) => a.utilisationPercent - b.utilisationPercent)[0];

  if (worst !== undefined) {
    notices.push({
      kind: 'info',
      ...NOTICE_COPY.wasteful(
        worst.name,
        formatAddressCount(worst.requestedHosts),
        formatAddressCount(worst.subnet.usableHosts),
      ),
    });
  }

  return notices;
};

/* ------------------------------------------------------------------ *
 * The bar
 * ------------------------------------------------------------------ */

const buildSegments = (result: VlsmResult): readonly VlsmBarSegment[] => {
  const total = result.totalAddresses;
  if (total === 0) return [];

  // A share of the whole, guarded. `total` is a power of two and so is every block
  // inside it, so the division is exact in binary floating point and the shares sum to
  // 1 to the last bit. The test asserts the sum rather than trusting this comment.
  const share = (addresses: number): number => addresses / total;

  const allocated: VlsmBarSegment[] = result.allocations.map((allocation) => ({
    id: allocation.id,
    label: allocation.name,
    share: share(allocation.subnet.totalAddresses),
    isFree: false,
    role: allocation.role,
    percentLabel: formatPercent(share(allocation.subnet.totalAddresses) * 100),
  }));

  const free: VlsmBarSegment[] = result.freeRanges.map((entry, index) => ({
    id: `free-${index}`,
    label: 'Free',
    share: share(entry.addresses),
    isFree: true,
    role: null,
    percentLabel: formatPercent(share(entry.addresses) * 100),
  }));

  return [...allocated, ...free];
};

/* ------------------------------------------------------------------ *
 * The no-result states
 * ------------------------------------------------------------------ */

/**
 * The notice an outcome should show, or `null` when there is nothing to say.
 *
 * `empty` returns `null` rather than an empty notice. An empty draft is not a problem
 * and the screen has its own empty state with copy written for it; a notice card saying
 * "nothing here" on top of that would be two messages for one condition.
 *
 * `ok` also returns `null`, because the result is rendered rather than described.
 */
export const outcomeNotice = (outcome: VlsmOutcome): VlsmNotice | null => {
  switch (outcome.kind) {
    case 'empty':
    case 'ok':
      return null;

    case 'parent-invalid':
      return {
        kind: 'warn',
        title: 'Check the parent block',
        body: outcome.message,
        citation: '',
      };

    case 'rows-invalid': {
      const unfinished = outcome.messages.size;
      return {
        kind: 'warn',
        // The count is in the title rather than the body because it is the one number
        // that tells the user how much work is left.
        title: `Finish ${unfinished} requirement${unfinished === 1 ? '' : 's'}`,
        // The per-row messages are rendered beside the rows themselves, where the user
        // is looking. Repeating them here would be a summary of a list, not an answer,
        // so this says what a requirement needs and how the rest are doing instead.
        body:
          (outcome.validCount > 0
            ? `The other ${outcome.validCount} ${
                outcome.validCount === 1 ? 'is' : 'are'
              } ready. `
            : '') +
          'Each requirement needs a name and a number of hosts. Anything still blank is ' +
          'left out of the calculation rather than counted as an error.',
        citation: '',
      };
    }

    case 'exhausted': {
      const body = [outcome.message];
      if (outcome.shortfallAddresses > 0) {
        body.push(
          `That is ${formatAddressCount(
            outcome.shortfallAddresses,
          )} more addresses than the parent has.`,
        );
      }
      if (outcome.suggestion !== null) {
        body.push(`These requirements do fit in ${outcome.suggestion}.`);
      } else {
        // Silence would read as "there is no fix". Saying the parent is not the problem
        // sends the user to the right place, which is the requirement list.
        body.push(
          'No nearby parent block is large enough, so the fix is to reduce a requirement ' +
            'rather than to enlarge the block.',
        );
      }
      return {
        kind: 'warn',
        title: 'These requirements do not fit',
        body: body.join(' '),
        citation: '',
      };
    }
  }
};

/**
 * The requirement rows to hand to the Network Planner.
 *
 * Derived from the outcome rather than from the draft, so what the planner receives is
 * exactly what was packed. A handoff that re-read the draft could pass a requirement the
 * table never showed, or a stale one from before the last keystroke.
 */
export const handoffOf = (outcome: VlsmOutcome) => {
  if (outcome.kind !== 'ok') return null;
  return {
    parentCidr: `${integerToIPv4(outcome.parent.ip)}/${outcome.parent.prefix}`,
    requirements: outcome.requirements.map((requirement) => ({
      id: requirement.id,
      name: requirement.name,
      requestedHosts: requirement.requestedHosts,
      role: requirement.role,
    })),
    /**
     * The allocation as packed, so the planner can open showing real subnets instead of
     * re-deriving them and risking a different answer.
     */
    allocations: outcome.result.allocations.map((allocation) => ({
      id: allocation.id,
      name: allocation.name,
      role: allocation.role,
      cidr: allocation.assignedCidr,
    })),
  };
};

/**
 * A plain-text table of the allocation, for a paste into a change ticket.
 *
 * Tab-separated on purpose: it pastes into a spreadsheet as columns rather than as one
 * long cell, which is where an allocation list usually ends up.
 */
export const buildVlsmText = (result: VlsmResult): string => {
  const header = ['Name', 'Role', 'CIDR', 'Network', 'Broadcast', 'First', 'Last', 'Capacity', 'Requested', 'Used'];
  const lines = result.allocations.map((allocation) => {
    const row = tableRow(allocation);
    return [
      row.name,
      row.roleLabel,
      row.cidr,
      row.network,
      row.broadcast,
      row.firstHost,
      row.lastHost,
      row.capacity,
      row.requested,
      row.utilisation,
    ];
  });
  return [header, ...lines].map((cells) => cells.join('\t')).join('\n');
};
