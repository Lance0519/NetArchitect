/**
 * The planner store.
 *
 * The draft, the staged change, and nothing else.
 *
 * ## What is in here and what is not
 *
 * In: the {@link PlanDraft} the user is typing, the {@link PlanChange} awaiting their
 * confirmation, and the hand-off staging slot.
 *
 * Out: every derived value. There is no `outcome`, no `view`, no `summary`, no `findings`
 * field. All of those are `buildPlanView(draft, evaluatePlan(draft))`, computed in a
 * `useMemo` on the screen from the debounced draft.
 *
 * That is not tidiness. A derived value held in a store goes stale the moment the input
 * changes, and the two ways to go stale - a forgotten `set` after a mutation, or a
 * `getState()` snapshot read after an action - are exactly the bugs this project has
 * already hit once (see `getState()` in the Phase 7 notes). A draft is the only thing
 * here that is genuinely state.
 *
 * ## Why the pending change is in the store
 *
 * `plan-changes.ts` returns a value and mutates nothing. Something has to hold that value
 * between "the user tapped Reallocate" and "the user looked at the preview and said yes",
 * and a store is the only place that survives the re-render in between.
 *
 * It is cleared on every path that resolves it. A store that keeps a stale change around
 * is a store that can re-offer a preview of a plan that no longer exists, and the user
 * who taps "Apply" to a dialog they have not seen gets a rewrite nobody warned them
 * about.
 *
 * ## Why there is no persistence here
 *
 * Phase 9. A draft is not a document until it is saved, and this store holds only drafts.
 * It has no `save`, no `load`, and no `partialize`, because there is nothing durable in it
 * to preserve - a plan the user abandoned should not survive a restart. The `ui-store.ts`
 * pattern of `partialize`-ing preferences to survive does not apply, and adding it here
 * would be assuming Phase 9's answer.
 */

import { create } from 'zustand';

import {
  addRow as addRowTo,
  initialPlanDraft,
  moveRow as moveRowIn,
  removeRow as removeRowFrom,
  resetPlanDraft,
  setGatewayMode as setGatewayModeOf,
  updateHeader as updateHeaderIn,
  updateRow as updateRowIn,
  type GatewayMode,
  type PlanDraft,
  type SubnetRowDraft,
} from '@/core/planner-input';
import { nextFreeVlanId } from '@/core/planner-input';
import {
  adoptHandoff,
  previewProfile,
  previewRepack,
  type PlanChange,
} from '@/core/plan-changes';
import type { ProfileDefinition } from '@/core/profiles';
import type { PlanHandoff } from '@/store/vlsm-store';

import type { NetworkRole, PlanProfile } from '@/types/network';

/**
 * Why a change is waiting for confirmation.
 *
 * Carried so the preview can say what it is *for*. "Servers moves from .128/26 to
 * .64/26" is a fact; "Reallocating 4 subnets will do this" is a warning. Without the
 * reason, the dialog reads as a diff with no stakes attached.
 */
export type ChangeReason = 'repack' | 'profile' | 'handoff';

export interface PendingChange {
  readonly reason: ChangeReason;
  /** The proposal. The draft is not touched until `commitChange` is called. */
  readonly change: PlanChange;
  /** One line naming what the user asked for, e.g. `the Home Lab template`. */
  readonly subject: string;
  /** Rows the change would discard, for the warning. Empty for a repack. */
  readonly discardedRowIds: readonly string[];
}

export interface PlanActions {
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setParent: (parent: string) => void;
  setProfile: (profile: PlanProfile) => void;
  updateRow: (id: string, patch: Partial<Omit<SubnetRowDraft, 'id'>>) => void;
  setGatewayMode: (id: string, mode: GatewayMode) => void;
  addRow: (overrides?: Partial<SubnetRowDraft>) => void;
  /** Add a row seeded with the next free VLAN ID, when the role expects one. */
  addTaggedRow: () => void;
  removeRow: (id: string) => void;
  moveRow: (id: string, by: -1 | 1) => void;
  /** Back to a blank draft. Refuses while a change is pending. */
  reset: () => void;

  /**
   * Compute a reallocation and stage it.
   *
   * Returns the engine's own message when it cannot be done, and `null` on success. A
   * boolean would be the tidier signature and the worse one: `previewRepack` refuses for
   * three different reasons - nothing to pack, no parent, requirements that do not fit -
   * each with a sentence written for the user, and a `false` throws all three away. The
   * caller has to say *something*, and it has nothing to say except what it was given.
   */
  stageRepack: () => string | null;
  /** As {@link PlanActions.stageRepack}, for a template application. */
  stageProfile: (profile: ProfileDefinition) => string | null;
  /**
   * Take the VLSM screen's hand-off.
   *
   * Applies directly when there is nothing to lose, and stages a preview when there is -
   * the one place the two paths differ, and it is decided here rather than in the screen
   * so the rule is testable.
   *
   * Declined outright if a change is already staged. See the action.
   */
  takeHandoff: (handoff: PlanHandoff | null) => void;

  /** Read and clear the staged change. */
  discardChange: () => void;
  /** Adopt the staged change's draft and clear it. */
  commitChange: () => void;
}

export type PlanStore = {
  readonly draft: PlanDraft;
  readonly pending: PendingChange | null;
  /**
   * The saved plan this draft came from, or `null` when it has never been one.
   *
   * Without it there is no way to tell a first save from a second: `saveCurrentPlan` mints a
   * fresh id every call, and `planToDraft` drops the id on the way in, so pressing Save twice
   * on one plan would leave two near-identical plans in the list. It lives here rather than in
   * the screen because the draft *is* the thing that plan produced - a `useState` on the
   * planner would forget the id on remount and duplicate the plan on the next save.
   */
  readonly currentPlanId: string | null;
} & PlanActions;

export const usePlanStore = create<PlanStore>()((set, get) => ({
  draft: initialPlanDraft(),
  pending: null,
  currentPlanId: null,

  setName: (name) => set((state) => ({ draft: updateHeaderIn(state.draft, { name }) })),
  setDescription: (description) =>
    set((state) => ({ draft: updateHeaderIn(state.draft, { description }) })),
  setParent: (parent) => set((state) => ({ draft: updateHeaderIn(state.draft, { parent }) })),
  setProfile: (profile) => set((state) => ({ draft: updateHeaderIn(state.draft, { profile }) })),

  updateRow: (id, patch) => set((state) => ({ draft: updateRowIn(state.draft, id, patch) })),
  setGatewayMode: (id, mode) =>
    set((state) => ({ draft: setGatewayModeOf(state.draft, id, mode) })),

  addRow: (overrides) => set((state) => ({ draft: addRowTo(state.draft, overrides) })),

  addTaggedRow: () =>
    set((state) => {
      // The suggestion is read from the draft *before* the row is added, so a row is
      // never seeded with a VLAN its own presence would have displaced. Reading it after
      // would be the same number either way here, but the ordering makes the rule obvious
      // and keeps it correct if the seed ever grows a role.
      const vlan = nextFreeVlanId(state.draft.rows);
      return {
        draft: addRowTo(state.draft, vlan === null ? undefined : { vlan: String(vlan) }),
      };
    }),

  removeRow: (id) => set((state) => ({ draft: removeRowFrom(state.draft, id) })),
  moveRow: (id, by) => set((state) => ({ draft: moveRowIn(state.draft, id, by) })),

  reset: () => {
    // The pending change is cleared rather than left describing a draft that is about to
    // be replaced. Committing it afterwards would write a plan built from rows that no
    // longer exist. The plan id goes with it: the user threw this draft away, so the next
    // Save has to write a new plan rather than overwrite the one this draft came from.
    set({ draft: resetPlanDraft(), pending: null, currentPlanId: null });
  },

  stageRepack: () => {
    const outcome = previewRepack(get().draft);
    // `blocked` and `nothing-to-do` both carry a message written for a user. Returning it
    // rather than a bare `false` is the difference between "this will not work" and "there
    // is not room in 192.168.1.0/24 for what you have asked for" - the second of which is
    // something the user can act on.
    if (outcome.kind !== 'change') return outcome.message;
    set({
      pending: {
        reason: 'repack',
        change: outcome.change,
        subject: 'Reallocating from host counts',
        discardedRowIds: outcome.skippedRowIds,
      },
    });
    return null;
  },

  stageProfile: (profile) => {
    const outcome = previewProfile(get().draft, profile);
    if (outcome.kind !== 'change') return outcome.message;
    set({
      pending: {
        reason: 'profile',
        change: outcome.change,
        subject: profile.label,
        discardedRowIds: outcome.discardedRowIds,
      },
    });
    return null;
  },

  takeHandoff: (handoff) => {
    if (handoff === null) return;
    // A hand-off arriving while a preview is open is declined, not swapped in. The screen
    // calls this from a mount effect and cannot know what the user has done since, so the
    // guard belongs here rather than in the caller: a store action that silently discards
    // the proposal the user is reading would be a rewrite nobody confirmed.
    //
    // Reached only by calling `takeHandoff` twice, or once after a user-initiated stage.
    // Cheap, and it is an invariant rather than a timing detail.
    if (get().pending !== null) return;
    // `get().draft` is read once and passed on, rather than read field-by-field after the
    // change is computed. Holding a Zustand snapshot and then reading its properties
    // around an action reads values frozen at snapshot time - the bug this project has
    // already hit once.
    const change = adoptHandoff(get().draft, handoff);

    // Nothing to lose means the draft is blank: no rows carrying content, and no name or
    // parent typed. Opening the planner and finding a table full of allocated addresses
    // should not arrive behind a dialog, because there was no draft for the user to lose.
    if (isUntouched(get().draft)) {
      set({ draft: change.next, pending: null });
      return;
    }

    set({
      pending: {
        reason: 'handoff',
        change,
        subject: 'the VLSM allocation',
        discardedRowIds: change.rows
          .filter((row) => row.kind === 'removed')
          .map((row) => (row.kind === 'removed' ? row.row.id : '')),
      },
    });
  },

  discardChange: () => set({ pending: null }),

  commitChange: () => {
    const pending = get().pending;
    if (pending === null) return;
    set({ draft: pending.change.next, pending: null });
  },
}));

/**
 * Whether a draft holds nothing worth preserving.
 *
 * "Untouched" rather than "empty": a draft the user has named or given a parent to is
 * theirs, and a preview is the right way to replace it. One with a single blank row and
 * no header is the screen's opening state, and confirming its destruction would be
 * confirming something that was never there.
 *
 * A row that carries *anything* counts as content - including a half-typed CIDR, because
 * a user who typed three characters of a subnet has content worth a dialog.
 */
const isUntouched = (draft: PlanDraft): boolean =>
  draft.name.trim().length === 0 &&
  draft.description.trim().length === 0 &&
  draft.parent.trim().length === 0 &&
  draft.rows.every(
    (row) =>
      row.name.trim().length === 0 &&
      row.cidr.trim().length === 0 &&
      row.hosts.trim().length === 0 &&
      row.vlan.trim().length === 0 &&
      row.gateway.trim().length === 0,
  );

/* ------------------------------------------------------------------ *
 * Selectors
 *
 * Plain functions, not hooks. A selector that is a hook is a store read that cannot be
 * used outside a component, and the one place a planner value is needed outside a screen -
 * a test - is exactly the place a hook is useless.
 * ------------------------------------------------------------------ */

/** The draft's rows, for a caller that only needs the list. */
export const selectRows = (state: PlanStore): readonly SubnetRowDraft[] => state.draft.rows;

/** Whether a change is waiting for the user. */
export const selectHasPending = (state: PlanStore): boolean => state.pending !== null;

/**
 * Whether the draft holds anything worth writing to disk.
 *
 * Findings deliberately do not block it. `PlanFindingList` exists to report what is wrong with
 * a plan the user is going to save anyway and come back to, and a button that greys out until
 * every finding is resolved turns that panel into a wall. So this is the same `isUntouched` the
 * reset guard uses, and nothing more: a blank draft is nothing to save, an imperfect one is.
 */
export const selectCanSave = (state: PlanStore): boolean => !isUntouched(state.draft);

/** Create a fresh blank draft. Exported for tests and the network store. */
export const freshDraft = (): PlanDraft => initialPlanDraft();

/** Reset a draft to blank. Exported for tests and the network store. */
export const blankDraft = (): PlanDraft => resetPlanDraft();

/**
 * The role a new row should default to.
 *
 * `LAN` for an ordinary plan. A planner that opened its new rows on `GUEST` or `DMZ`
 * would be nudging the user toward a decision they have not made, and the first thing
 * most plans contain is a user LAN.
 */
export const DEFAULT_NEW_ROW_ROLE: NetworkRole = 'LAN';
