/**
 * Tests for the VLSM store.
 *
 * The store is meant to be a thin shell: every operation delegates to a pure function
 * in `src/core/vlsm-input.ts` that `tests/vlsm-view.test.ts` already covers directly. So
 * these tests deliberately do not re-test the arithmetic of add/remove/move - they test
 * the two things that only exist *because* there is a store.
 *
 *  1. Delegation: each action produces the same draft the pure function would.
 *  2. The handoff, which is cross-screen state and is the only place a store can
 *     disagree with what is on screen.
 *
 * Zustand's `getState` and `setState` need no React, so this runs in the same plain Node
 * environment as everything else. No render, no mock, no jsdom.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateVlsm, moveRow, setParent, updateRow } from '../src/core/vlsm-input';
import { useVlsmStore } from '../src/store/vlsm-store';

/** The current draft, read the way a component would. */
const draftOf = () => useVlsmStore.getState().draft;

/**
 * A draft that packs, used to make the hand-off path reachable.
 *
 * Note the fresh `getState()` on every line. Zustand returns a *snapshot*: the action
 * functions on it are stable and safe to call, but its `draft` property is frozen at
 * the moment of the read. Holding one snapshot and calling `addRow()` on it then reading
 * `snapshot.draft.rows[1]` returns `undefined` - which is a bug in the test, not in the
 * store, and one that fails confusingly enough to be worth this comment.
 */
const packable = () => {
  const action = <T,>(pick: (s: ReturnType<typeof useVlsmStore.getState>) => T): T =>
    pick(useVlsmStore.getState());

  action((s) => s.setParent('192.168.1.0/24'));
  const first = action((s) => s.draft.rows[0]?.id);
  if (first !== undefined) {
    action((s) => s.updateRow(first, { name: 'Students', hosts: '100' }));
  }
  action((s) => s.addRow());
  const second = action((s) => s.draft.rows[1]?.id);
  if (second !== undefined) {
    action((s) => s.updateRow(second, { name: 'IT', hosts: '50' }));
  }
};

beforeEach(() => {
  useVlsmStore.getState().reset();
});

afterEach(() => {
  useVlsmStore.getState().reset();
});

describe('initial state', () => {
  it('starts from the same draft as the pure module', () => {
    // Duplicated construction rather than calling `initialDraft()` again, so a change to
    // one is not silently adopted by the other.
    expect(draftOf().parent).toBe('');
    expect(draftOf().rows).toHaveLength(1);
    expect(draftOf().rows[0]?.name).toBe('');
  });

  it('has nothing pending for the planner', () => {
    expect(useVlsmStore.getState().pendingHandoff).toBeNull();
  });
});

describe('delegation to the pure operations', () => {
  it('delegates setParent', () => {
    useVlsmStore.getState().setParent('10.0.0.0/22');
    expect(draftOf()).toEqual(setParent(draftOf(), '10.0.0.0/22'));
  });

  it('delegates updateRow', () => {
    const id = draftOf().rows[0]?.id as string;
    useVlsmStore.getState().updateRow(id, { name: 'A' });
    expect(draftOf()).toEqual(updateRow(draftOf(), id, { name: 'A' }));
  });

  it('delegates addRow', () => {
    // Compared by shape rather than by value: `addRow` mints a fresh draft id from a
    // module-scoped counter, so a `toEqual` against a second `addRow(...)` call would
    // differ by construction. Full-object comparison is done by the remove and move
    // cases below, where the ids already exist.
    const before = draftOf();
    useVlsmStore.getState().addRow();
    expect(draftOf().rows).toHaveLength(before.rows.length + 1);
    expect(new Set(draftOf().rows.map((row) => row.id)).size).toBe(before.rows.length + 1);
    expect(draftOf().parent).toBe(before.parent);
  });

  it('delegates removeRow, and refuses to empty itself', () => {
    packable();
    useVlsmStore.getState().removeRow(draftOf().rows[0]?.id as string);
    expect(draftOf().rows).toHaveLength(1);
    useVlsmStore.getState().removeRow(draftOf().rows[0]?.id as string);
    expect(draftOf().rows).toHaveLength(1);
  });

  it('delegates moveRow', () => {
    packable();
    const from = draftOf();
    const moved = from.rows[1]?.id as string;

    useVlsmStore.getState().moveRow(moved, -1);

    expect(draftOf()).toEqual(moveRow(from, moved, -1));
    expect(draftOf().rows[0]?.id).toBe(moved);
  });

  it('delegates reset, discarding the draft', () => {
    packable();
    useVlsmStore.getState().reset();
    expect(draftOf().parent).toBe('');
    expect(draftOf().rows).toHaveLength(1);
  });
});

describe('the hand-off to the planner', () => {
  it('stages nothing when the draft is empty', () => {
    expect(useVlsmStore.getState().stageHandoff()).toBe(false);
    expect(useVlsmStore.getState().pendingHandoff).toBeNull();
  });

  it('stages nothing when the parent is unreadable', () => {
    useVlsmStore.getState().setParent('nonsense');
    const id = draftOf().rows[0]?.id as string;
    useVlsmStore.getState().updateRow(id, { name: 'A', hosts: '10' });
    expect(useVlsmStore.getState().stageHandoff()).toBe(false);
  });

  it('stages nothing when a requirement is unfinished', () => {
    useVlsmStore.getState().setParent('192.168.1.0/24');
    const id = draftOf().rows[0]?.id as string;
    useVlsmStore.getState().updateRow(id, { name: 'A' });
    expect(useVlsmStore.getState().stageHandoff()).toBe(false);
  });

  it('stages nothing when the requirements do not fit', () => {
    useVlsmStore.getState().setParent('192.168.1.0/24');
    const id = draftOf().rows[0]?.id as string;
    useVlsmStore.getState().updateRow(id, { name: 'A', hosts: '300' });
    expect(useVlsmStore.getState().stageHandoff()).toBe(false);
  });

  it('stages the packed allocation when there is one', () => {
    packable();
    expect(useVlsmStore.getState().stageHandoff()).toBe(true);
    const staged = useVlsmStore.getState().pendingHandoff;
    expect(staged?.parentCidr).toBe('192.168.1.0/24');
    expect(staged?.allocations.map((a) => a.cidr)).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/26',
    ]);
  });

  it('stages the requirements, not the draft text', () => {
    packable();
    useVlsmStore.getState().stageHandoff();
    const staged = useVlsmStore.getState().pendingHandoff;
    expect(staged?.requirements).toEqual([
      { id: expect.any(String), name: 'Students', requestedHosts: 100, role: 'LAN' },
      { id: expect.any(String), name: 'IT', requestedHosts: 50, role: 'LAN' },
    ]);
  });

  it('stages exactly what `evaluateVlsm` allocated, from the same draft', () => {
    // The point of deriving inside `stageHandoff` rather than storing a copy: the two
    // cannot describe different plans.
    packable();
    useVlsmStore.getState().stageHandoff();
    const outcome = evaluateVlsm(draftOf());
    if (outcome.kind !== 'ok') throw new Error('expected a result');
    expect(useVlsmStore.getState().pendingHandoff?.allocations).toEqual(
      outcome.result.allocations.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        cidr: a.assignedCidr,
      })),
    );
  });

  it('consumes the staged hand-off, and only once', () => {
    packable();
    useVlsmStore.getState().stageHandoff();
    expect(useVlsmStore.getState().consumeHandoff()?.parentCidr).toBe('192.168.1.0/24');
    // Cleared on read, so navigating back to the planner cannot re-apply a hand-off the
    // user has since edited past.
    expect(useVlsmStore.getState().pendingHandoff).toBeNull();
    expect(useVlsmStore.getState().consumeHandoff()).toBeNull();
  });

  it('consumes nothing when nothing was staged', () => {
    expect(useVlsmStore.getState().consumeHandoff()).toBeNull();
  });

  it('re-stages on a second call, replacing the first', () => {
    packable();
    useVlsmStore.getState().stageHandoff();
    const second = draftOf().rows[1]?.id as string;
    // 50 hosts needs a /26; 10 needs a /28. Both still fit the /24, so the second
    // staging genuinely succeeds and replaces the first.
    useVlsmStore.getState().updateRow(second, { hosts: '10' });
    expect(useVlsmStore.getState().stageHandoff()).toBe(true);
    expect(useVlsmStore.getState().pendingHandoff?.allocations.map((a) => a.cidr)).toEqual([
      '192.168.1.0/25',
      '192.168.1.128/28',
    ]);
  });

  it('clears a staged hand-off when the draft stops being valid', () => {
    // Found by a test that was trying to do something else. The alternative - leaving the
    // previous payload in place - means the store can hold a plan its own requirements no
    // longer support, and only the return value stands between that and the planner.
    packable();
    expect(useVlsmStore.getState().stageHandoff()).toBe(true);
    const first = draftOf().rows[0]?.id as string;
    // 200 hosts plus the existing 50 no longer fit a /24.
    useVlsmStore.getState().updateRow(first, { hosts: '200' });
    expect(useVlsmStore.getState().stageHandoff()).toBe(false);
    expect(useVlsmStore.getState().pendingHandoff).toBeNull();
    expect(useVlsmStore.getState().consumeHandoff()).toBeNull();
  });

  it('clears a staged hand-off when a requirement is emptied', () => {
    packable();
    useVlsmStore.getState().stageHandoff();
    const first = draftOf().rows[0]?.id as string;
    useVlsmStore.getState().updateRow(first, { name: '' });
    expect(useVlsmStore.getState().stageHandoff()).toBe(false);
    expect(useVlsmStore.getState().pendingHandoff).toBeNull();
  });

  it('leaves the draft alone, so the planner opening does not clear the VLSM work', () => {
    packable();
    useVlsmStore.getState().stageHandoff();
    useVlsmStore.getState().consumeHandoff();
    expect(draftOf().parent).toBe('192.168.1.0/24');
    expect(draftOf().rows).toHaveLength(2);
  });
});

describe('what the store must not hold', () => {
  it('holds only the draft, the hand-off and the actions', () => {
    // The exhaustive form, so a new field is a deliberate addition rather than something
    // a reader has to notice. A cached `result` or `allocations` field would be one
    // keystroke behind the rows above it - the exact bug a store is supposed to prevent
    // by not caching.
    const data = Object.entries(useVlsmStore.getState()).filter(
      ([, value]) => typeof value !== 'function',
    );
    expect(data.map(([key]) => key).sort()).toEqual(['draft', 'pendingHandoff']);
  });
});
