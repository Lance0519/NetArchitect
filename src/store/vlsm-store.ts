/**
 * The VLSM screen's working state.
 *
 * ## What this store is allowed to contain
 *
 * A draft: the parent text and the requirement rows exactly as typed. That is all.
 *
 * It holds no allocation, no utilisation figure and no summary. Those are derived, and
 * every consumer derives them the same way through `evaluateVlsm`. A store that cached
 * them would need invalidating on every keystroke, and the bug that follows is a stale
 * allocation on screen that no longer matches the requirements above it.
 *
 * ## Why the list operations are not here
 *
 * Adding, removing and reordering live in `src/core/vlsm-input.ts` as pure functions,
 * and this store only calls them. That is not tidiness: `moveRow` and `removeRow` are
 * where the fiddly off-by-one and identity bugs live, and a pure function is something
 * `tests/vlsm-view.test.ts` can exercise directly. Inside a Zustand action they would be
 * reachable only by rendering a screen, and R4 has declined a component-test runner.
 *
 * ## Why the draft survives tab switches
 *
 * It is in a store rather than component state, so switching to the calculator and back
 * does not discard a half-built plan. `partialize` is not used and there is no
 * `persist`: an unsaved scratchpad is not a document, and a draft restored from disk on
 * launch would be indistinguishable from one the user believes they cleared.
 *
 * ## The handoff
 *
 * `pendingHandoff` is the one piece of cross-screen state, and it exists so "Send to
 * Network Planner" is an actual hand-off rather than a copy-and-paste. It holds the
 * *packed* result, not the draft, so the planner opens showing the subnets that were
 * actually allocated. `consumeHandoff` clears it on read, so navigating back to the
 * planner does not silently overwrite a plan the user has since edited.
 */

import { create } from 'zustand';

import {
  addRow as addRowTo,
  evaluateVlsm,
  initialDraft,
  moveRow as moveRowIn,
  removeRow as removeRowFrom,
  setParent as setParentOf,
  updateRow as updateRowIn,
  type VlsmDraft,
  type VlsmRowDraft,
} from '@/core/vlsm-input';
import { handoffOf } from '@/utils/vlsm-view';

import type { NetworkRole } from '@/types/network';

/** What the Network Planner receives. Built by `handoffOf`, never by hand. */
export interface PlanHandoff {
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
}

interface VlsmActions {
  setParent: (parent: string) => void;
  updateRow: (id: string, patch: Partial<Omit<VlsmRowDraft, 'id'>>) => void;
  addRow: (overrides?: Partial<VlsmRowDraft>) => void;
  removeRow: (id: string) => void;
  moveRow: (id: string, by: -1 | 1) => void;
  reset: () => void;
  /** Take the current allocation and stage it for the planner. Returns false if there is none. */
  stageHandoff: () => boolean;
  /** Read and clear the staged handoff. Called once, by the planner. */
  consumeHandoff: () => PlanHandoff | null;
}

export type VlsmStore = { readonly draft: VlsmDraft; readonly pendingHandoff: PlanHandoff | null } & VlsmActions;

export const useVlsmStore = create<VlsmStore>()((set, get) => ({
  draft: initialDraft(),
  pendingHandoff: null,

  setParent: (parent) => set((state) => ({ draft: setParentOf(state.draft, parent) })),
  updateRow: (id, patch) => set((state) => ({ draft: updateRowIn(state.draft, id, patch) })),
  addRow: (overrides) => set((state) => ({ draft: addRowTo(state.draft, overrides) })),
  removeRow: (id) => set((state) => ({ draft: removeRowFrom(state.draft, id) })),
  moveRow: (id, by) => set((state) => ({ draft: moveRowIn(state.draft, id, by) })),
  reset: () => set({ draft: initialDraft() }),

  stageHandoff: () => {
    // Derived here rather than stored, so what is handed over is what is on screen. A
    // staged copy from an earlier keystroke would open the planner on a stale plan.
    const handoff = handoffOf(evaluateVlsm(get().draft));
    if (handoff === null) {
      // Cleared on failure, not left in place. The draft is no longer valid, so a
      // previously staged payload no longer describes it - and a caller that ignored the
      // return value would then navigate to a plan the requirements above no longer
      // support. A store whose contents can contradict its own input is worse than one
      // that is simply empty.
      set({ pendingHandoff: null });
      return false;
    }
    set({ pendingHandoff: handoff });
    return true;
  },

  consumeHandoff: () => {
    const handoff = get().pendingHandoff;
    if (handoff !== null) set({ pendingHandoff: null });
    return handoff;
  },
}));
