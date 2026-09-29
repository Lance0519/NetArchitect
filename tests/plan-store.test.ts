/**
 * Tests for the planner store.
 *
 * ## What the store is responsible for
 *
 * Two things, and the tests are grouped by them:
 *
 *   1. **Delegation.** Every action is a one-line call into a pure function from
 *      `planner-input.ts`. The delegation tests do not re-test the pure function - they
 *      assert the store arrived at the *same value* the pure module produces from the
 *      *same* draft, which is the only thing the store can get wrong on its own.
 *   2. **The staging lifecycle.** What is held, for how long, and what clears it.
 *
 * ## Why there is a "must not hold" block
 *
 * The store has no derived fields, and that is a decision rather than an omission: a
 * derived value in a store goes stale the moment its input changes. `tests/vlsm-store.test.ts`
 * already has this block, and it is the test that would fail if a future phase added
 * `view: PlanView` to the store "for convenience". It is duplicated here rather than
 * factored out because the shape being protected is different in each store.
 *
 * ## The `getState()` trap
 *
 * Zustand's `getState()` returns a snapshot. Holding one and reading its properties after
 * an action reads values frozen at read time, and it fails in a way that looks like the
 * action did nothing. Every assertion below re-reads `getState()`, and the tests that
 * would break if it were cached in a local are marked, because that is the bug this store
 * had one opportunity to introduce and did not.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { blankRow, evaluatePlan, initialPlanDraft, updateHeader } from '../src/core/planner-input';
import { previewProfile, previewRepack } from '../src/core/plan-changes';
import { PERSONAL_PROFILE } from '../src/core/profiles';
import { packVLSM } from '../src/core/vlsm-engine';
import { usePlanStore, selectHasPending, selectRows } from '../src/store/plan-store';

import type { PlanHandoff } from '../src/store/vlsm-store';
import type { NetworkRole } from '../src/types/network';

/* ================================================================== *
 * Helpers
 * ================================================================== */

const draft = () => usePlanStore.getState().draft;
const pending = () => usePlanStore.getState().pending;

/** Reset to the state the app opens in. Called before every test. */
const resetStore = (): void => {
  usePlanStore.setState({ draft: initialPlanDraft(), pending: null });
};

/**
 * Put the store into a known state: a name, a parent, and one row per given triple.
 *
 * Built from {@link blankRow} directly rather than by driving the store's own actions, for
 * two reasons that both cost a test before they were noticed:
 *
 *   - `initialPlanDraft` opens with exactly one row, so growing the draft to N rows means
 *     N-1 `addRow` calls. Reusing the store to build the fixture makes the *delegation*
 *     tests depend on the delegation they are testing, so a broken `addRow` makes
 *     `removeRow` fail too - and the failure is reported against the wrong action.
 *   - Row ids come from a module-scoped counter, so two `initialPlanDraft()` calls
 *     produce different ids. Comparing a store draft against a freshly-built one with
 *     `toEqual` fails on the id and nothing else.
 */
const withRows = (
  rows: readonly (readonly [string, string, string])[],
  parent = '192.168.1.0/24',
): void => {
  usePlanStore.setState({
    draft: {
      name: 'Test plan',
      description: '',
      parent,
      profile: 'custom',
      rows: rows.map(([name, cidr, hosts]) => blankRow({ name, cidr, hosts })),
    },
    pending: null,
  });
};

/**
 * A draft with header text and the screen's one blank row - no content in the table.
 *
 * Distinct from {@link withRows} with an empty list, which has *no* row at all. The two
 * are different starting points and `isUntouched` treats them the same, so a test that
 * means "the screen as it opens" has to be able to say which it means.
 */
const withHeaderOnly = (patch: { name?: string; description?: string } = {}): void => {
  usePlanStore.setState({
    draft: { ...initialPlanDraft(), name: patch.name ?? '', description: patch.description ?? '' },
    pending: null,
  });
};

/** A hand-off built by packing for real, shaped like `handoffOf`'s output. */
const handoffFrom = (parent: string, requirements: readonly (readonly [string, number])[]): PlanHandoff => {
  const pairs = requirements.map(([name, requestedHosts], index) => ({
    id: `req-${index}`,
    name,
    requestedHosts,
    role: 'LAN' as NetworkRole,
  }));
  return {
    parentCidr: parent,
    requirements: pairs,
    allocations: packVLSM(parent, pairs).allocations.map((allocation) => ({
      id: allocation.id,
      name: allocation.name,
      role: allocation.role,
      cidr: allocation.assignedCidr,
    })),
  };
};

/* ================================================================== *
 * Initial state
 * ================================================================== */

describe('initial state', () => {
  beforeEach(resetStore);

  it('carries exactly the fields the pure module produces', () => {
    // The store's initial value is a literal, so this is the test that says the literal
    // and the factory agree. If `initialPlanDraft` ever gains a field, this fails rather
    // than leaving the store's copy quietly missing it.
    //
    // Compared by field *name*, not by value. `newRowId` is a module-scoped counter, so
    // two `initialPlanDraft()` calls never produce the same id and a `toEqual` would fail
    // on that alone - reporting a difference that does not exist and hiding a real one.
    const expected = initialPlanDraft();
    const actual = draft();
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    expect(actual.rows[0] && Object.keys(actual.rows[0]).sort()).toEqual(
      Object.keys(expected.rows[0] ?? {}).sort(),
    );
  });

  it('copies the factory defaults value for value, apart from the row id', () => {
    // The companion to the field-name test above, because a name can be present and
    // wrong. Everything except the id is a constant.
    const { rows: expectedRows, ...expectedHeader } = initialPlanDraft();
    const { rows: actualRows, ...actualHeader } = draft();
    expect(actualHeader).toEqual(expectedHeader);
    expect(actualRows.map((row) => ({ ...row, id: '' }))).toEqual(
      expectedRows.map((row) => ({ ...row, id: '' })),
    );
  });

  it('opens with one blank row, so the table has something in it', () => {
    expect(draft().rows).toHaveLength(1);
  });

  it('stages nothing', () => {
    expect(pending()).toBeNull();
  });

  it('has no profile applied', () => {
    expect(draft().profile).toBe('custom');
  });
});

/* ================================================================== *
 * Delegation
 * ================================================================== */

describe('delegation to the pure operations', () => {
  beforeEach(resetStore);

  it('delegates the header fields', () => {
    const store = usePlanStore.getState();
    store.setName('Campus');
    store.setDescription('Ground floor');
    store.setParent('10.0.0.0/16');
    store.setProfile('enterprise');
    expect(draft()).toMatchObject({
      name: 'Campus',
      description: 'Ground floor',
      parent: '10.0.0.0/16',
      profile: 'enterprise',
    });
  });

  it('delegates setName, producing the same draft the pure function would', () => {
    // The expected value is derived from the draft as it was *before* the action, so the
    // row ids line up. Building it from a fresh `initialPlanDraft()` instead would fail
    // on the id and say nothing about whether the header was updated.
    const before = draft();
    usePlanStore.getState().setName('Campus');
    // Re-read rather than reusing the `before` snapshot: a snapshot read after an action
    // reads values frozen before it, and would pass here while the store had not actually
    // updated anything the screen can see.
    expect(draft().name).toBe('Campus');
    expect(draft()).toEqual(updateHeader(before, { name: 'Campus' }));
  });

  it('delegates updateRow', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    const id = draft().rows[0]!.id;
    usePlanStore.getState().updateRow(id, { name: 'Renamed' });
    expect(draft().rows[0]?.name).toBe('Renamed');
  });

  it('delegates setGatewayMode, so clearing a gateway sticks', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    const id = draft().rows[0]!.id;
    usePlanStore.getState().updateRow(id, { gateway: '192.168.1.10' });
    usePlanStore.getState().setGatewayMode(id, 'none');
    expect(draft().rows[0]?.gatewayMode).toBe('none');
    expect(evaluatePlan(draft()).kind).toBe('ready');
  });

  it('delegates addRow', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    usePlanStore.getState().addRow();
    expect(draft().rows).toHaveLength(2);
  });

  it('delegates removeRow', () => {
    withRows([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    usePlanStore.getState().removeRow(draft().rows[0]!.id);
    expect(draft().rows.map((row) => row.name)).toEqual(['B']);
  });

  it('delegates moveRow', () => {
    withRows([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', '50'],
    ]);
    usePlanStore.getState().moveRow(draft().rows[0]!.id, 1);
    expect(draft().rows.map((row) => row.name)).toEqual(['B', 'A']);
  });

  it('delegates reset, producing the same draft the pure function would', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    usePlanStore.getState().reset();
    // Compared field-by-field for the same reason as the initial-state test: a fresh
    // `initialPlanDraft()` carries a new row id, so `toEqual` would report a difference
    // that is not one and would still pass if every other field were wrong.
    const fresh = initialPlanDraft();
    expect({ ...draft(), rows: undefined }).toEqual({ ...fresh, rows: undefined });
    expect(draft().rows).toHaveLength(1);
    expect(draft().rows[0]?.name).toBe('');
    expect(draft().rows[0]?.cidr).toBe('');
    expect(draft().rows[0]?.hosts).toBe('');
  });

  it('leaves a pending change alone when the draft is edited', () => {
    // A staged change describes a diff against the draft as it was when the user asked.
    // Editing the draft afterwards does not invalidate the diff - the proposal is still
    // what it was - so the preview stays. What it *does* mean is that committing replaces
    // the edit, and that is the user's explicit choice at that point.
    withRows([['A', '192.168.1.128/26', '50']]);
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { name: 'Edited after staging' });
    expect(pending()?.change.next.rows[0]?.name).toBe('A');
  });
});

/* ================================================================== *
 * addTaggedRow
 * ================================================================== */

describe('addTaggedRow', () => {
  beforeEach(resetStore);

  it('seeds the next free VLAN ID', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { vlan: '1' });
    usePlanStore.getState().addTaggedRow();
    expect(draft().rows[1]?.vlan).toBe('2');
  });

  it('adds an untagged row when every ID is taken', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { vlan: '1' });
    usePlanStore.getState().addRow();
    usePlanStore.getState().updateRow(draft().rows[1]!.id, { vlan: '2' });
    usePlanStore.getState().addTaggedRow();
    // 3 and 4 are both free, so this is really about the row being added at all rather
    // than about exhaustion. Exhaustion needs 4094 rows and is covered in
    // `tests/planner-input.test.ts` against `nextFreeVlanId` directly.
    expect(draft().rows).toHaveLength(3);
  });

  it('leaves the existing rows untouched', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { vlan: '5' });
    const before = draft().rows[0];
    usePlanStore.getState().addTaggedRow();
    expect(draft().rows[0]).toBe(before);
  });

  it('does not use a VLAN a row is holding on to while being typed', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    // "1x" is mid-typing. It is already reported on the row, so it should not also push
    // the suggestion up - or rather, it should not hold a number hostage, which means
    // the new row gets 1 and the user fixes the broken one.
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { vlan: '1x' });
    usePlanStore.getState().addTaggedRow();
    expect(draft().rows[1]?.vlan).toBe('1');
  });
});

/* ================================================================== *
 * Staging a repack
 * ================================================================== */

describe('stageRepack', () => {
  beforeEach(resetStore);

  it('stages a change and does not touch the draft', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    const before = draft();
    expect(usePlanStore.getState().stageRepack()).toBeNull();
    expect(draft()).toBe(before);
    expect(pending()).not.toBeNull();
  });

  it('names what it is for, so the preview can say why', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    usePlanStore.getState().stageRepack();
    expect(pending()?.reason).toBe('repack');
    expect(pending()?.subject).toBeTruthy();
  });

  it('returns null on success, so the screen knows not to complain', () => {
    // The return value *is* the screen's signal for whether to show a banner. `null` for
    // success and a message for failure - a boolean would carry the same information and
    // throw away the reason.
    withRows([['A', '192.168.1.128/26', '50']]);
    expect(usePlanStore.getState().stageRepack()).toBeNull();
  });

  it('returns the engine own message when no row has a host count', () => {
    withRows([['A', '192.168.1.0/26', '']]);
    const message = usePlanStore.getState().stageRepack();
    expect(message).toBeTruthy();
    expect(pending()).toBeNull();
  });

  it('returns a message naming the parent when there is no parent to pack into', () => {
    // A named plan with a host count and no parent. The count is enough to want an
    // allocation; there is nowhere to put it. A bare `false` would leave the user with
    // nothing to act on.
    withHeaderOnly({ name: 'X' });
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { name: 'A', hosts: '50' });
    expect(usePlanStore.getState().stageRepack()).toContain('parent');
  });

  it('returns a message when the requirements do not fit', () => {
    // The message must come from the engine, so it is compared against the engine own
    // answer rather than a sentence typed here. If the engine ever words it differently,
    // this still passes and the screen shows whatever the engine said.
    withRows([['Big', '192.168.1.0/24', '4000']]);
    const engine = previewRepack(draft());
    if (engine.kind === 'change') throw new Error('expected the engine to refuse');
    expect(usePlanStore.getState().stageRepack()).toBe(engine.message);
    expect(pending()).toBeNull();
  });

  it('returns a different message per reason, so the screen can say which', () => {
    // The whole reason the return value is a string rather than a boolean. Three refusals
    // with one message each would be a support ticket that says "it did not work".
    withRows([['A', '192.168.1.0/26', '']]);
    const noCounts = usePlanStore.getState().stageRepack();

    withHeaderOnly({ name: 'X' });
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { name: 'A', hosts: '50' });
    const noParent = usePlanStore.getState().stageRepack();

    withRows([['Big', '192.168.1.0/24', '4000']]);
    const tooBig = usePlanStore.getState().stageRepack();

    expect(new Set([noCounts, noParent, tooBig]).size).toBe(3);
  });

  it('records the rows it skipped, so the preview can say so', () => {
    withRows([
      ['A', '192.168.1.0/26', '50'],
      ['B', '192.168.1.64/26', ''],
    ]);
    usePlanStore.getState().stageRepack();
    expect(pending()?.discardedRowIds).toEqual([draft().rows[1]!.id]);
  });

  it('replaces an earlier staged change rather than stacking a second one', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().stageRepack();
    expect(pending()?.change.next.rows[0]?.cidr).toBe('192.168.1.0/26');
  });
});

/* ================================================================== *
 * Staging a profile
 * ================================================================== */

describe('stageProfile', () => {
  beforeEach(resetStore);

  it('stages a change carrying the profile segments', () => {
    withRows([]);
    expect(usePlanStore.getState().stageProfile(PERSONAL_PROFILE)).toBeNull();
    expect(pending()?.change.next.rows).toHaveLength(PERSONAL_PROFILE.entries.length);
  });

  it('names the template in the subject, so the dialog can say which one', () => {
    withRows([]);
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    expect(pending()?.subject).toBe(PERSONAL_PROFILE.label);
  });

  it('records the rows it would discard', () => {
    withRows([['Mine', '10.1.1.0/24', '90']]);
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    expect(pending()?.discardedRowIds).toHaveLength(1);
  });

  it('returns a message without a parent to derive addresses from', () => {
    usePlanStore.setState({ draft: initialPlanDraft() });
    expect(usePlanStore.getState().stageProfile(PERSONAL_PROFILE)).toBeTruthy();
    expect(pending()).toBeNull();
  });

  it('returns a message when the profile does not fit the parent', () => {
    withRows([], '192.168.1.0/24');
    // The profile needs about a thousand addresses. It does not quietly halve its hints to
    // fit somewhere it does not belong - the message says so instead.
    const message = usePlanStore.getState().stageProfile({
      ...PERSONAL_PROFILE,
      id: 'enterprise',
      entries: PERSONAL_PROFILE.entries.map((entry) => ({ ...entry, hosts: 400 })),
    });
    expect(message).toBeTruthy();
    expect(pending()).toBeNull();
  });

  it('returns the core module own message, verbatim', () => {
    // Compared against a second call into `previewProfile` rather than a sentence typed
    // here, so this asserts pass-through and not a copy of the wording.
    withRows([], '192.168.1.0/24');
    const oversized = {
      ...PERSONAL_PROFILE,
      id: 'enterprise' as const,
      entries: PERSONAL_PROFILE.entries.map((entry) => ({ ...entry, hosts: 400 })),
    };
    const engine = previewProfile(draft(), oversized);
    if (engine.kind === 'change') throw new Error('expected the engine to refuse');
    expect(usePlanStore.getState().stageProfile(oversized)).toBe(engine.message);
  });
});

/* ================================================================== *
 * The hand-off from VLSM
 * ================================================================== */

describe('takeHandoff', () => {
  beforeEach(resetStore);

  it('adopts directly when the draft is untouched, with nothing to preview', () => {
    // The screen opens on a blank draft. A dialog saying "this will replace your 0 subnets"
    // is a dialog about nothing.
    usePlanStore.getState().takeHandoff(handoffFrom('192.168.1.0/24', [['A', 50]]));
    expect(pending()).toBeNull();
    expect(draft().parent).toBe('192.168.1.0/24');
    expect(draft().rows[0]?.cidr).toBeTruthy();
  });

  it('previews when the draft has a name, because a name is the content', () => {
    withHeaderOnly({ name: 'My plan' });
    usePlanStore.getState().takeHandoff(handoffFrom('192.168.1.0/24', [['A', 50]]));
    expect(pending()?.reason).toBe('handoff');
    expect(draft().name).toBe('My plan');
  });

  it('previews when the draft has subnets of its own', () => {
    withRows([['Mine', '10.1.1.0/24', '90']]);
    usePlanStore.getState().takeHandoff(handoffFrom('192.168.1.0/24', [['A', 50]]));
    expect(pending()?.reason).toBe('handoff');
    expect(draft().rows[0]?.name).toBe('Mine');
  });

  it('previews when the draft has a half-typed subnet, because that is content', () => {
    // Three characters of a CIDR is not "nothing" - it is something the user would be
    // annoyed to lose without being asked.
    withHeaderOnly();
    usePlanStore.getState().updateRow(draft().rows[0]!.id, { name: 'A', cidr: '192.168' });
    usePlanStore.getState().takeHandoff(handoffFrom('192.168.1.0/24', [['B', 50]]));
    expect(pending()?.reason).toBe('handoff');
  });

  it('previews when the draft has only a description', () => {
    withHeaderOnly({ description: 'Notes I wrote' });
    usePlanStore.getState().takeHandoff(handoffFrom('192.168.1.0/24', [['A', 50]]));
    expect(pending()?.reason).toBe('handoff');
  });

  it('names the rows it would discard on the preview path', () => {
    withRows([
      ['Keep', '10.1.1.0/24', '90'],
      ['Also', '10.1.2.0/24', '20'],
    ]);
    usePlanStore.getState().takeHandoff(handoffFrom('192.168.1.0/24', [['A', 50]]));
    expect(pending()?.discardedRowIds).toHaveLength(2);
  });

  it('ignores a null hand-off rather than clearing the draft', () => {
    withRows([['Mine', '10.1.1.0/24', '90']]);
    usePlanStore.getState().takeHandoff(null);
    expect(draft().rows[0]?.name).toBe('Mine');
    expect(pending()).toBeNull();
  });

  it('leaves an already-pending change alone rather than replacing it', () => {
    // A hand-off arriving while a profile preview is open is not something the user
    // asked for. Silently replacing the preview they were reading would be a rewrite
    // nobody confirmed.
    withRows([]);
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    const staged = pending();
    usePlanStore.getState().takeHandoff(handoffFrom('192.168.1.0/24', [['A', 50]]));
    expect(pending()).toBe(staged);
  });
});

/* ================================================================== *
 * The staging lifecycle
 * ================================================================== */

describe('the staging lifecycle', () => {
  beforeEach(resetStore);

  it('adopts the proposal on commit', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().commitChange();
    expect(draft().rows[0]?.cidr).toBe('192.168.1.0/26');
  });

  it('clears the proposal on commit, so it cannot be applied twice', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().commitChange();
    expect(pending()).toBeNull();
    // Applying twice would be a no-op today, but a stale change surviving a commit is
    // the kind of thing that is harmless until it is not.
    usePlanStore.getState().commitChange();
    expect(pending()).toBeNull();
  });

  it('leaves the draft alone on discard', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    const before = draft();
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().discardChange();
    expect(draft()).toBe(before);
    expect(pending()).toBeNull();
  });

  it('does nothing on commit with nothing staged', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    const before = draft();
    usePlanStore.getState().commitChange();
    expect(draft()).toBe(before);
  });

  it('clears a pending change on reset, so it cannot be committed to a blank draft', () => {
    // Committing a change built from rows that no longer exist is the worst version of a
    // silent rewrite: the user reset the screen and then confirmed a dialog they had
    // forgotten about.
    withRows([['A', '192.168.1.128/26', '50']]);
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().reset();
    expect(pending()).toBeNull();
    usePlanStore.getState().commitChange();
    expect(draft().rows[0]?.cidr).toBe('');
  });

  it('can be staged again after a discard', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().discardChange();
    expect(usePlanStore.getState().stageRepack()).toBeNull();
    expect(pending()).not.toBeNull();
  });
});

/* ================================================================== *
 * What the store must not hold
 * ================================================================== */

describe('what the store must not hold', () => {
  beforeEach(resetStore);

  it('holds the draft and the pending change, and nothing else', () => {
    // Named explicitly rather than checked with `Object.keys`, so a new field is a
    // decision someone has to make here.
    const state = usePlanStore.getState() as unknown as Record<string, unknown>;
    const dataFields = Object.keys(state).filter(
      (key) => typeof state[key] !== 'function',
    );
    expect(new Set(dataFields)).toEqual(new Set(['draft', 'pending']));
  });

  it('holds no evaluated outcome', () => {
    // A `PlannerOutcome` in the store goes stale on the very next keystroke unless every
    // mutation recomputes it, and the recomputation is `evaluatePlan` - which the screen
    // already does, on a debounced draft, for a reason.
    const state = usePlanStore.getState() as unknown as Record<string, unknown>;
    expect(Object.keys(state)).not.toContain('outcome');
  });

  it('holds no built view', () => {
    const state = usePlanStore.getState() as unknown as Record<string, unknown>;
    expect(Object.keys(state)).not.toContain('view');
  });

  it('holds no findings array', () => {
    const state = usePlanStore.getState() as unknown as Record<string, unknown>;
    expect(Object.keys(state)).not.toContain('findings');
  });

  it('holds no saved plans, and offers no save action', () => {
    // Phase 9. A draft is not a document until it is saved, and a plan the user
    // abandoned should not survive a restart.
    const state = usePlanStore.getState() as unknown as Record<string, unknown>;
    expect(Object.keys(state)).not.toContain('plans');
    expect(Object.keys(state)).not.toContain('save');
    expect(Object.keys(state)).not.toContain('load');
  });
});

/* ================================================================== *
 * Selectors
 * ================================================================== */

describe('the selectors', () => {
  beforeEach(resetStore);

  it('read the rows', () => {
    withRows([['A', '192.168.1.0/26', '50']]);
    expect(selectRows(usePlanStore.getState())).toHaveLength(1);
  });

  it('report whether a change is waiting', () => {
    withRows([['A', '192.168.1.128/26', '50']]);
    expect(selectHasPending(usePlanStore.getState())).toBe(false);
    usePlanStore.getState().stageRepack();
    expect(selectHasPending(usePlanStore.getState())).toBe(true);
  });

  it('are plain functions, not hooks, so a test can use them', () => {
    // A selector that is a hook cannot be called outside a component, and the one place a
    // planner value is needed outside a screen is a test.
    expect(typeof selectRows).toBe('function');
    expect(typeof selectHasPending).toBe('function');
  });
});
