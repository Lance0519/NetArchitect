/**
 * The create-or-update branch in `save`.
 *
 * The repository is mocked rather than opened: `@/database` pulls in `react-native` for
 * `Platform`, and this suite runs in plain Node (see `vitest.config.mts`). The rule under
 * test is which of two existing writes gets called and what the store remembers afterwards,
 * so a Map keyed by plan id is the whole fixture it needs - `savePlan` twice under two ids
 * is a duplicate plan, which is the bug these tests exist to catch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NetworkPlan } from '@/types/network';

const { saved } = vi.hoisted(() => ({ saved: new Map<string, NetworkPlan>() }));

vi.mock('@/database', () => ({
  savePlan: (plan: NetworkPlan) => void saved.set(plan.id, plan),
  getPlan: (id: string) => saved.get(id) ?? null,
  listPlans: () => [...saved.values()],
  deletePlan: (id: string) => void saved.delete(id),
  duplicatePlan: () => null,
  listCustomRoles: () => [],
}));

import { useNetworkStore } from '@/store/network-store';
import { usePlanStore, selectCanSave } from '@/store/plan-store';

beforeEach(() => {
  saved.clear();
  useNetworkStore.getState().newPlan();
});

describe('save', () => {
  it('creates a plan on the first save and remembers which one it wrote', () => {
    usePlanStore.getState().setName('HQ');

    const plan = useNetworkStore.getState().save();

    expect(saved.size).toBe(1);
    expect(usePlanStore.getState().currentPlanId).toBe(plan.id);
  });

  it('updates the same plan on a second save rather than duplicating it', () => {
    usePlanStore.getState().setName('HQ');
    const first = useNetworkStore.getState().save();

    usePlanStore.getState().setParent('10.0.0.0/8');
    const second = useNetworkStore.getState().save();

    expect(second.id).toBe(first.id);
    expect(saved.size).toBe(1);
    expect(saved.get(first.id)?.parentCidr).toBe('10.0.0.0/8');
  });

  it('updates rather than creates after a plan has been loaded', () => {
    usePlanStore.getState().setName('HQ');
    const plan = useNetworkStore.getState().save();

    useNetworkStore.getState().newPlan();
    useNetworkStore.getState().loadPlan(plan.id);
    usePlanStore.getState().setDescription('now with a description');

    expect(useNetworkStore.getState().save().id).toBe(plan.id);
    expect(saved.size).toBe(1);
  });

  it('keeps the created timestamp across an update', () => {
    usePlanStore.getState().setName('HQ');
    const first = useNetworkStore.getState().save();

    usePlanStore.getState().setDescription('edited');
    const second = useNetworkStore.getState().save();

    expect(second.createdAt).toBe(first.createdAt);
  });

  it('creates a new plan when the open one was deleted behind the editor', () => {
    usePlanStore.getState().setName('HQ');
    const first = useNetworkStore.getState().save();
    saved.delete(first.id);

    const second = useNetworkStore.getState().save();

    expect(second.id).not.toBe(first.id);
    expect(saved.size).toBe(1);
  });

  it('does not overwrite a discarded plan when the editor is cleared and resaved', () => {
    usePlanStore.getState().setName('HQ');
    const first = useNetworkStore.getState().save();

    usePlanStore.getState().reset();
    usePlanStore.getState().setName('Replacement');
    const second = useNetworkStore.getState().save();

    expect(second.id).not.toBe(first.id);
    expect(saved.get(first.id)?.name).toBe('HQ');
    expect(saved.size).toBe(2);
  });
});

describe('currentPlanId', () => {
  it('is null on a new plan', () => {
    expect(usePlanStore.getState().currentPlanId).toBeNull();
  });

  it('survives a staged change, because the change rewrites the draft not its identity', () => {
    usePlanStore.getState().setName('HQ');
    const plan = useNetworkStore.getState().save();

    usePlanStore.getState().setParent('10.0.0.0/8');
    usePlanStore.getState().stageRepack();
    usePlanStore.getState().commitChange();

    expect(usePlanStore.getState().currentPlanId).toBe(plan.id);
  });

  it('is dropped when the plan it names is deleted', () => {
    usePlanStore.getState().setName('HQ');
    const plan = useNetworkStore.getState().save();

    useNetworkStore.getState().deletePlan(plan.id);

    expect(usePlanStore.getState().currentPlanId).toBeNull();
  });
});

describe('selectCanSave', () => {
  it('refuses a blank draft', () => {
    expect(selectCanSave(usePlanStore.getState())).toBe(false);
  });

  it('permits a draft with only a name, because findings are the panel that reports them', () => {
    usePlanStore.getState().setName('HQ');

    expect(selectCanSave(usePlanStore.getState())).toBe(true);
  });

  it('permits a draft with only a parent block', () => {
    usePlanStore.getState().setParent('10.0.0.0/8');

    expect(selectCanSave(usePlanStore.getState())).toBe(true);
  });
});
