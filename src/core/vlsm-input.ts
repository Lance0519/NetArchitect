/**
 * VLSM draft input rules.
 *
 * PURE MODULE. No React, no React Native, no Expo, no styling. It takes what the user
 * has typed and returns one of five states, or throws nothing at all.
 *
 * ## Why the outcome is a five-way union rather than a result plus a message
 *
 * The VLSM screen has to answer four quite different questions, and getting them
 * confused is how a planner screen ends up lying to the user:
 *
 *   1. Has the user started at all?          -> `empty`
 *   2. Is the parent block unreadable?        -> `parent-invalid`
 *   3. Is a specific row unusable?            -> `rows-invalid`, with a message per row
 *   4. Does it simply not fit?                -> `exhausted`, with the offending row
 *   5. Otherwise, the allocation.             -> `ok`
 *
 * Cases 3 and 4 are the ones that matter. They are both "no result", but they need
 * different affordances: a row error is fixed by editing that row, while exhaustion is
 * fixed by removing a requirement or enlarging the parent. Collapsing them into one
 * "invalid" state would mean either showing an exhaustion as if a typo caused it, or
 * showing a typo without saying which row has it.
 *
 * ## Why the exhaustion error is attributed to a row only when that is unambiguous
 *
 * `ScopeExhaustionError` names the requirement it blames, by *name*. Names are
 * user-entered and are not unique - two rows called "Servers" is an entirely normal
 * draft. Attributing the error to the first match would put a red border on the wrong
 * row, and the user would fix the correct one and see nothing change. So the culprit is
 * resolved to a row id only when exactly one row carries that name; otherwise the error
 * is reported against the form with no row blamed, because blaming the wrong row is
 * worse than blaming none.
 *
 * ## Why the fix suggestion is verified rather than computed
 *
 * The obvious suggestion for exhaustion is "try a larger parent, here is the prefix
 * whose total address count is big enough". That number is easy to compute and it is
 * frequently *wrong*, because a total-size comparison ignores alignment: a /23 can hold
 * more addresses in total than a /22 needs and still fail to pack, since the greedy
 * pass can strand addresses. Suggesting a parent that then fails again is worse than no
 * suggestion at all, because the user has been told something specific and it is a lie.
 *
 * So every candidate parent is proved by actually packing the requirements into it. Only
 * a parent that verifiably works is suggested. The search is bounded, and when no
 * candidate passes, the module says so instead of guessing.
 */

import { ScopeExhaustionError } from './errors';
import { calculateSubnet, formatCidr } from './ip-engine';
import { packVLSM } from './vlsm-engine';
import { cidrSchema, hostRequirementSchema } from './validation';

import type { Cidr, HostRequirement, NetworkRole, VlsmResult } from '../types/network';

/* ------------------------------------------------------------------ *
 * Draft shape
 *
 * The draft holds *text*, not numbers. A host field the user is halfway through typing
 * is the string `''`, `'-'` or `'1e'`, and turning that into a number is a decision
 * this module makes once, explicitly, rather than something every row component
 * re-decides slightly differently.
 * ------------------------------------------------------------------ */

/** One requirement row, exactly as typed. */
export interface VlsmRowDraft {
  /** Stable across re-renders, reorders and re-validation. The React key and the handle. */
  readonly id: string;
  readonly name: string;
  /** Raw text. Validated here, never coerced in a component. */
  readonly hosts: string;
  readonly role: NetworkRole;
}

export interface VlsmDraft {
  /** Raw text. A host address is accepted and normalised, exactly as `parseCidr` does. */
  readonly parent: string;
  readonly rows: readonly VlsmRowDraft[];
}

/* ------------------------------------------------------------------ *
 * Outcome
 * ------------------------------------------------------------------ */

export type VlsmOutcome =
  /** Nothing filled in yet. Not an error. */
  | { readonly kind: 'empty' }
  | { readonly kind: 'parent-invalid'; readonly message: string }
  /** At least one row is unusable. Carries a message per row id, and only for bad rows. */
  | {
      readonly kind: 'rows-invalid';
      readonly messages: ReadonlyMap<string, string>;
      /** Rows that were fine, so the screen can still show a partial count. */
      readonly validCount: number;
    }
  | {
      readonly kind: 'exhausted';
      /** The engine's message, verbatim. */
      readonly message: string;
      /** The row to mark, or `null` when no single row is at fault. */
      readonly culpritId: string | null;
      readonly shortfallAddresses: number;
      /** A parent that provably works, or `null` when none was found in the search. */
      readonly suggestion: string | null;
    }
  | {
      readonly kind: 'ok';
      readonly result: VlsmResult;
      readonly parent: Cidr;
      /** The rows that were packed, in draft order, with their ids. */
      readonly requirements: readonly HostRequirement[];
    };

/* ------------------------------------------------------------------ *
 * Row ids
 *
 * Monotonic and module-scoped, for the same reason `nextRequirementId` is: a random id
 * would make a failing test unreproducible, because the same input could produce a
 * different key each run. The `draft-` prefix keeps these from ever colliding with the
 * engine's own `req-N` ids, which matters because both end up on the same allocation.
 * ------------------------------------------------------------------ */

let draftCounter = 0;

/** A new row id. Unique for the lifetime of the module. */
export const newDraftId = (): string => {
  draftCounter += 1;
  return `draft-${draftCounter}`;
};

/** A blank row, ready to be filled in. */
export const blankRow = (overrides: Partial<VlsmRowDraft> = {}): VlsmRowDraft => ({
  id: newDraftId(),
  name: '',
  hosts: '',
  role: 'LAN',
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * Draft operations
 *
 * Pure functions over the draft, so that the list behaviour - which is where the
 * fiddly bugs live - is testable without a component, a store, or a render. The store
 * holds a draft and calls these; it decides nothing.
 *
 * Two rules run through all of them.
 *
 * First, identity is preserved. An operation that changed a row's id would remount that
 * row, drop the keyboard, and lose the caret mid-edit. `updateRow` therefore matches on
 * id and leaves every other row object untouched, so React can skip re-rendering the
 * ones that did not change.
 *
 * Second, an edit never discards what the user typed. A reorder that hit the end of the
 * list, or a removal of the last row, must degrade quietly rather than resetting the
 * draft - a planning tool that empties itself when you tap the wrong arrow is worse than
 * one that ignores the tap.
 * ------------------------------------------------------------------ */

/** Replace the parent text. */
export const setParent = (draft: VlsmDraft, parent: string): VlsmDraft => ({
  ...draft,
  parent,
});

/**
 * Change one field of one row.
 *
 * The row keeps its id, its position, and every other field, so an in-progress edit
 * survives the re-render and the re-pack that follow it.
 */
export const updateRow = (
  draft: VlsmDraft,
  id: string,
  patch: Partial<Omit<VlsmRowDraft, 'id'>>,
): VlsmDraft => ({
  ...draft,
  rows: draft.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
});

/** Append a row. The draft is otherwise untouched. */
export const addRow = (draft: VlsmDraft, overrides: Partial<VlsmRowDraft> = {}): VlsmDraft => ({
  ...draft,
  rows: [...draft.rows, blankRow(overrides)],
});

/**
 * Remove a row.
 *
 * Refuses to remove the last one. A row editor that can reach zero rows has no way back
 * except a reset button, and a draft that emptied itself would look like data loss.
 */
export const removeRow = (draft: VlsmDraft, id: string): VlsmDraft =>
  draft.rows.length <= 1 ? draft : { ...draft, rows: draft.rows.filter((row) => row.id !== id) };

/**
 * Move a row one place up or down.
 *
 * Returns the draft unchanged when the move is out of range. Clamping or wrapping would
 * be surprising: pressing "up" on the first row should do nothing, not send the row to
 * the bottom.
 */
export const moveRow = (draft: VlsmDraft, id: string, by: -1 | 1): VlsmDraft => {
  const from = draft.rows.findIndex((row) => row.id === id);
  if (from < 0) return draft;
  const to = from + by;
  if (to < 0 || to >= draft.rows.length) return draft;
  const rows = [...draft.rows];
  const [moved] = rows.splice(from, 1);
  if (moved === undefined) return draft;
  rows.splice(to, 0, moved);
  return { ...draft, rows };
};

/** The draft to start from, with one row ready to type into. */
export const initialDraft = (): VlsmDraft => ({
  parent: '',
  rows: [blankRow()],
});

/* ------------------------------------------------------------------ *
 * Row classification
 * ------------------------------------------------------------------ */

/**
 * Whether a row has any content at all.
 *
 * This distinction is the whole reason the screen can open without a wall of red. A row
 * the user has not touched yet is not a mistake, and telling someone they have not
 * entered a name they have not begun to type is both wrong and the fastest way to make
 * a form feel hostile. This is the same reasoning as `classifyCalculatorOutcome`
 * distinguishing `empty` from `invalid` in Phase 6.
 *
 * Once any field has content the row is validated strictly, so a half-typed row *does*
 * get told what is missing - which is the useful case.
 */
const isUntouched = (row: VlsmRowDraft): boolean =>
  row.name.trim().length === 0 && row.hosts.trim().length === 0;

/* ------------------------------------------------------------------ *
 * Row validation
 *
 * Delegated to `hostRequirementSchema`, which is the same schema `vlsmPlanSchema` uses
 * per element. Reimplementing the checks here would create a third answer to "is 0 a
 * valid host count" alongside the engine's and the schema's.
 * ------------------------------------------------------------------ */

const firstMessage = (error: { issues: readonly { message: string }[] }): string => {
  const issue = error.issues[0];
  if (issue === undefined) {
    // A failed parse with no issues is not a state Zod produces. Rather than render
    // `undefined` into an error row, say something true and let the test suite find the
    // case if it ever happens.
    return 'This value cannot be used.';
  }
  return issue.message;
};

/**
 * Validate one row, returning either the requirement or the message to show.
 *
 * `hostRequirementSchema` takes `z.unknown()` throughout and transforms to the engine's
 * types, so a raw text field is exactly what it expects - and the host text never has to
 * be turned into a number by hand.
 */
const validateRow = (
  row: VlsmRowDraft,
): { readonly ok: true; readonly requirement: HostRequirement } | { readonly ok: false; readonly message: string } => {
  const parsed = hostRequirementSchema.safeParse({
    id: row.id,
    name: row.name,
    // The schema coerces the text itself. Passing a pre-parsed number would skip the
    // blank and non-numeric checks that produce the messages this screen relies on.
    requestedHosts: row.hosts,
    role: row.role,
  });
  if (parsed.success) return { ok: true, requirement: parsed.data };
  return { ok: false, message: firstMessage(parsed.error) };
};

/* ------------------------------------------------------------------ *
 * The fix suggestion
 * ------------------------------------------------------------------ */

/**
 * How many parents to try above the current one.
 *
 * Bounded because the search is a real pack per candidate, and unbounded would let a
 * /1 parent walk upward forever. Four is chosen because it covers the realistic answers
 * - a /24 that needs a /23 or a /22 - and a list that needs more than four steps of
 * growth is a sign the requirements, not the parent, are wrong.
 */
const SUGGESTION_STEPS = 4;

/**
 * The smallest parent that provably packs these requirements.
 *
 * Every candidate is *proved* by packing into it, not merely sized. Returns `null` when
 * nothing in the window works, and `null` is a legitimate answer: a parent is not always
 * the fix, and telling the user to try a /22 when a /22 also fails wastes their time and
 * undermines every other number this app shows them.
 */
const findWorkingParent = (
  from: Cidr,
  requirements: readonly HostRequirement[],
): string | null => {
  for (let step = 1; step <= SUGGESTION_STEPS; step += 1) {
    const candidatePrefix = from.prefix - step;
    // A wider prefix is only meaningful while there is room left. `prefix - 1` from /0
    // would be -1, which is not a prefix at all.
    if (candidatePrefix < 0) return null;

    // The network address must be renormalised when the prefix widens. `packVLSM`
    // normalises internally, so packing would succeed either way - but a suggestion
    // reading "192.168.1.0/23" is a string the user would paste back in and get
    // something other than what was proved. 192.168.1.0/23 and 192.168.0.0/23 are the
    // same block, and only the second is a legal way to write it.
    const widened: Cidr = {
      ...from,
      ip: calculateSubnet(from.ip, candidatePrefix).networkAddress,
      prefix: candidatePrefix,
    };

    try {
      packVLSM(widened, requirements);
      return formatCidr(widened);
    } catch {
      // Still does not fit. Alignment can strand addresses in a larger block just as
      // it can in a smaller one, so trying the next prefix is not a formality.
    }
  }
  return null;
};

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Decide what the VLSM screen should show.
 *
 * Total, and free of side effects. It never throws: an unreadable input is a state to
 * render, not an exception for the screen to catch. `packVLSM` is the only thing that
 * can fail here, and its two structured failures are both mapped to an outcome.
 */
export function evaluateVlsm(draft: VlsmDraft): VlsmOutcome {
  const rows = draft.rows;

  // 1. Has anything been entered? A draft with no filled row is the empty state, even if
  //    the parent is also blank - the parent gets its own message once the user engages.
  const filled = rows.filter((row) => !isUntouched(row));
  if (filled.length === 0) return { kind: 'empty' };

  // 2. Row errors, before the parent. A user who has typed three requirements and made a
  //    mistake in one of them is mid-task, and the row is what they are looking at. The
  //    parent is unchanged from the last time it worked.
  const messages = new Map<string, string>();
  const requirements: HostRequirement[] = [];
  for (const row of filled) {
    const outcome = validateRow(row);
    if (outcome.ok) {
      requirements.push(outcome.requirement);
    } else {
      messages.set(row.id, outcome.message);
    }
  }

  if (messages.size > 0) {
    return { kind: 'rows-invalid', messages, validCount: requirements.length };
  }

  // 3. The parent. Parsed by the same schema `vlsmPlanSchema` uses, so a CIDR the planner
  //    accepts and one this screen accepts cannot drift apart.
  const parentParsed = cidrSchema.safeParse(draft.parent);
  if (!parentParsed.success) {
    return { kind: 'parent-invalid', message: firstMessage(parentParsed.error) };
  }
  const parent = parentParsed.data;

  // 4. Pack, mapping the two structured failures onto outcomes.
  try {
    return {
      kind: 'ok',
      result: packVLSM(parent, requirements),
      parent,
      requirements,
    };
  } catch (error) {
    if (!(error instanceof ScopeExhaustionError)) {
      // Anything else is a bug, not a user error. Rethrowing keeps it visible instead of
      // laundering it into a message about the user's typing, where nobody would find it.
      throw error;
    }
    return exhaustionOutcome(error, parent, rows, requirements);
  }
}

/**
 * Turn a `ScopeExhaustionError` into an outcome, resolving the row it blames.
 *
 * Split out from `evaluateVlsm` because the attribution rule is a decision in its own
 * right and deserves a name and a test rather than being three lines in the middle of a
 * try/catch.
 */
const exhaustionOutcome = (
  error: ScopeExhaustionError,
  parent: Cidr,
  rows: readonly VlsmRowDraft[],
  requirements: readonly HostRequirement[],
): VlsmOutcome => ({
  kind: 'exhausted',
  message: error.friendlyMessage,
  culpritId: attributeCulprit(error, rows),
  shortfallAddresses: shortfallOf(error),
  // Every requirement is valid by this point, so the search packs real input and the
  // parent it works from is the one the user actually typed.
  suggestion: findWorkingParent(parent, requirements),
});

/** The address shortfall the engine reported, or 0 if it reported none. */
const shortfallOf = (error: ScopeExhaustionError): number => {
  const raw = (error.details as { readonly shortfallAddresses?: unknown }).shortfallAddresses;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
};

/**
 * Resolve the row an exhaustion error blames, or `null` when that is not knowable.
 *
 * `ScopeExhaustionError` identifies the offending requirement by *name*, and names are
 * user-entered and not unique. Two rows called "Servers" is an ordinary draft, so the
 * first match is a coin toss - and a coin toss here means a red border on the wrong row,
 * which the user then "fixes" by editing a row that was never the problem. So the rule
 * is deliberately conservative: a name carried by exactly one row is attributed, and
 * anything else is reported against the form with nobody blamed.
 *
 * Exported so the ambiguity rule can be tested directly. It cannot be reached through
 * `evaluateVlsm` for a *named* error, because the engine's named branch is currently
 * unreachable - see the characterisation test in `tests/vlsm-input.test.ts`, which
 * exists to fail loudly if that ever changes.
 */
export const attributeCulprit = (
  error: ScopeExhaustionError,
  rows: readonly VlsmRowDraft[],
): string | null => {
  const blamed = (error.details as { readonly name?: unknown }).name;
  if (typeof blamed !== 'string') return null;

  // Trimmed on both sides: `hostRequirementSchema` trims the name it validates, so the
  // engine compares and reports the trimmed text while a row still holds what was typed.
  const matches = rows.filter((row) => row.name.trim() === blamed.trim());
  return matches.length === 1 ? (matches[0] as VlsmRowDraft).id : null;
};

