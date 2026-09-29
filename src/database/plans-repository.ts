/**
 * Plans repository.
 *
 * The ONLY module that executes SQL. Every other layer imports from here.
 * Returns domain types (`NetworkPlan`, `PlannedSubnet`), never raw row objects.
 *
 * The mapping between SQL rows and domain objects is explicit and tested.
 * A hand-written fake would not exercise the real constraint/trigger paths.
 */
import { openDatabase, withTransaction, resetDatabase, selectAll, selectOne, execute } from './database';
import type { NetworkPlan, PlannedSubnet, CustomRole, NetworkRole } from '@/types/network';

/** Row shape as it comes out of SQLite. All columns are TEXT/INTEGER, never null unless noted. */
interface PlanRow {
  id: string;
  name: string;
  description: string;
  parent_cidr: string;
  profile: string;
  created_at: number;
  updated_at: number;
}

interface SubnetRow {
  id: string;
  plan_id: string;
  name: string;
  role: string;
  custom_role_label: string | null;
  vlan_id: number | null;
  network_address: string;
  cidr: string;
  mask: string;
  gateway: string | null;
  requested_hosts: number;
  sort_order: number;
  created_at: number;
}

interface CustomRoleRow {
  id: string;
  name: string;
  created_at: number;
}

/** Ensure the database and statements are ready. Called once at app start. */
export const initRepository = (): void => {
  openDatabase();
};

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

/** Convert a plan row + its subnet rows to a NetworkPlan. */
const toNetworkPlan = (planRow: PlanRow, subnetRows: readonly SubnetRow[]): NetworkPlan => {
  const subnets: PlannedSubnet[] = subnetRows.map((row) =>
    buildSubnet(
      row.id,
      row.name,
      row.role as NetworkRole,
      row.cidr,
      row.requested_hosts,
      row.sort_order,
      row.custom_role_label ?? undefined,
      row.vlan_id ?? undefined,
      row.gateway ?? undefined,
    ),
  );

  return {
    id: planRow.id,
    name: planRow.name,
    description: planRow.description,
    parentCidr: planRow.parent_cidr,
    profile: planRow.profile as NetworkPlan['profile'],
    subnets,
    createdAt: planRow.created_at,
    updatedAt: planRow.updated_at,
  };
};

/** List all plans, newest first. */
export const listPlans = (): readonly NetworkPlan[] => {
  initRepository();
  const db = openDatabase();
  const planRows = selectAll<PlanRow>(db, 'SELECT * FROM network_plans ORDER BY updated_at DESC');
  if (planRows.length === 0) return [];

  const subnetRows = selectAll<SubnetRow>(db, 'SELECT * FROM subnets ORDER BY sort_order');
  const subnetsByPlan = new Map<string, SubnetRow[]>();
  for (const row of subnetRows) {
    const arr = subnetsByPlan.get(row.plan_id);
    if (arr === undefined) subnetsByPlan.set(row.plan_id, [row]);
    else arr.push(row);
  }

  return planRows.map((plan) => toNetworkPlan(plan, subnetsByPlan.get(plan.id) ?? []));
};

/** Load a single plan with its subnets. Returns null if not found. */
export const getPlan = (id: string): NetworkPlan | null => {
  initRepository();
  const db = openDatabase();
  const planRow = selectOne<PlanRow>(db, 'SELECT * FROM network_plans WHERE id = ?', id);
  if (!planRow) return null;

  const subnetRows = selectAll<SubnetRow>(db, 'SELECT * FROM subnets WHERE plan_id = ? ORDER BY sort_order', id);
  return toNetworkPlan(planRow, subnetRows);
};

/** Save a plan (upsert) and its subnets atomically. */
export const savePlan = (plan: NetworkPlan): void => {
  initRepository();
  withTransaction((db) => {
    const now = Date.now();

    // Upsert the plan
    const existing = selectOne<{ '1': number }>(db, 'SELECT 1 FROM network_plans WHERE id = ?', plan.id);
    if (existing) {
      execute(db, `
        UPDATE network_plans
        SET name = ?, description = ?, parent_cidr = ?, profile = ?, updated_at = ?
        WHERE id = ?
      `, plan.name, plan.description, plan.parentCidr, plan.profile, now, plan.id);
    } else {
      execute(db, `
        INSERT INTO network_plans (id, name, description, parent_cidr, profile, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, plan.id, plan.name, plan.description, plan.parentCidr, plan.profile, plan.createdAt, now);
    }

    // Replace subnets: delete then insert.
    execute(db, 'DELETE FROM subnets WHERE plan_id = ?', plan.id);

    for (const subnet of plan.subnets) {
      // Derive network_address and mask from cidr for the list render
      const cidrParts = subnet.cidr.split('/');
      const ipPart = cidrParts[0]!;
      const prefixPart = cidrParts[1]!;
      const prefix = parseInt(prefixPart, 10);
      const ipParts = ipPart.split('.').map(Number);
      const ipOctet0 = ipParts[0] ?? 0;
      const ipOctet1 = ipParts[1] ?? 0;
      const ipOctet2 = ipParts[2] ?? 0;
      const ipOctet3 = ipParts[3] ?? 0;
      const ipInt = (ipOctet0 << 24) | (ipOctet1 << 16) | (ipOctet2 << 8) | ipOctet3;
      const maskInt = prefix === 0 ? 0 : 0xffffffff << (32 - prefix);
      const networkInt = ipInt & maskInt;
      const networkAddr = `${(networkInt >>> 24) & 255}.${(networkInt >>> 16) & 255}.${(networkInt >>> 8) & 255}.${networkInt & 255}`;
      const maskDotted = `${(maskInt >>> 24) & 255}.${(maskInt >>> 16) & 255}.${(maskInt >>> 8) & 255}.${maskInt & 255}`;

      execute(db, `
        INSERT INTO subnets (id, plan_id, name, role, custom_role_label, vlan_id, network_address, cidr, mask, gateway, requested_hosts, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, subnet.id, plan.id, subnet.name, subnet.role, subnet.customRoleLabel ?? null, subnet.vlanId ?? null, networkAddr, subnet.cidr, maskDotted, subnet.gateway ?? null, subnet.requestedHosts, subnet.sortOrder, now);
    }
  });
};

/** Delete a plan. Subnets are removed by ON DELETE CASCADE. */
export const deletePlan = (id: string): void => {
  initRepository();
  withTransaction((db) => {
    execute(db, 'DELETE FROM network_plans WHERE id = ?', id);
  });
};

/** Duplicate a plan with a new ID and updated timestamps. */
export const duplicatePlan = (id: string, newName: string): NetworkPlan | null => {
  initRepository();
  const source = getPlan(id);
  if (source === null) return null;

  const now = Date.now();
  const newId = crypto.randomUUID();

  const duplicate: NetworkPlan = {
    ...source,
    id: newId,
    name: newName,
    createdAt: now,
    updatedAt: now,
    subnets: source.subnets.map((s) => ({ ...s, id: crypto.randomUUID() })),
  };

  savePlan(duplicate);
  return duplicate;
};

/** List all custom roles. */
export const listCustomRoles = (): readonly CustomRole[] => {
  initRepository();
  const db = openDatabase();
  const rows = selectAll<CustomRoleRow>(db, 'SELECT * FROM custom_roles ORDER BY name');
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }));
};

/** Save a custom role. */
export const saveCustomRole = (role: CustomRole): void => {
  initRepository();
  withTransaction((db) => {
    execute(db, 'INSERT INTO custom_roles (id, name, created_at) VALUES (?, ?, ?)', role.id, role.name, role.createdAt);
  });
};

/** Delete a custom role. */
export const deleteCustomRole = (id: string): void => {
  initRepository();
  withTransaction((db) => {
    execute(db, 'DELETE FROM custom_roles WHERE id = ?', id);
  });
};

/** Test-only: reset the repository state. */
export const resetRepository = (): void => {
  resetDatabase();
};