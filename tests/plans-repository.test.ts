/**
 * Integration tests for the SQLite persistence layer (`migrations.ts`,
 * `plans-repository.ts`, and `network-store.ts` against a real database).
 *
 * Uses Node's built-in `node:sqlite` (`DatabaseSync`) so real SQL constraints
 * (PRIMARY KEY, FOREIGN KEY ON DELETE CASCADE, PRAGMA user_version, v1 -> v2
 * migrations) are exercised instead of a hand-written Map fake.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  MIGRATIONS,
  SCHEMA_VERSION,
  deleteCustomRole,
  deletePlan,
  duplicatePlan,
  getPlan,
  listCustomRoles,
  listPlans,
  runMigrations,
  saveCustomRole,
  savePlan,
  setDatabaseForTests,
} from '@/database';
import { createWebFallbackDatabase } from '@/database/web-fallback';
import { PERSONAL_PROFILE } from '@/core/profiles';
import { useNetworkStore } from '@/store/network-store';
import { usePlanStore } from '@/store/plan-store';
import type { NetworkPlan } from '@/types/network';

// `database.ts` imports `Platform` from `react-native` and `openDatabaseSync`
// from `expo-sqlite`, which are native modules not runnable in plain Node.
// Vitest hoists `vi.mock` above imports automatically so the real repository,
// migrations, and SQLite engine execute unmodified.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('Tests inject an explicit database via setDatabaseForTests');
  },
}));

/**
 * Wrap Node's `DatabaseSync` in the tiny `expo-sqlite` sync surface used by
 * `migrations.ts` and `database.ts`.
 */
function wrapNodeSqlite(raw: DatabaseSync): SQLiteDatabase {
  return {
    execSync(sql: string) {
      raw.exec(sql);
    },
    withTransactionSync<T>(callback: () => T): T {
      raw.exec('BEGIN');
      try {
        const result = callback();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    closeSync() {
      raw.close();
    },
    prepareSync(sql: string) {
      const stmt = raw.prepare(sql);
      return {
        runSync(params: (string | number | null)[] = []) {
          stmt.run(...params);
        },
        getSync<T>() {
          return (stmt.get() as T | undefined) ?? null;
        },
        executeSync<T>(params: (string | number | null)[] = []) {
          const isRead = /^\s*(SELECT|PRAGMA)\b/i.test(sql);
          if (!isRead) {
            stmt.run(...params);
            return {
              getFirstSync: () => null,
              getAllSync: () => [] as T[],
            };
          }
          const rows = stmt.all(...params) as T[];
          return {
            getFirstSync: () => (rows[0] as T | undefined) ?? null,
            getAllSync: () => rows,
          };
        },
        finalizeSync() {
          // node:sqlite statements do not require manual finalization
        },
      };
    },
  } as unknown as SQLiteDatabase;
}

let rawSqlite: DatabaseSync | null = null;

function openFreshSqlite(): SQLiteDatabase {
  rawSqlite = new DatabaseSync(':memory:');
  const wrapped = wrapNodeSqlite(rawSqlite);
  wrapped.execSync('PRAGMA foreign_keys = ON');
  runMigrations(wrapped as unknown as Parameters<typeof runMigrations>[0]);
  setDatabaseForTests(wrapped);
  return wrapped;
}

describe('SQLite migrations (v1 -> v2)', () => {
  afterEach(() => {
    setDatabaseForTests(null);
    rawSqlite?.close();
    rawSqlite = null;
  });

  it('upgrades a populated v1 database to v2 without losing plans or subnets', () => {
    rawSqlite = new DatabaseSync(':memory:');
    const db = wrapNodeSqlite(rawSqlite);
    db.execSync('PRAGMA foreign_keys = ON');

    // Apply ONLY v1 migration manually to simulate an existing user install
    const v1 = MIGRATIONS.find((m) => m.version === 1)!;
    v1.up(db as unknown as Parameters<typeof runMigrations>[0]);
    db.execSync('PRAGMA user_version = 1');

    rawSqlite
      .prepare(
        `INSERT INTO network_plans (id, name, description, parent_cidr, profile, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-plan', 'Legacy HQ', 'v1 plan', '10.0.0.0/16', 'custom', 1000, 1000);
    rawSqlite
      .prepare(
        `INSERT INTO subnets (id, plan_id, name, role, custom_role_label, vlan_id, network_address, cidr, mask, gateway, requested_hosts, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'sub-1',
        'legacy-plan',
        'LAN',
        'LAN',
        null,
        10,
        '10.0.1.0',
        '10.0.1.0/24',
        '255.255.255.0',
        '10.0.1.1',
        50,
        0,
        1000,
      );
    rawSqlite
      .prepare(
        `INSERT INTO subnets (id, plan_id, name, role, custom_role_label, vlan_id, network_address, cidr, mask, gateway, requested_hosts, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'sub-2',
        'legacy-plan',
        'Untagged',
        'LAN',
        null,
        null,
        '10.0.2.0',
        '10.0.2.0/24',
        '255.255.255.0',
        null,
        20,
        1,
        1000,
      );

    // Run v1 -> v2 migration
    runMigrations(db as unknown as Parameters<typeof runMigrations>[0]);
    const version = rawSqlite.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(version.user_version).toBe(SCHEMA_VERSION);

    setDatabaseForTests(db);
    const loaded = getPlan('legacy-plan');
    expect(loaded).not.toBeNull();
    expect(loaded?.subnets).toHaveLength(2);
    expect(loaded?.subnets[0]?.gatewayMode).toBe('manual');
    expect(loaded?.subnets[1]?.gatewayMode).toBe('auto');

    // Composite PK allows a second plan to reuse subnet id `sub-1` safely
    savePlan({
      id: 'second-plan',
      name: 'Branch',
      description: '',
      parentCidr: '10.1.0.0/16',
      profile: 'custom',
      subnets: [
        {
          id: 'sub-1',
          name: 'Branch LAN',
          role: 'LAN',
          cidr: '10.1.1.0/24',
          gatewayMode: 'none',
          requestedHosts: 25,
          sortOrder: 0,
        },
      ],
      createdAt: 2000,
      updatedAt: 2000,
    });

    expect(getPlan('legacy-plan')?.subnets[0]?.name).toBe('LAN');
    expect(getPlan('second-plan')?.subnets[0]?.name).toBe('Branch LAN');
    expect(getPlan('second-plan')?.subnets[0]?.gatewayMode).toBe('none');
  });
});

describe('plans-repository & network-store against real SQLite', () => {
  beforeEach(() => {
    openFreshSqlite();
    useNetworkStore.getState().newPlan();
  });

  afterEach(() => {
    setDatabaseForTests(null);
    rawSqlite?.close();
    rawSqlite = null;
  });

  it('saves two plans from the same profile template without PK collisions', () => {
    usePlanStore.getState().setName('Home 1');
    usePlanStore.getState().setParent('192.168.1.0/24');
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    usePlanStore.getState().commitChange();
    const first = useNetworkStore.getState().save();

    useNetworkStore.getState().newPlan();
    usePlanStore.getState().setName('Home 2');
    usePlanStore.getState().setParent('192.168.2.0/24');
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    usePlanStore.getState().commitChange();
    const second = useNetworkStore.getState().save();

    expect(listPlans()).toHaveLength(2);
    expect(getPlan(first.id)?.subnets).toHaveLength(PERSONAL_PROFILE.entries.length);
    expect(getPlan(second.id)?.subnets).toHaveLength(PERSONAL_PROFILE.entries.length);
  });

  it('preserves gatewayMode = none across save and reload without resurrecting an auto gateway', () => {
    usePlanStore.getState().setName('No-GW Plan');
    usePlanStore.getState().setParent('10.0.0.0/16');
    const rowId = usePlanStore.getState().draft.rows[0]!.id;
    usePlanStore.getState().updateRow(rowId, {
      name: 'Isolated Link',
      cidr: '10.0.1.0/24',
      hosts: '50',
    });
    usePlanStore.getState().setGatewayMode(rowId, 'none');

    const saved = useNetworkStore.getState().save();
    expect(saved.subnets).toHaveLength(1);
    expect(saved.subnets[0]?.gateway).toBeUndefined();
    expect(saved.subnets[0]?.gatewayMode).toBe('none');

    useNetworkStore.getState().newPlan();
    useNetworkStore.getState().loadPlan(saved.id);
    const reloadedRow = usePlanStore.getState().draft.rows[0]!;
    expect(reloadedRow.gatewayMode).toBe('none');
    expect(reloadedRow.gateway).toBe('');
  });

  it('skips untouched blank rows when saving a named-only draft and handles high-octet CIDRs (>=128.x)', () => {
    usePlanStore.getState().setName('High Octet');
    const draftOnly = useNetworkStore.getState().save();
    expect(draftOnly.subnets).toHaveLength(0);

    const highPlan: NetworkPlan = {
      id: 'high-plan',
      name: '192.168 Site',
      description: '',
      parentCidr: '192.168.0.0/16',
      profile: 'custom',
      subnets: [
        {
          id: 's1',
          name: 'LAN',
          role: 'LAN',
          cidr: '192.168.10.0/24',
          gateway: '192.168.10.1',
          gatewayMode: 'auto',
          requestedHosts: 50,
          sortOrder: 0,
        },
        {
          id: 's2',
          name: 'Draft',
          role: 'LAN',
          cidr: '192.168', // incomplete draft CIDR
          requestedHosts: 0,
          sortOrder: 1,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    };
    savePlan(highPlan);

    const rows = rawSqlite!.prepare('SELECT network_address, mask FROM subnets WHERE plan_id = ? ORDER BY sort_order').all('high-plan') as {
      network_address: string;
      mask: string;
    }[];
    expect(rows[0]).toEqual({ network_address: '192.168.10.0', mask: '255.255.255.0' });
    expect(rows[1]).toEqual({ network_address: '', mask: '' });
  });

  it('cascades subnet deletion leaving zero orphans, duplicates cleanly, and manages custom roles', () => {
    usePlanStore.getState().setName('Original');
    usePlanStore.getState().setParent('10.0.0.0/16');
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    usePlanStore.getState().commitChange();
    const original = useNetworkStore.getState().save();

    const copy = duplicatePlan(original.id, 'Copy');
    expect(copy).not.toBeNull();
    expect(copy?.id).not.toBe(original.id);
    expect(copy?.subnets).toHaveLength(original.subnets.length);

    deletePlan(original.id);
    const orphans = rawSqlite!
      .prepare('SELECT COUNT(*) AS count FROM subnets WHERE plan_id = ?')
      .get(original.id) as { count: number };
    expect(orphans.count).toBe(0);

    saveCustomRole({ id: 'role-1', name: 'SCADA', createdAt: 1000 });
    expect(listCustomRoles().map((r) => r.name)).toEqual(['SCADA']);
    deleteCustomRole('role-1');
    expect(listCustomRoles()).toEqual([]);
  });

  it('behaves identically against the Web Fallback database', () => {
    const webDb = createWebFallbackDatabase();
    setDatabaseForTests(webDb);

    useNetworkStore.getState().newPlan();
    usePlanStore.getState().setName('Web Plan A');
    usePlanStore.getState().setParent('10.10.0.0/16');
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    usePlanStore.getState().commitChange();
    const planA = useNetworkStore.getState().save();

    useNetworkStore.getState().newPlan();
    usePlanStore.getState().setName('Web Plan B');
    usePlanStore.getState().setParent('10.20.0.0/16');
    usePlanStore.getState().stageProfile(PERSONAL_PROFILE);
    usePlanStore.getState().commitChange();
    const planB = useNetworkStore.getState().save();

    expect(getPlan(planA.id)?.subnets).toHaveLength(PERSONAL_PROFILE.entries.length);
    expect(getPlan(planB.id)?.subnets).toHaveLength(PERSONAL_PROFILE.entries.length);
  });
});
