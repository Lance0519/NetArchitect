/**
 * Plan changes that rewrite other rows.
 *
 * PURE MODULE. No React, no React Native, no Expo.
 *
 * ## The rule this module exists to enforce
 *
 * > Reallocation safety: changing a subnet's host requirement or CIDR may invalidate
 * > neighbours. Detect conflicts and show a diff-style preview before committing. Do not
 * > silently rewrite the user's plan.
 *
 * The planner's rows are hand-authored. Every other screen's edits stay inside the row you
 * are editing, so this has never come up before. Two operations break that:
 *
 *   - **Repack.** Hand the rows' host requirements to the engine and take back whatever it
 *     allocates. That is one field on one row, and it can move every other row's address.
 *   - **Apply a profile.** Replace the subnet list with a template's segments.
 *
 * Both are legitimate and both are destructive. The tempting implementation is to apply
 * them on a tap and let the table update, which is how a planner loses a user's work: they
 * change one host count, every CIDR in the plan moves, and there is no record of what the
 * addresses were. Worse, the addresses were *their* addresses - each one was typed or
 * reviewed individually, and the review is not repeatable.
 *
 * So neither function mutates anything. Both return a {@link PlanChange}: the next draft,
 * plus a field-level diff, plus the conflicts the change would introduce. The screen shows
 * it and the user commits.
 *
 * ## What "diff-style" means here
 *
 * Per *field*, not per row. A row whose name is unchanged and whose CIDR moved is a
 * **changed** row, and the message names which fields moved. Row-level diffing alone would
 * render eight rows as "changed" and tell the user nothing about what to look at.
 *
 * A removed row carries its last values, so the diff can say which segment is going away
 * rather than "row 3". A user's plan is named things; "Servers" is a fact, "row 3" is a
 * position.
 *
 * ## Conflicts are detected, never prevented
 *
 * The repack can produce a plan that overlaps - not because the engine is wrong, but
 * because it can only work with the host counts that parse, and a row whose CIDR the user
 * chose deliberately is not represented in its host count at all. Repacking such a plan
 * moves a row into another's addresses.
 *
 * That is shown, not refused. Refusing would mean the user could not repack a plan that
 * had one broken row, and the alternative - applying it - is precisely the silent rewrite
 * this module exists to prevent. `conflictsOf` therefore reports what the *next* draft
 * would flag, computed by the same `evaluatePlan` the screen already runs, so a conflict
 * shown in a preview cannot disagree with a finding shown on the plan.
 */

/* ------------------------------------------------------------------ *
 * Imports
 * ------------------------------------------------------------------ */

import { calculateNetworkAddress, formatCidr, parseCidr } from './ip-engine';
import { profileRequirements, type ProfileDefinition } from './profiles';
import { packVLSM } from './vlsm-engine';
import { evaluatePlan, type PlanDraft, type SubnetRowDraft } from './planner-input';
import { ScopeExhaustionError } from './errors';

import type { NetworkRole } from '../types/network';

/* ------------------------------------------------------------------ *
 * The diff
 * ------------------------------------------------------------------ */

/** The fields of a row a change can move. Kept explicit so the diff cannot silently omit one. */
export const CHANGED_FIELDS = Object.freeze([
  'name',
  'role',
  'customRoleLabel',
  'vlan',
  'cidr',
  'gateway',
  'gatewayMode',
  'hosts',
] as const);

export type ChangedField = (typeof CHANGED_FIELDS)[number];

/** What happened to one row. */
export type RowChange =
  | { readonly kind: 'added'; readonly row: SubnetRowDraft }
  | {
      readonly kind: 'changed';
      readonly before: SubnetRowDraft;
      readonly after: SubnetRowDraft;
      /** Only the fields that actually differ. Never an empty array on a `changed` row. */
      readonly fields: readonly ChangedField[];
    }
  | { readonly kind: 'removed'; readonly row: SubnetRowDraft }
  | { readonly kind: 'unchanged'; readonly row: SubnetRowDraft };

/** Header fields a change can move. */
export type HeaderChange = 'name' | 'description' | 'parent' | 'profile';

/**
 * A proposed change to a plan: the next draft, what moves, and what it would break.
 *
 * `next` is a value, not an instruction. Nothing here has changed the plan yet, and the
 * caller has to have a reason to swap it in.
 */
export interface PlanChange {
  /** The proposed draft. The caller decides whether to adopt it. */
  readonly next: PlanDraft;
  readonly rows: readonly RowChange[];
  /** Header fields that differ. */
  readonly header: readonly HeaderChange[];
  /** Findings the next draft would carry. Empty means the change makes the plan cleaner. */
  readonly conflicts: readonly string[];
  /** False when nothing at all differs, so the screen can disable the confirm button. */
  readonly isEmpty: boolean;
}

/* ------------------------------------------------------------------ *
 * The diff itself
 * ------------------------------------------------------------------ */

/**
 * Compare two drafts.
 *
 * Rows are matched **by id**, not by position. Position matching would report a reorder as
 * one removal and one addition, which is wrong: reordering a plan changes nothing about the
 * addresses and a user who drags a row up does not want to be told two subnets changed.
 *
 * `sortOrder` is not a draft field - it is derived from position at save time - so a move
 * shows up as no change at all, which is correct. Reordering is a display concern and the
 * derived columns come out identical either way.
 */
export const diffPlans = (before: PlanDraft, next: PlanDraft): PlanChange => {
  const beforeRows = new Map(before.rows.map((row) => [row.id, row]));
  const nextRows = new Map(next.rows.map((row) => [row.id, row]));

  const rows: RowChange[] = [];

  for (const row of next.rows) {
    const prior = beforeRows.get(row.id);
    if (prior === undefined) {
      rows.push({ kind: 'added', row });
      continue;
    }
    const fields = changedFields(prior, row);
    rows.push(fields.length === 0 ? { kind: 'unchanged', row } : { kind: 'changed', before: prior, after: row, fields });
  }

  for (const row of before.rows) {
    if (!nextRows.has(row.id)) rows.push({ kind: 'removed', row });
  }

  const header = changedHeader(before, next);

  return {
    next,
    rows,
    header,
    conflicts: conflictsOf(next),
    isEmpty: rows.every((row) => row.kind === 'unchanged') && header.length === 0,
  };
};

/** The fields that differ between two rows, in {@link CHANGED_FIELDS} order. */
const changedFields = (before: SubnetRowDraft, after: SubnetRowDraft): readonly ChangedField[] =>
  CHANGED_FIELDS.filter((field) => before[field] !== after[field]);

const changedHeader = (before: PlanDraft, after: PlanDraft): readonly HeaderChange[] => {
  const fields: HeaderChange[] = [];
  if (before.name !== after.name) fields.push('name');
  if (before.description !== after.description) fields.push('description');
  if (before.parent !== after.parent) fields.push('parent');
  if (before.profile !== after.profile) fields.push('profile');
  return fields;
};

/**
 * The findings a draft would carry, as message strings.
 *
 * Delegated to `evaluatePlan` rather than recomputed here. A preview that ran its own
 * overlap check could disagree with the plan screen's finding - same inputs, two
 * implementations, one of them wrong - and the user would be shown a conflict that does not
 * exist and then adopt a change that creates one.
 *
 * A draft that does not yet build contributes nothing: there is no plan to find problems
 * in, and reporting the row messages here would show the user parse errors they can already
 * see beside their rows.
 */
export const conflictsOf = (draft: PlanDraft): readonly string[] => {
  const outcome = evaluatePlan(draft);
  return outcome.kind === 'ready' ? outcome.findings.map((finding) => finding.message) : [];
};

/* ------------------------------------------------------------------ *
 * Repack
 * ------------------------------------------------------------------ */

/**
 * What repacking produced. Exactly one of these three.
 *
 * `skippedRowIds` is present on both arms and means the same thing on each: rows that
 * carry no usable host count and were therefore left untouched. It is on the success arm as
 * much as the failure arm because the interesting case *is* a success - a repack that worked
 * on four of five rows, leaving the fifth where the user put it, is exactly the case where
 * the screen must say "this one was left alone" rather than implying the whole plan was
 * re-derived.
 */
export type RepackOutcome =
  | { readonly kind: 'change'; readonly change: PlanChange; readonly skippedRowIds: readonly string[] }
  | {
      readonly kind: 'blocked';
      /** The engine's own message, verbatim. */
      readonly message: string;
      /**
       * Rows that do not parse, and therefore contribute no host count to the repack.
       *
       * Shown because a repack that quietly ignores a broken row produces a plan missing a
       * segment the user can still see on screen. The alternative - refusing to repack -
       * means a single bad row makes the whole operation unavailable, which is a worse
       * answer than "here is what I did not use".
       */
      readonly skippedRowIds: readonly string[];
    }
  | {
      /** There is nothing to repack: no rows, or no row carries a host count yet. */
      readonly kind: 'nothing-to-do';
      readonly message: string;
    };

/**
 * Re-derive every CIDR from the rows' host requirements.
 *
 * ## Why this is not `packVLSM(draft.parent, ...)`
 *
 * Three reasons, and the third is the important one.
 *
 * First, rows carry a **role**, and `POINT_TO_POINT` must get a `/31` where both addresses
 * are usable (RFC 3021) rather than the `/30` a bare host count would get. `packVLSM`
 * already honours that, so this one is free - but it means the role must reach the packer,
 * and it does, because the row is the source of the requirement.
 *
 * Second, rows carry a **name** the user typed, and the packer allocates largest-first,
 * which means the address a row gets depends on how many hosts *other* rows want. The diff
 * is the honest account of that: the user sees "Servers moves from .128/26 to .64/26"
 * because their own edit caused it, rather than the table silently rearranging.
 *
 * Third - and this is why the whole operation needs a preview - **the packer has no idea
 * what a CIDR the user typed meant.** It gets host counts. A subnet deliberately sized as
 * a `/24` with 30 hosts on it hands the packer "30", and the packer will hand back a `/27`.
 * The user's intent is not in the input. That is not a reason to refuse; it is exactly the
 * reason the diff exists.
 *
 * Rows are passed in **draft order**. The packer re-sorts by size internally, so this only
 * decides which of two equal-sized rows gets the lower address - and that is a
 * user-visible fact, so it follows the order on screen rather than an arbitrary one.
 */
export const previewRepack = (draft: PlanDraft): RepackOutcome => {
  const usable: { row: SubnetRowDraft; hosts: number }[] = [];
  const skippedRowIds: string[] = [];

  for (const row of draft.rows) {
    const hosts = hostCountOf(row);
    if (hosts === null) {
      skippedRowIds.push(row.id);
      continue;
    }
    usable.push({ row, hosts });
  }

  if (usable.length === 0) {
    return {
      kind: 'nothing-to-do',
      message: 'Give at least one subnet a host count, and there will be something to pack.',
    };
  }

  if (draft.parent.trim().length === 0) {
    return {
      kind: 'blocked',
      message: 'Enter the parent block first. Every subnet has to come from somewhere.',
      skippedRowIds,
    };
  }

  try {
    const result = packVLSM(
      draft.parent,
      usable.map(({ row, hosts }) => ({
        id: row.id,
        name: row.name.trim().length === 0 ? 'Subnet' : row.name.trim(),
        requestedHosts: hosts,
        role: row.role,
      })),
    );

    const byId = new Map(result.allocations.map((allocation) => [allocation.id, allocation.assignedCidr]));

    const next: PlanDraft = {
      ...draft,
      rows: draft.rows.map((row) => {
        const cidr = byId.get(row.id);
        if (cidr === undefined) return row;
        // The gateway mode is deliberately NOT reset. A user who typed a gateway has an
        // address in mind, and re-packing moves the subnet out from under it - which the
        // gateway message will now correctly report, because `evaluatePlan` checks a
        // manual gateway against the row's own CIDR. Quietly resetting to `auto` would
        // replace their address with a first-usable-host without saying so.
        return { ...row, cidr };
      }),
    };

    return { kind: 'change', change: diffPlans(draft, next), skippedRowIds };
  } catch (error) {
    // `ScopeExhaustionError` is the only failure `packVLSM` is expected to raise, and it
    // already carries a message written for a user plus a `reason` and a `shortfall`. It
    // is caught here and turned into a refusal the screen can render beside the rows.
    //
    // Anything else is a bug, and it is rethrown rather than reported as "blocked". The
    // Phase 7 precedent applies: a second catch-all that maps an unexpected throw to a
    // friendly sentence means a real defect reaches a user as a plausible explanation for
    // something that is not happening, and nothing in the app ever reports it.
    if (!(error instanceof ScopeExhaustionError)) throw error;
    return { kind: 'blocked', message: error.friendlyMessage, skippedRowIds };
  }
};

/**
 * A row's host count, or `null` when it has none yet.
 *
 * `null` for a row whose count does not parse, not zero and not one. Zero would be a
 * plausible requirement the packer would honour with an empty block; one would silently
 * allocate a subnet the user never asked for. Both are worse than skipping the row and
 * saying so.
 */
const hostCountOf = (row: SubnetRowDraft): number | null => {
  const trimmed = row.hosts.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
};

/* ------------------------------------------------------------------ *
 * Profiles
 * ------------------------------------------------------------------ */

/**
 * What applying a profile produced.
 *
 * `discardedRowIds` is present on both arms, and it means the same thing on each: rows that
 * existed in the draft and do not survive. The diff already reports them as removals, but
 * they are repeated here because the screen has to say so in words - "this replaces your
 * 3 subnets" is the whole reason the user is looking at a preview.
 */
export type ProfileOutcome =
  | { readonly kind: 'change'; readonly change: PlanChange; readonly discardedRowIds: readonly string[] }
  | { readonly kind: 'blocked'; readonly message: string; readonly discardedRowIds: readonly string[] };

/**
 * Replace the subnet list with a profile's segments.
 *
 * ## Why the profile only supplies hints
 *
 * `profileRequirements` returns names, roles and host counts - never addresses - so the
 * addresses here come from the engine, in the user's parent. See `profiles.ts` for why
 * that module takes no parent argument.
 *
 * ## Why existing rows are not silently replaced
 *
 * Applying a profile over a plan the user has built would destroy typed addresses, so it
 * returns a `change` the screen previews. But the *first* application to an untouched plan
 * needs no ceremony, and a preview dialog on an empty table is friction for no benefit -
 * so the caller decides: preview when there is something to lose, apply directly when the
 * draft is one blank row.
 *
 * ## Why ids are the profile's own
 *
 * `profileRequirements` produces `${profile.id}-${index}`, so applying the same profile
 * twice produces the same ids and the second application is a no-op rather than a
 * duplication. That also means a user who applies `personal`, edits two names, then
 * re-applies `personal` sees the diff show those two names reverting - which is the truth,
 * and which a diff built on fresh random ids would have hidden behind "5 rows added".
 */
export const previewProfile = (
  draft: PlanDraft,
  profile: ProfileDefinition,
  /**
   * The parent to derive the addresses against. Defaults to the draft's own.
   *
   * An explicit argument exists for one reason: `evaluatePlan` canonicalises a parent that
   * was typed as an address inside a network, so `192.168.1.50/24` and `192.168.1.0/24` are
   * the same parent. The packer does its own normalisation, so passing the raw draft text
   * would work too - but a caller that has *just* evaluated the draft has the canonical
   * value in hand, and using it keeps the two code paths reading the same string.
   */
  parentOverride?: string,
): ProfileOutcome => {
  const parent = (parentOverride ?? draft.parent).trim();

  // The profile's addresses need a parent to be derived against, and a parent that cannot
  // be parsed cannot produce one. Said plainly rather than guessed at.
  if (parent.length === 0) {
    return {
      kind: 'blocked',
      message: 'Enter the parent block first. Every subnet has to come from somewhere.',
      discardedRowIds: draft.rows.map((row) => row.id),
    };
  }

  let assignments: ReadonlyMap<string, string>;
  try {
    const result = packVLSM(parent, profileRequirements(profile));
    assignments = new Map(result.allocations.map((a) => [a.id, a.assignedCidr]));
  } catch (error) {
    // Same rule as `previewRepack`: exhaustion is an answer, anything else is a bug.
    if (!(error instanceof ScopeExhaustionError)) throw error;
    return {
      kind: 'blocked',
      message: error.friendlyMessage,
      discardedRowIds: draft.rows.map((row) => row.id),
    };
  }

  const next: PlanDraft = {
    ...draft,
    profile: profile.id,
    rows: profile.entries.map((entry, index) => {
      const id = `${profile.id}-${index}`;
      return {
        id,
        name: entry.name,
        role: entry.role,
        customRoleLabel: '',
        vlan: '',
        // A profile names segments, not VLAN IDs. Inventing one here would put a number in
        // a switch configuration the user never chose, and VLAN numbering is a site-wide
        // convention this app has no way of knowing. The planner suggests the next free ID
        // when a row is added; that is the user's to accept, not the template's.
        cidr: assignments.get(id) ?? '',
        gateway: '',
        gatewayMode: 'auto',
        hosts: String(entry.hosts),
      };
    }),
  };

  return {
    kind: 'change',
    change: diffPlans(draft, next),
    // Every row the draft had. The profile replaces the whole subnet list, so after this
    // change nothing from the old list survives.
    discardedRowIds: draft.rows.map((row) => row.id),
  };
};

/**
 * Adopt a hand-off from the VLSM screen.
 *
 * The allocations arrive already computed, so there is nothing to pack and nothing to
 * preview about the addresses - they are what the VLSM screen showed the user a moment ago.
 * The diff still runs, because the planner may already hold a plan and overwriting it
 * silently is the thing this module exists to prevent.
 *
 * `requestedHosts` comes from the hand-off's requirements rather than the allocations
 * because the planner needs the number the *user* asked for, which is what utilisation is
 * measured against - the engine's block size is the answer to a different question.
 */
export const adoptHandoff = (
  draft: PlanDraft,
  handoff: {
    readonly parentCidr: string;
    readonly requirements: readonly {
      readonly id: string;
      readonly name: string;
      readonly requestedHosts: number;
      readonly role: NetworkRole;
    }[];
    readonly allocations: readonly {
      readonly id: string;
      readonly name: string;
      readonly role: NetworkRole;
      readonly cidr: string;
    }[];
  },
): PlanChange => {
  const hostsById = new Map(
    handoff.requirements.map((requirement) => [requirement.id, requirement.requestedHosts]),
  );

  const missingCounts = handoff.allocations.filter(
    (allocation) => !hostsById.has(allocation.id),
  );

  const next: PlanDraft = {
    ...draft,
    parent: handoff.parentCidr,
    rows: handoff.allocations.map((allocation) => ({
      // The allocation's id, not the requirement's. They are the same string today, but the
      // planner's rows are keyed by allocation - a row's identity is its block, not the
      // ask that produced it - and Phase 9 replaces these with database primary keys.
      id: allocation.id,
      name: allocation.name,
      role: allocation.role,
      customRoleLabel: '',
      vlan: '',
      cidr: allocation.cidr,
      gateway: '',
      // `auto`, so the gateway column fills from the engine rather than arriving blank.
      // `none` would be wrong - a VLSM allocation has not been asked to have no gateway -
      // and `manual` has nothing to be manual about.
      gatewayMode: 'auto',
      // An allocation with no matching requirement has no host count the user asked for.
      // Leaving the field blank is the honest state: the planner then reports the row as
      // unfinished and asks, rather than inventing a number and building a utilisation
      // figure on top of it. A fallback here would be a fabricated answer, and the
      // assertion below is what keeps the two from silently diverging.
      hosts: hostsById.has(allocation.id) ? String(hostsById.get(allocation.id)) : '',
    })),
  };

  const change = diffPlans(draft, next);
  if (missingCounts.length > 0) {
    // Not reachable through `handoffOf`, which pairs every allocation with its
    // requirement. It is checked because this function takes a structural type rather than
    // the store's nominal one, and a caller could hand it anything - and the failure mode
    // of not checking is a plan with blank host counts and no explanation.
    return {
      ...change,
      conflicts: [
        ...change.conflicts,
        `${missingCounts.map((allocation) => allocation.name).join(', ')} came over without a host count. Enter one for each.`,
      ],
    };
  }
  return change;
};

/* ------------------------------------------------------------------ *
 * Small helpers shared with the view
 * ------------------------------------------------------------------ */

/**
 * A row's label for a diff message.
 *
 * The name when it has one, the CIDR when it does not, and a neutral fallback only as a
 * last resort. "Row 3" is a position the user has to go and find; "Servers" or
 * "192.168.1.0/25" is something they can recognise, and a message they cannot act on is a
 * message they will ignore.
 *
 * The fallback is deliberately *not* the row id. The ids are `row-7` and are stable and
 * unique, which makes them the right thing for a React key and the wrong thing for a human.
 */
export const rowLabel = (row: SubnetRowDraft): string => {
  const name = row.name.trim();
  if (name.length > 0) return name;
  const cidr = row.cidr.trim();
  if (cidr.length > 0) {
    try {
      const parsed = parseCidr(cidr);
      // Canonicalised, so `192.168.1.50/24` reads as the block it names rather than as the
      // address that was typed. `parseCidr` deliberately does NOT normalise - it is a
      // reference parser and the caller's choice - so the network address has to be asked
      // for. The raw text is the fallback because a CIDR that does not parse is exactly
      // what the diff is reporting on, and hiding it behind a placeholder would remove the
      // one useful thing the message could say.
      return formatCidr({
        family: 'ipv4',
        ip: calculateNetworkAddress(parsed.ip, parsed.prefix),
        prefix: parsed.prefix,
      });
    } catch {
      return cidr;
    }
  }
  return 'An unnamed subnet';
};
