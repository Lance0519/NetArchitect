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
import { calculateSubnet, integerToIPv4, parseCidr } from '@/core/ip-engine';
import { generateId } from '@/utils/id';
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
  gateway_mode?: string | null;
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
  gatewayMode?: PlannedSubnet['gatewayMode'],
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
  ...(gatewayMode !== undefined && { gatewayMode }),
});

const parseGatewayMode = (raw: string | null | undefined, hasGateway: boolean): PlannedSubnet['gatewayMode'] => {
  if (raw === 'auto' || raw === 'manual' || raw === 'none') return raw;
  return hasGateway ? 'manual' : 'auto';
};

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
      parseGatewayMode(row.gateway_mode, row.gateway !== null),
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
      // Derive network_address and mask through the pure IPv4 engine (unsigned
      // 32-bit arithmetic). Draft subnets with incomplete CIDRs persist safely
      // with empty derived fields rather than fabricating 0.0.0.0.
      let networkAddr = '';
      let maskDotted = '';
      if (subnet.cidr.trim().length > 0) {
        try {
          const parsed = parseCidr(subnet.cidr.trim());
          const info = calculateSubnet(parsed.ip, parsed.prefix);
          networkAddr = integerToIPv4(info.networkAddress);
          maskDotted = integerToIPv4(info.subnetMask);
        } catch {
          networkAddr = '';
          maskDotted = '';
        }
      }

      const gatewayMode =
        subnet.gatewayMode ?? (subnet.gateway !== undefined ? 'manual' : 'auto');

      execute(
        db,
        `
        INSERT INTO subnets (
          id, plan_id, name, role, custom_role_label, vlan_id,
          network_address, cidr, mask, gateway, gateway_mode,
          requested_hosts, sort_order, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        subnet.id,
        plan.id,
        subnet.name,
        subnet.role,
        subnet.customRoleLabel ?? null,
        subnet.vlanId ?? null,
        networkAddr,
        subnet.cidr,
        maskDotted,
        subnet.gateway ?? null,
        gatewayMode,
        Number.isFinite(subnet.requestedHosts) ? subnet.requestedHosts : 0,
        subnet.sortOrder,
        now,
      );
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
  const newId = generateId();

  const duplicate: NetworkPlan = {
    ...source,
    id: newId,
    name: newName,
    createdAt: now,
    updatedAt: now,
    subnets: source.subnets.map((s) => ({ ...s, id: generateId() })),
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