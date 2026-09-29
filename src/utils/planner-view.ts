/**
 * The planner view model.
 *
 * PURE MODULE. No React, no React Native, no Expo, no styling. It turns a {@link PlanDraft}
 * and the {@link PlannerOutcome} it produces into the rows, notices and summary a screen
 * renders.
 *
 * ## Why this is a module and not just JSX
 *
 * Same reason as `vlsm-view.ts`. R4 has declined a component-test runner, so anything the
 * planner decides has to exist as a value Vitest can reach. The decisions are real ones:
 * which derived columns a row shows, when a row needs a VLAN, what the plan-level figures
 * are, and what the screen should say when there is no plan yet.
 *
 * Keeping the derivation here also leaves the screen with no decisions in it. A component
 * that decides what the columns are and when a /31 needs explaining can be wrong in ways
 * no type checker sees.
 *
 * ## It formats, it does not compute
 *
 * Every address, count and per-row percentage here was produced by the engine or by
 * `evaluatePlan`, and is *read* rather than recalculated - including the row's
 * utilisation, which comes from the engine's `calculateUtilization` so that a row and the
 * Phase 7 table showing the same allocation cannot disagree about it.
 *
 * There is exactly one place this file sums: the plan's claimed-address total, and the
 * parent-space figures that depend on it. The subnets do not carry their own sizes, and
 * the parent block is not among them, so the bar's numerator and denominator have to be
 * built from the engine here. That sum is a total of values already on screen, not a
 * networking calculation, and it is called out below.
 *
 * ## Severity is not assigned here
 *
 * A finding from `evaluatePlan` is a true statement, not a security judgement. Phase 11's
 * auditor is what turns findings into `SecurityIssue`s with a severity, a citation and a
 * remediation. Presenting an overlap as "critical" from this module would be a security
 * claim made by a formatting layer, which is precisely the kind of unattributed advice the
 * standards registry exists to prevent. So `PlanNoticeKind` is `'info' | 'warn'` and not
 * a severity, and the findings are rendered as text.
 */

import { calculateSubnet, calculateUtilization, formatCidr, integerToIPv4, parseCidr } from '@/core/ip-engine';
import { ROLE_DEFINITION_BY_ROLE, roleLabel } from '@/core/roles';
import { EM_DASH, formatAddressCount, formatPercent } from '@/utils/formatting';
import type { PlanDraft, PlanFinding, PlannerOutcome, ResolvedRow } from '@/core/planner-input';

import type { NetworkPlan, NetworkRole } from '../types/network';

/* ------------------------------------------------------------------ *
 * Read-only columns
 * ------------------------------------------------------------------ */

/** The derived, read-only figures shown for one row. Every value is already computed. */
export interface PlanRowView {
  readonly id: string;
  readonly name: string;
  readonly role: NetworkRole;
  /** The role's label from the shared table, or the custom label the user gave. */
  readonly roleLabel: string;
  /** VLAN ID as text, or `'untagged'` for a segment with no VLAN. */
  readonly vlan: string;
  /** The gateway as text, or `'none'` for a deliberately gateway-less row. */
  readonly gateway: string;
  /** Canonical CIDR of the row's block. */
  readonly cidr: string;
  readonly network: string;
  readonly mask: string;
  readonly broadcast: string;
  readonly firstHost: string;
  readonly lastHost: string;
  /**
   * `firstHost – lastHost`, or the em dash for a row that does not parse.
   *
   * Composed here rather than in the row component. Interpolating two em dashes with a
   * dash between them renders as `— – —`, which reads as three blank values the user has
   * to decode; here the unresolved case is one dash, once, which is what it means.
   */
  readonly range: string;
  /** Usable host addresses in the block. */
  readonly capacity: string;
  /** Host count the user asked for. */
  readonly requested: string;
  /**
   * `requested of capacity`, or the em dash for a row that does not parse.
   *
   * The pair worth reading on any plan: a block far larger than its requirement is the
   * usual sign of a size that was rounded up. Composed here for the same reason as
   * {@link range}.
   */
  readonly hostsUsed: string;
  /** requested / capacity as a percentage string. Never clamped - see `utilizationOf`. */
  readonly utilization: string;
  /**
   * True when the requested count exceeds what the block holds.
   *
   * A real and common mistake - a /27 marked for 50 hosts - and one the user needs told
   * about on the row rather than discovered later. It is NOT a finding, because the plan
   * still exists and is still what the user wrote.
   */
  readonly overCapacity: boolean;
  /** The row's error, or `null` when it parses. */
  readonly error: string | null;
  /** True when this row takes part in at least one finding, for the row's marker. */
  readonly hasConflict: boolean;
  /** The findings naming this row, for the inline detail under the row. */
  readonly conflicts: readonly string[];
  /** Position, zero-based. Used for "move up / move down" bounds and for ordering. */
  readonly index: number;
  /** False for the first row, so the screen can disable the control. */
  readonly canMoveUp: boolean;
  /** False for the last row, so the screen can disable the control. */
  readonly canMoveDown: boolean;
  /** False for the only row, so the screen can disable remove. */
  readonly canRemove: boolean;
}

/* ------------------------------------------------------------------ *
 * Plan-level figures
 * ------------------------------------------------------------------ */

/** The plan's totals, for the header card. */
export interface PlanSummary {
  /** Canonical parent CIDR. */
  readonly parent: string;
  /** Total addresses in the parent, from the engine. */
  readonly parentAddresses: string;
  /** Addresses the plan's subnets claim. */
  readonly claimed: string;
  /** Addresses still free in the parent. */
  readonly free: string;
  /** claimed / parent, as a percentage string. */
  readonly utilization: string;
  /** True when the plan claims more addresses than the parent holds. */
  readonly overParent: boolean;
  /** Number of rows that parsed into subnets. */
  readonly subnetCount: string;
  /** Number of findings, as a count. Zero renders as no banner at all. */
  readonly findingCount: string;
}

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

export type PlanNoticeKind = 'info' | 'warn';

/**
 * A notice for the outcome as a whole.
 *
 * `empty` and `ready` return `null`. An empty draft has its own empty state, and a ready
 * draft is rendered rather than described - putting a card saying "here is your plan" above
 * the plan would be two messages for one condition.
 */
export interface PlanNotice {
  readonly kind: PlanNoticeKind;
  readonly title: string;
  readonly body: string;
}

/* ------------------------------------------------------------------ *
 * The view
 * ------------------------------------------------------------------ */

export interface PlanView {
  /** The plan, when one exists. The screen's save action needs this and nothing else. */
  readonly plan: NetworkPlan | null;
  readonly rows: readonly PlanRowView[];
  readonly summary: PlanSummary | null;
  readonly notice: PlanNotice | null;
  /** Findings, grouped by row id, so each row can show its own. */
  readonly conflictsByRow: ReadonlyMap<string, readonly string[]>;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Build the whole planner view.
 *
 * One function, called once per settled keystroke, so the screen has no decisions in it.
 * Every branch is driven by the outcome's `kind`, which is exhaustive by construction -
 * there is no fifth state and no default branch to hide one.
 */
export const buildPlanView = (draft: PlanDraft, outcome: PlannerOutcome): PlanView => {
  const conflictsByRow = groupConflictsByRow(outcome);
  return {
    plan: outcome.kind === 'ready' ? outcome.plan : null,
    rows: buildRows(draft, outcome, conflictsByRow),
    // The finding count is threaded in from the outcome rather than recomputed from the
    // plan. A `NetworkPlan` is a document; whether two of its subnets overlap is a fact
    // about the evaluation that produced it, and reconstructing that here would be a third
    // implementation of the same rule - free to disagree with the other two.
    summary: outcome.kind === 'ready' ? buildSummary(outcome.plan, outcome.findings.length) : null,
    notice: planNotice(outcome),
    conflictsByRow,
  };
};

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

const UNTAGGED = 'untagged';
const NONE = 'none';

/**
 * One view row per draft row, in draft order.
 *
 * Including the rows that do not parse. A row editor that removes a row from the display
 * when it becomes invalid is a row editor that deletes the user's typing: they fix one
 * field, lose the rest, and have to start over. So an unparseable row still gets a view
 * row, with its error attached and its derived columns showing the em dash.
 *
 * The em dash is `EM_DASH` from `formatting.ts` rather than a local literal, because it is
 * documented there as a deliberate choice - "zero is a claim" - and a second literal
 * elsewhere would be free to drift into a hyphen or a blank.
 */
const buildRows = (
  draft: PlanDraft,
  outcome: PlannerOutcome,
  conflictsByRow: ReadonlyMap<string, readonly string[]>,
): readonly PlanRowView[] => {
  const total = draft.rows.length;
  return draft.rows.map((row, index) => {
    const conflicts = conflictsByRow.get(row.id) ?? [];
    const resolved = resolvedFor(outcome, row.id);

    return {
      id: row.id,
      name: row.name.trim(),
      role: row.role,
      roleLabel: roleLabelFor(row.role, row.customRoleLabel),
      vlan: row.vlan.trim() === '' ? UNTAGGED : row.vlan.trim(),
      gateway: resolved?.gateway ?? NONE,
      ...(resolved === undefined ? BLANK_COLUMNS : derivedColumns(resolved)),
      range: resolved === undefined ? EM_DASH : hostRangeOf(resolved),
      capacity: resolved === undefined ? EM_DASH : formatAddressCount(resolved.subnet.usableHosts),
      requested: resolved === undefined ? EM_DASH : formatAddressCount(resolved.requestedHosts),
      hostsUsed: resolved === undefined ? EM_DASH : hostsUsedOf(resolved),
      utilization: resolved === undefined ? EM_DASH : utilizationOf(resolved),
      overCapacity: resolved !== undefined && resolved.requestedHosts > resolved.subnet.usableHosts,
      error: rowError(outcome, row.id),
      hasConflict: conflicts.length > 0,
      conflicts,
      index,
      canMoveUp: index > 0,
      canMoveDown: index < total - 1,
      canRemove: total > 1,
    };
  });
};

/** The columns that exist only once a row's CIDR has parsed. */
const BLANK_COLUMNS = Object.freeze({
  cidr: EM_DASH,
  network: EM_DASH,
  mask: EM_DASH,
  broadcast: EM_DASH,
  firstHost: EM_DASH,
  lastHost: EM_DASH,
});

/**
 * The read-only address columns for a resolved row.
 *
 * Every value read straight off the engine's `SubnetInfo`. The wildcard mask is deliberately
 * absent: it is the one figure in this set that only appears in an access-control list, and
 * the plan screen has no use for it. The Phase 12 export is where it belongs.
 */
const derivedColumns = (resolved: ResolvedRow) => ({
  cidr: formatCidr({
    family: 'ipv4',
    ip: resolved.subnet.networkAddress,
    prefix: resolved.subnet.cidr.prefix,
  }),
  network: integerToIPv4(resolved.subnet.networkAddress),
  mask: integerToIPv4(resolved.subnet.subnetMask),
  broadcast: integerToIPv4(resolved.subnet.broadcastAddress),
  firstHost: integerToIPv4(resolved.subnet.firstUsableHost),
  lastHost: integerToIPv4(resolved.subnet.lastUsableHost),
});

/**
 * `requested / capacity` as a percentage string.
 *
 * Read from the engine's `calculateUtilization` rather than recomputed here, so a row
 * showing 79.4% and the same allocation on the VLSM table cannot disagree.
 *
 * Never clamped. A row asking for 50 hosts out of a /27 (30 usable) is 167%, and hiding
 * that behind "100%" would report the problem as solved. The `overCapacity` flag beside it
 * is what makes a number over 100 readable rather than alarming.
 */
const utilizationOf = (resolved: ResolvedRow): string =>
  formatPercent(calculateUtilization(resolved.requestedHosts, resolved.subnet.usableHosts));

/** The block's usable host range as one string, for the row's read-only columns. */
const hostRangeOf = (resolved: ResolvedRow): string =>
  `${integerToIPv4(resolved.subnet.firstUsableHost)} – ${integerToIPv4(resolved.subnet.lastUsableHost)}`;

/** The requested count against the capacity, as one string. */
const hostsUsedOf = (resolved: ResolvedRow): string =>
  `${formatAddressCount(resolved.requestedHosts)} of ${formatAddressCount(resolved.subnet.usableHosts)}`;

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

/**
 * The plan's totals against its parent block.
 *
 * ## Why this is the one place the view model sums
 *
 * `PlannedSubnet` carries a CIDR but not its size, and the parent is not among the
 * subnets. So the bar's numerator is a sum over the subnets and its denominator is the
 * parent's size, and neither exists anywhere else. Both come from the engine:
 * `calculateSubnet` for both, so the total cannot disagree with the block the plan claims
 * to live in.
 *
 * A row's own utilisation has no such problem - `ResolvedRow` carries the count and the
 * `SubnetInfo` carries the capacity - and is read rather than summed, above.
 */
const buildSummary = (plan: NetworkPlan, findingCount: number): PlanSummary => {
  const parentCidr = parseCidr(plan.parentCidr);
  const parentInfo = calculateSubnet(parentCidr.ip, parentCidr.prefix);
  const claimed = plan.subnets.reduce((sum, subnet) => {
    const parsed = parseCidr(subnet.cidr);
    return sum + calculateSubnet(parsed.ip, parsed.prefix).totalAddresses;
  }, 0);

  return {
    parent: plan.parentCidr,
    parentAddresses: formatAddressCount(parentInfo.totalAddresses),
    claimed: formatAddressCount(claimed),
    // Clamped at zero so an over-claimed parent cannot render "-24 addresses free". The
    // `overParent` flag beside it is what says why, rather than the negative number
    // quietly doing it.
    free: formatAddressCount(Math.max(0, parentInfo.totalAddresses - claimed)),
    utilization: formatPercent(calculateUtilization(claimed, parentInfo.totalAddresses)),
    overParent: claimed > parentInfo.totalAddresses,
    subnetCount: formatAddressCount(plan.subnets.length),
    findingCount: formatAddressCount(findingCount),
  };
};

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

/**
 * What the screen should say when there is no plan to render.
 *
 * Mirrors `outcomeNotice` in `vlsm-view.ts` and for the same reason: three different
 * conditions need three different affordances, and collapsing them makes a typo look like
 * an exhaustion.
 */
const planNotice = (outcome: PlannerOutcome): PlanNotice | null => {
  switch (outcome.kind) {
    case 'empty':
    case 'ready':
      return null;

    case 'header-invalid':
      return {
        kind: 'warn',
        title: outcome.field === 'name' ? 'Name the plan' : 'Check the parent block',
        body: outcome.message,
      };

    case 'rows-invalid': {
      const unfinished = outcome.messages.size;
      return {
        kind: 'warn',
        // The count is in the title, because it is the one number that says how much work
        // is left.
        title: `Finish ${unfinished} subnet${unfinished === 1 ? '' : 's'}`,
        body:
          unfinished === 1
            ? 'One subnet needs attention. Its message is beside it.'
            : `${unfinished} subnets need attention. Each message is beside the subnet it belongs to.`,
      };
    }
  }
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** A finding's row ids, grouped. Used for the inline conflict detail under each row. */
const groupConflictsByRow = (outcome: PlannerOutcome): ReadonlyMap<string, readonly string[]> => {
  const grouped = new Map<string, string[]>();
  if (outcome.kind !== 'ready') return grouped;
  for (const finding of outcome.findings) {
    for (const rowId of finding.rowIds) {
      const existing = grouped.get(rowId);
      if (existing === undefined) grouped.set(rowId, [finding.message]);
      else existing.push(finding.message);
    }
  }
  return grouped;
};

/** A row's error message, or `null` when it parsed or the outcome is not per-row. */
const rowError = (outcome: PlannerOutcome, rowId: string): string | null =>
  outcome.kind === 'rows-invalid' ? (outcome.messages.get(rowId) ?? null) : null;

/** A row's resolved detail, or `undefined` when the draft has not been evaluated to one. */
const resolvedFor = (outcome: PlannerOutcome, rowId: string): ResolvedRow | undefined =>
  outcome.kind === 'ready' ? outcome.details.get(rowId) : undefined;

/**
 * A row's role label.
 *
 * The shared table's label for a known role, and the user's own text for `CUSTOM`. A custom
 * role showing the word "Custom" everywhere would be a role with no name, which defeats the
 * point of having the escape hatch - so this is the one place the table is bypassed, and
 * only for the one role the table is a placeholder for.
 */
const roleLabelFor = (role: NetworkRole, customLabel: string): string => {
  if (role !== 'CUSTOM') return roleLabel(role);
  const trimmed = customLabel.trim();
  return trimmed.length > 0 ? trimmed : 'Custom';
};

/* ------------------------------------------------------------------ *
 * Guidance
 * ------------------------------------------------------------------ */

/**
 * Whether a role expects a VLAN ID, and what to say if one is missing.
 *
 * Returns `null` when there is nothing to say, so the caller does not have to check the
 * role itself. A point-to-point link is untagged as a matter of course; everything else
 * normally carries a VLAN, and a missing one is worth a hint rather than an error - it is
 * a legitimate plan, just not the usual one.
 */
export const vlanHintFor = (row: PlanRowView): string | null => {
  if (!ROLE_DEFINITION_BY_ROLE[row.role].expectsVlan) return null;
  if (row.vlan !== UNTAGGED) return null;
  return `${row.roleLabel} is untagged. Untagged is fine if only one subnet uses this link.`;
};

/**
 * True when a row should draw attention because it holds an error or a finding.
 *
 * The screen's one place that decides "this row needs a look", so the row's border, its icon
 * and its badge cannot disagree about it.
 */
export const rowNeedsAttention = (row: PlanRowView): boolean =>
  row.error !== null || row.hasConflict || row.overCapacity;

/**
 * The border tone for a row's card.
 *
 * Three values, not one, and the distinction matters: a **parse error** is "I cannot read
 * this row", while a **finding or an over-capacity row** is "I read it, and the plan says it
 * disagrees with something else". A user who sees only a shared "something is wrong" colour
 * cannot tell which they are looking at, and the two need different actions.
 *
 * Presentation, not severity - see the module note. Phase 11's auditor is what attaches a
 * security judgement, and nothing here decides that.
 */
export const rowCardTone = (row: PlanRowView): 'default' | 'critical' | 'medium' => {
  if (row.error !== null) return 'critical';
  if (rowNeedsAttention(row)) return 'medium';
  return 'default';
};

/**
 * The findings that name no row the draft still holds.
 *
 * Never expected to be non-empty - every finding carries at least one row id - but the
 * screen renders a plan-level list of findings as well as per-row ones, and a finding whose
 * rows have all been deleted should still be visible there rather than vanish. Returns an
 * empty list rather than throwing, because a missing row is a stale map, not a crash.
 */
export const unassignedFindings = (
  findings: readonly PlanFinding[],
  conflictsByRow: ReadonlyMap<string, readonly string[]>,
): readonly PlanFinding[] =>
  findings.filter((finding) => !finding.rowIds.some((rowId) => conflictsByRow.has(rowId)));
