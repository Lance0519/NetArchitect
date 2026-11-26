import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../src/database/migrations';
import { createWebFallbackDatabase } from '../src/database/web-fallback';

describe('createWebFallbackDatabase', () => {
  it('creates a database interface compatible with SQLite operations', () => {
    const db = createWebFallbackDatabase();
    expect(db).toBeDefined();

    // Verify transaction support
    const res = db.withTransactionSync(() => 42);
    expect(res).toBe(42);

    // Verify migrations / pragma
    const stmt = db.prepareSync('PRAGMA user_version');
    const versionRow = stmt.executeSync().getFirstSync() as { user_version: number } | null;
    expect(versionRow?.user_version).toBe(SCHEMA_VERSION);
    stmt.finalizeSync();

    // Insert two plans that intentionally share the same subnet id (`personal-0`)
    const insertStmt = db.prepareSync(`
      INSERT INTO network_plans (id, name, description, parent_cidr, profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.executeSync(['plan-web-1', 'Web Plan 1', 'Test plan', '10.0.0.0/16', 'personal', 100, 100]);
    insertStmt.executeSync(['plan-web-2', 'Web Plan 2', 'Second plan', '10.1.0.0/16', 'personal', 200, 200]);
    insertStmt.finalizeSync();

    // Query plan by id
    const selectStmt = db.prepareSync('SELECT * FROM network_plans WHERE id = ?');
    const plan = selectStmt.executeSync(['plan-web-1']).getFirstSync() as { id: string; name: string } | null;
    expect(plan).toBeDefined();
    expect(plan?.id).toBe('plan-web-1');
    expect(plan?.name).toBe('Web Plan 1');
    selectStmt.finalizeSync();

    // Query all plans (newest updated_at first)
    const allStmt = db.prepareSync('SELECT * FROM network_plans ORDER BY updated_at DESC');
    const allPlans = allStmt.executeSync().getAllSync() as { id: string }[];
    expect(allPlans).toHaveLength(2);
    expect(allPlans[0]?.id).toBe('plan-web-2');
    allStmt.finalizeSync();

    // Insert subnets with identical local IDs across two plans (must not collide or steal)
    const subStmt = db.prepareSync(`
      INSERT INTO subnets (
        id, plan_id, name, role, custom_role_label, vlan_id,
        network_address, cidr, mask, gateway, gateway_mode,
        requested_hosts, sort_order, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    subStmt.executeSync([
      'personal-0',
      'plan-web-1',
      'LAN 1',
      'LAN',
      null,
      10,
      '10.0.1.0',
      '10.0.1.0/24',
      '255.255.255.0',
      '10.0.1.1',
      'auto',
      100,
      0,
      100,
    ]);
    subStmt.executeSync([
      'personal-0',
      'plan-web-2',
      'LAN 2',
      'LAN',
      null,
      10,
      '10.1.1.0',
      '10.1.1.0/24',
      '255.255.255.0',
      null,
      'none',
      50,
      0,
      200,
    ]);
    // Duplicate (plan_id, id) must fail with UNIQUE constraint error
    expect(() =>
      subStmt.executeSync([
        'personal-0',
        'plan-web-1',
        'Duplicate',
        'LAN',
        null,
        10,
        '10.0.2.0',
        '10.0.2.0/24',
        '255.255.255.0',
        null,
        'none',
        10,
        1,
        100,
      ]),
    ).toThrow(/UNIQUE constraint failed/);
    subStmt.finalizeSync();

    // Both plans retain their own subnets independently
    const qSub = db.prepareSync('SELECT * FROM subnets WHERE plan_id = ? ORDER BY sort_order');
    const subnets1 = qSub.executeSync(['plan-web-1']).getAllSync() as { name: string; gateway_mode: string }[];
    const subnets2 = qSub.executeSync(['plan-web-2']).getAllSync() as { name: string; gateway_mode: string }[];
    expect(subnets1).toHaveLength(1);
    expect(subnets1[0]?.name).toBe('LAN 1');
    expect(subnets1[0]?.gateway_mode).toBe('auto');
    expect(subnets2).toHaveLength(1);
    expect(subnets2[0]?.name).toBe('LAN 2');
    expect(subnets2[0]?.gateway_mode).toBe('none');
    qSub.finalizeSync();

    // Plain INSERT INTO custom_roles (as used by plans-repository) works and sorts by name
    const roleIns = db.prepareSync('INSERT INTO custom_roles (id, name, created_at) VALUES (?, ?, ?)');
    roleIns.executeSync(['r-2', 'Zebra', 100]);
    roleIns.executeSync(['r-1', 'Alpha', 200]);
    roleIns.finalizeSync();

    const roleSel = db.prepareSync('SELECT * FROM custom_roles ORDER BY name');
    const roles = roleSel.executeSync().getAllSync() as { name: string }[];
    expect(roles.map((r) => r.name)).toEqual(['Alpha', 'Zebra']);
    roleSel.finalizeSync();

    // Delete plan 1 cascades only plan 1's subnets
    const delPlan = db.prepareSync('DELETE FROM network_plans WHERE id = ?');
    delPlan.executeSync(['plan-web-1']);
    delPlan.finalizeSync();

    const checkSub = db.prepareSync('SELECT * FROM subnets WHERE plan_id = ? ORDER BY sort_order');
    expect(checkSub.executeSync(['plan-web-1']).getAllSync()).toHaveLength(0);
    expect(checkSub.executeSync(['plan-web-2']).getAllSync()).toHaveLength(1);
    checkSub.finalizeSync();

    // Clean up
    db.closeSync();
  });

  it('supports UPDATE, unfiltered SELECT, PRAGMA/CREATE, DELETE custom_roles, runSync/getSync, and localStorage persistence', () => {
    const store = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).localStorage = fakeLocalStorage;

    try {
      const db = createWebFallbackDatabase();
      db.execSync('PRAGMA foreign_keys = ON');
      db.execSync('CREATE TABLE IF NOT EXISTS noop (id TEXT)');
      expect(db.prepareSync('SELECT 1 FROM network_plans WHERE id = ?').executeSync(['missing']).getFirstSync()).toBeNull();
      expect((db.prepareSync('PRAGMA user_version') as unknown as { getSync: () => { user_version: number } }).getSync().user_version).toBe(SCHEMA_VERSION);

      // Insert + update plan via runSync
      (db.prepareSync(
        'INSERT INTO network_plans (id, name, description, parent_cidr, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ) as unknown as { runSync: (p: (string | number | null)[]) => void }).runSync([
        'p1',
        'Initial',
        '',
        '10.0.0.0/16',
        'custom',
        1,
        1,
      ]);
      db.prepareSync(
        'UPDATE network_plans SET name = ?, description = ?, parent_cidr = ?, profile = ?, updated_at = ? WHERE id = ?',
      ).executeSync(['Renamed', 'desc', '10.1.0.0/16', 'personal', 2, 'p1']);
      expect(db.prepareSync('SELECT 1 FROM network_plans WHERE id = ?').executeSync(['p1']).getFirstSync()).toEqual({ '1': 1 });

      // Legacy 13-col INSERT INTO subnets without gateway_mode + unfiltered SELECT
      db.prepareSync(
        'INSERT INTO subnets (id, plan_id, name, role, custom_role_label, vlan_id, network_address, cidr, mask, gateway, requested_hosts, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).executeSync(['s1', 'p1', 'LAN', 'LAN', null, null, '10.1.1.0', '10.1.1.0/24', '255.255.255.0', '10.1.1.1', 10, 0, 1]);
      expect(db.prepareSync('SELECT * FROM subnets ORDER BY sort_order').executeSync().getAllSync()).toHaveLength(1);

      // Custom roles insert, sort by created_at, and delete
      db.prepareSync('INSERT OR REPLACE INTO custom_roles (id, name, created_at) VALUES (?, ?, ?)').executeSync(['r1', 'RoleA', 20]);
      db.prepareSync('INSERT INTO custom_roles (id, name, created_at) VALUES (?, ?, ?)').executeSync(['r2', 'RoleB', 10]);
      expect(db.prepareSync('SELECT * FROM custom_roles ORDER BY created_at').executeSync().getAllSync()).toHaveLength(2);
      db.prepareSync('DELETE FROM custom_roles WHERE id = ?').executeSync(['r1']);
      expect(db.prepareSync('SELECT * FROM custom_roles ORDER BY name').executeSync().getAllSync()).toHaveLength(1);

      // Unrecognized SQL returns empty safely
      expect(db.prepareSync('VACUUM').executeSync().getAllSync()).toEqual([]);

      // Re-instantiate to verify localStorage hydration
      const reloaded = createWebFallbackDatabase();
      const loadedPlan = reloaded.prepareSync('SELECT * FROM network_plans WHERE id = ?').executeSync(['p1']).getFirstSync() as { name: string } | null;
      expect(loadedPlan?.name).toBe('Renamed');

      // Delete subnets by plan_id & close
      reloaded.prepareSync('DELETE FROM subnets WHERE plan_id = ?').executeSync(['p1']);
      expect(reloaded.prepareSync('SELECT * FROM subnets WHERE plan_id = ?').executeSync(['p1']).getAllSync()).toHaveLength(0);
      reloaded.closeSync();

      // Corrupt JSON in localStorage is handled gracefully
      fakeLocalStorage.setItem('netarchitect:sqlite_fallback_v1', '{bad-json');
      const recovered = createWebFallbackDatabase();
      expect(recovered.prepareSync('SELECT * FROM network_plans').executeSync().getAllSync()).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>).window;
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});
