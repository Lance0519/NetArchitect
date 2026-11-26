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

import { useNetworkStore } from '@/store/network-store';
import { usePlanStore, selectCanSave } from '@/store/plan-store';
import type { NetworkPlan } from '@/types/network';

const { saved } = vi.hoisted(() => ({ saved: new Map<string, NetworkPlan>() }));

vi.mock('@/database', () => ({
  savePlan: (plan: NetworkPlan) => void saved.set(plan.id, plan),
  getPlan: (id: string) => saved.get(id) ?? null,
  listPlans: () => [...saved.values()],
  deletePlan: (id: string) => void saved.delete(id),
  duplicatePlan: (id: string, newName: string) => {
    const src = saved.get(id);
    if (!src) return null;
    const copy: NetworkPlan = { ...src, id: `${id}-copy`, name: newName };
    saved.set(copy.id, copy);
    return copy;
  },
  listCustomRoles: () => [{ id: 'cr-1', name: 'SCADA', createdAt: 1 }],
}));

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

describe('incomplete draft conversion, direct actions, and reload edge cases', () => {
  it('converts incomplete drafts safely across manual, auto, none gateways, custom roles, and invalid rows', () => {
    usePlanStore.getState().setName('Partial Plan');
    usePlanStore.getState().setParent('10.0.0.5/16'); // normalized to 10.0.0.0/16

    const r1 = usePlanStore.getState().draft.rows[0]!.id;
    usePlanStore.getState().updateRow(r1, {
      name: 'Manual GW',
      cidr: '10.0.1.0/24',
      vlan: '10',
      hosts: '50',
      gateway: '10.0.1.254',
      gatewayMode: 'manual',
      role: 'CUSTOM',
      customRoleLabel: 'OT Floor',
    });

    usePlanStore.getState().addRow({
      name: 'Auto GW',
      cidr: '10.0.2.0/24',
      hosts: '20',
      gatewayMode: 'auto',
    });
    usePlanStore.getState().addRow({
      name: 'No GW',
      cidr: '10.0.3.0/24',
      hosts: '10',
      gatewayMode: 'none',
    });
    // Row with invalid CIDR triggers incomplete-draft fallback branch
    usePlanStore.getState().addRow({
      name: 'Draft Row',
      cidr: '10.0.bad',
      vlan: '9999',
      hosts: 'abc',
      gatewayMode: 'auto',
    });
    // Completely blank row must be skipped
    usePlanStore.getState().addRow();

    const plan = useNetworkStore.getState().saveCurrentPlan();
    expect(plan.parentCidr).toBe('10.0.0.0/16');
    expect(plan.subnets).toHaveLength(4);
    expect(plan.subnets[0]).toMatchObject({
      gateway: '10.0.1.254',
      gatewayMode: 'manual',
      vlanId: 10,
      customRoleLabel: 'OT Floor',
    });
    expect(plan.subnets[1]).toMatchObject({ gateway: '10.0.2.1', gatewayMode: 'auto' });
    expect(plan.subnets[2]?.gateway).toBeUndefined();
    expect(plan.subnets[2]?.gatewayMode).toBe('none');
    expect(plan.subnets[3]).toMatchObject({ cidr: '10.0.bad', requestedHosts: 0 });
    expect(plan.subnets[3]?.vlanId).toBeUndefined();

    // Update directly via updateCurrentPlan, and verify missing-plan error
    usePlanStore.getState().setDescription('updated directly');
    const updated = useNetworkStore.getState().updateCurrentPlan(plan.id);
    expect(updated.description).toBe('updated directly');
    expect(() => useNetworkStore.getState().updateCurrentPlan('missing-id')).toThrow(/not found/);

    // Load missing plan returns null; load valid plan restores all gateway modes
    expect(useNetworkStore.getState().loadPlan('missing-id')).toBeNull();
    expect(useNetworkStore.getState().loadPlan(plan.id)).not.toBeNull();
    const reloaded = usePlanStore.getState().draft.rows;
    expect(reloaded[0]?.gatewayMode).toBe('manual');
    expect(reloaded[0]?.gateway).toBe('10.0.1.254');
    expect(reloaded[1]?.gatewayMode).toBe('auto');
    expect(reloaded[1]?.gateway).toBe('');
    expect(reloaded[2]?.gatewayMode).toBe('none');
  });

  it('supports duplicateAndLoad, listPlans, listCustomRoles, and legacy gatewayMode inference', () => {
    saved.set('legacy', {
      id: 'legacy',
      name: 'Legacy',
      description: '',
      parentCidr: '192.168.0.0/16',
      profile: 'custom',
      subnets: [
        {
          id: 's1',
          name: 'With GW',
          role: 'LAN',
          cidr: '192.168.1.0/24',
          gateway: '192.168.1.1',
          requestedHosts: 10,
          sortOrder: 0,
        },
        {
          id: 's2',
          name: 'Without GW',
          role: 'LAN',
          cidr: '192.168.2.0/24',
          requestedHosts: 10,
          sortOrder: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });

    useNetworkStore.getState().loadPlan('legacy');
    expect(usePlanStore.getState().draft.rows[0]?.gatewayMode).toBe('manual');
    expect(usePlanStore.getState().draft.rows[1]?.gatewayMode).toBe('auto');

    expect(useNetworkStore.getState().duplicateAndLoad('missing', 'Copy')).toBeNull();
    const copy = useNetworkStore.getState().duplicateAndLoad('legacy', 'Legacy Copy');
    expect(copy?.name).toBe('Legacy Copy');
    expect(usePlanStore.getState().currentPlanId).toBe(copy?.id);

    expect(useNetworkStore.getState().listPlans().length).toBeGreaterThanOrEqual(2);
    expect(useNetworkStore.getState().listCustomRoles()).toHaveLength(1);
  });
});
