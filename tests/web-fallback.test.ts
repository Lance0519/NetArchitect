import { describe, expect, it } from 'vitest';
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
    expect(versionRow?.user_version).toBe(1);
    stmt.finalizeSync();

    // Insert a plan
    const insertStmt = db.prepareSync(`
      INSERT INTO network_plans (id, name, description, parent_cidr, profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.executeSync(['plan-web-1', 'Web Plan', 'Test plan', '10.0.0.0/16', 'custom', 100, 100]);
    insertStmt.finalizeSync();

    // Query plan by id
    const selectStmt = db.prepareSync('SELECT * FROM network_plans WHERE id = ?');
    const plan = selectStmt.executeSync(['plan-web-1']).getFirstSync() as any;
    expect(plan).toBeDefined();
    expect(plan.id).toBe('plan-web-1');
    expect(plan.name).toBe('Web Plan');
    selectStmt.finalizeSync();

    // Query all plans
    const allStmt = db.prepareSync('SELECT * FROM network_plans ORDER BY updated_at DESC');
    const allPlans = allStmt.executeSync().getAllSync() as any[];
    expect(allPlans).toHaveLength(1);
    allStmt.finalizeSync();

    // Insert subnets
    const subStmt = db.prepareSync(`
      INSERT INTO subnets (id, plan_id, name, role, custom_role_label, vlan_id, network_address, cidr, mask, gateway, requested_hosts, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    subStmt.executeSync([
      'sub-web-1',
      'plan-web-1',
      'LAN 1',
      'LAN',
      null,
      10,
      '10.0.1.0',
      '10.0.1.0/24',
      '255.255.255.0',
      '10.0.1.1',
      100,
      0,
      100,
    ]);
    subStmt.finalizeSync();

    // Query subnets by plan_id
    const qSub = db.prepareSync('SELECT * FROM subnets WHERE plan_id = ? ORDER BY sort_order');
    const subnets = qSub.executeSync(['plan-web-1']).getAllSync() as any[];
    expect(subnets).toHaveLength(1);
    expect(subnets[0].name).toBe('LAN 1');
    qSub.finalizeSync();

    // Delete subnets and plan
    const delSub = db.prepareSync('DELETE FROM subnets WHERE plan_id = ?');
    delSub.executeSync(['plan-web-1']);
    delSub.finalizeSync();

    const checkSub = db.prepareSync('SELECT * FROM subnets WHERE plan_id = ? ORDER BY sort_order');
    expect(checkSub.executeSync(['plan-web-1']).getAllSync()).toHaveLength(0);
    checkSub.finalizeSync();

    // Clean up
    db.closeSync();
  });
});
