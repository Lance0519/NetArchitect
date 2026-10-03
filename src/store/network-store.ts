/**
 * Network store — the working plan.
 *
 * ## Why this exists, and what it is not
 *
 * The planner store (`plan-store.ts`) holds the draft and one pending change.
 * It is ephemeral: a plan the user abandons should not survive a restart.
 *
 * This store sits *on top* of the planner store. It knows how to:
 *   - Load a `NetworkPlan` from the repository into the planner store
 *   - Save the planner store's draft as a `NetworkPlan` to the repository
 *   - Clear the planner store (new plan)
 *
 * It does NOT persist itself. The `ui-store.ts` pattern of `partialize`-ing
 * preferences to survive does not apply here: the working plan is the thing
 * the user is typing right now, and it dies with the app. SQLite holds the
 * durable copy. This is the spec's "do not store the database in Zustand" rule,
 * made real.
 *
 * ## The two directions
 *
 * Load:  `NetworkPlan` (repository) -> `PlanDraft` (planner store)
 * Save:  `PlanDraft` (planner store) -> `NetworkPlan` (repository)
 *
 * The conversion is lossy by design. The planner draft carries raw text fields
 * (`cidr`, `hosts`, `gateway`) that are *inputs*. The saved plan carries the
 * *resolved* values (`cidr` as a network boundary, `requestedHosts` as a
 * number). When loading, we populate the draft's text fields from the saved
 * values so the screen shows what was saved. When saving, we resolve the
 * draft's text to the values that go in the database.
 *
 * This means a half-typed CIDR is saved as whatever it resolves to *now*. `selectCanSave`
 * deliberately does not gate on `outcome.kind === 'ready'` - the findings panel is for
 * reporting a plan you save and come back to - so a half-typed field can genuinely reach
 * the database, and this lossy resolution is what it resolves to.
 */
import { create } from 'zustand';

import { usePlanStore, freshDraft } from './plan-store';
import { savePlan, getPlan, listPlans, duplicatePlan, deletePlan, listCustomRoles } from '@/database';
import type { NetworkPlan, PlannedSubnet, CustomRole, PlanProfile, NetworkRole } from '@/types/network';
import type { SubnetRowDraft } from '@/core/planner-input';

/** Convert a saved `PlannedSubnet` to a `SubnetRowDraft` for the planner store. */
const subnetToDraft = (subnet: PlannedSubnet): SubnetRowDraft => ({
  id: subnet.id,
  name: subnet.name,
  role: subnet.role,
  customRoleLabel: subnet.customRoleLabel ?? '',
  vlan: subnet.vlanId !== undefined ? String(subnet.vlanId) : '',
  cidr: subnet.cidr,
  gateway: subnet.gateway ?? '',
  gatewayMode: subnet.gateway !== undefined ? 'manual' : 'auto',
  hosts: String(subnet.requestedHosts),
});

/** Build a PlannedSubnet with exactOptionalPropertyTypes support. */
const buildSubnet = (
  id: string,
  name: string,
  role: NetworkRole,
  cidr: string,
  requestedHosts: number,
  sortOrder: number,
  customRoleLabel?: string,
  vlanId?: number,
  gateway?: string,
): PlannedSubnet => ({
  id,
  name,
  role,
  cidr,
  requestedHosts,
  sortOrder,
  ...(customRoleLabel !== undefined && { customRoleLabel }),
  ...(vlanId !== undefined && { vlanId }),
  ...(gateway !== undefined && { gateway }),
});

/** Convert a `SubnetRowDraft` to the `PlannedSubnet` shape for saving. */
const draftToSubnet = (draft: SubnetRowDraft, sortOrder: number): PlannedSubnet =>
  buildSubnet(
    draft.id,
    draft.name,
    draft.role,
    draft.cidr,
    draft.hosts !== '' ? parseInt(draft.hosts, 10) : 0,
    sortOrder,
    draft.customRoleLabel !== '' ? draft.customRoleLabel : undefined,
    draft.vlan !== '' ? parseInt(draft.vlan, 10) : undefined,
    draft.gateway !== '' && draft.gatewayMode !== 'none' ? draft.gateway : undefined,
  );

/** Convert a `PlanDraft` to a `NetworkPlan` for saving. */
const draftToPlan = (draft: {
  name: string;
  description: string;
  parent: string;
  profile: PlanProfile;
  rows: readonly SubnetRowDraft[];
}): NetworkPlan => {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: draft.name,
    description: draft.description,
    parentCidr: draft.parent,
    profile: draft.profile,
    subnets: draft.rows.map((row, index) => draftToSubnet(row, index)),
    createdAt: now,
    updatedAt: now,
  };
};

/** Convert a `NetworkPlan` to a `PlanDraft` for loading. */
const planToDraft = (plan: NetworkPlan): {
  name: string;
  description: string;
  parent: string;
  profile: PlanProfile;
  rows: readonly SubnetRowDraft[];
} => ({
  name: plan.name,
  description: plan.description,
  parent: plan.parentCidr,
  profile: plan.profile,
  rows: plan.subnets.map((s) => subnetToDraft(s)),
});

export interface NetworkActions {
  /** Load a saved plan into the planner store. Replaces the current draft. */
  loadPlan: (id: string) => NetworkPlan | null;
  /** Save the current planner draft as a new plan. Returns the saved plan. */
  saveCurrentPlan: () => NetworkPlan;
  /** Update an existing plan with the current planner draft. */
  updateCurrentPlan: (id: string) => NetworkPlan;
  /**
   * Save the draft, updating the open plan if there is one.
   *
   * The create-or-update decision lives here rather than in the screen so the rule is
   * testable: a screen-level ternary would only be reachable by rendering, and this suite
   * runs in plain Node.
   */
  save: () => NetworkPlan;
  /** Clear the planner store to a blank draft. */
  newPlan: () => void;
  /** Duplicate a plan and load the copy. */
  duplicateAndLoad: (id: string, newName: string) => NetworkPlan | null;
  /** Delete a plan by ID. If it was the loaded one, clears the planner. */
  deletePlan: (id: string) => void;
  /** List all saved plans. */
  listPlans: () => readonly NetworkPlan[];
  /** List custom roles. */
  listCustomRoles: () => readonly CustomRole[];
}

export type NetworkStore = NetworkActions;

/** Write the planner draft to the repository as a brand new plan. */
const writeNewPlan = (): NetworkPlan => {
  const plan = draftToPlan(usePlanStore.getState().draft);
  savePlan(plan);
  return plan;
};

/** Write the planner draft over an existing plan, keeping that plan's identity and birth. */
const writeOverPlan = (id: string): NetworkPlan => {
  const existing = getPlan(id);
  if (existing === null) throw new Error(`Plan ${id} not found`);
  const plan: NetworkPlan = {
    ...draftToPlan(usePlanStore.getState().draft),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  savePlan(plan);
  return plan;
};

export const useNetworkStore = create<NetworkStore>()((_set, _get) => ({
  loadPlan: (id) => {
    const plan = getPlan(id);
    if (plan === null) return null;
    usePlanStore.setState({ draft: planToDraft(plan), pending: null, currentPlanId: plan.id });
    return plan;
  },

  saveCurrentPlan: writeNewPlan,

  updateCurrentPlan: writeOverPlan,

  save: () => {
    const id = usePlanStore.getState().currentPlanId;
    // A plan deleted from /plans while its draft was open leaves the id naming nothing, and
    // `writeOverPlan` throws on a missing plan. Create instead: the user pressed Save on a
    // real draft, and dropping it over a stale id would be the worse failure.
    const plan = id !== null && getPlan(id) !== null ? writeOverPlan(id) : writeNewPlan();
    usePlanStore.setState({ currentPlanId: plan.id });
    return plan;
  },

  newPlan: () => {
    usePlanStore.setState({ draft: freshDraft(), pending: null, currentPlanId: null });
  },

  duplicateAndLoad: (id, newName) => {
    const copy = duplicatePlan(id, newName);
    if (copy === null) return null;
    usePlanStore.setState({ draft: planToDraft(copy), pending: null, currentPlanId: copy.id });
    return copy;
  },

  deletePlan: (id) => {
    deletePlan(id);
    // The id is the only record of which plan the editor holds, so dropping it here is what
    // stops the next Save from writing over a row that no longer exists. The draft itself is
    // left alone: it is the user's unsaved work, and clearing it would discard it silently.
    if (usePlanStore.getState().currentPlanId === id) {
      usePlanStore.setState({ currentPlanId: null });
    }
  },

  listPlans: () => listPlans(),

  listCustomRoles: () => listCustomRoles(),
}));