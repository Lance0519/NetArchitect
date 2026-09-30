/**
 * Web fallback database.
 *
 * When running in a web browser without SharedArrayBuffer (e.g. absent COOP/COEP
 * headers or unsupported browser context), `expo-sqlite`'s `openDatabaseSync` throws
 * `ReferenceError: SharedArrayBuffer is not defined`.
 *
 * This fallback provides a fully functional, SQLite-compatible storage interface
 * backed by in-memory state and localStorage (when available), allowing the web app
 * to load and save plans and custom roles without crashing.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

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

const STORAGE_KEY = 'netarchitect:sqlite_fallback_v1';

class WebFallbackStorage {
  private plans = new Map<string, PlanRow>();
  private subnets = new Map<string, SubnetRow>();
  private customRoles = new Map<string, CustomRoleRow>();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.plans)) {
        for (const p of data.plans) this.plans.set(p.id, p);
      }
      if (Array.isArray(data.subnets)) {
        for (const s of data.subnets) this.subnets.set(s.id, s);
      }
      if (Array.isArray(data.customRoles)) {
        for (const r of data.customRoles) this.customRoles.set(r.id, r);
      }
    } catch (e) {
      console.warn('Failed to load NetArchitect local web storage:', e);
    }
  }

  private persist(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      const data = {
        plans: Array.from(this.plans.values()),
        subnets: Array.from(this.subnets.values()),
        customRoles: Array.from(this.customRoles.values()),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to persist NetArchitect local web storage:', e);
    }
  }

  clear(): void {
    this.plans.clear();
    this.subnets.clear();
    this.customRoles.clear();
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  execute(sql: string, params: (string | number | null)[] = []): any[] {
    const s = sql.trim().replace(/\s+/g, ' ');

    if (/^PRAGMA user_version/i.test(s)) {
      return [{ user_version: 1 }];
    }

    if (/^PRAGMA/i.test(s) || /^CREATE/i.test(s)) {
      return [];
    }

    // SELECT * FROM network_plans WHERE id = ?
    if (/^SELECT \* FROM network_plans WHERE id = \?/i.test(s)) {
      const id = String(params[0]);
      const plan = this.plans.get(id);
      return plan ? [plan] : [];
    }

    // SELECT 1 FROM network_plans WHERE id = ?
    if (/^SELECT 1 FROM network_plans WHERE id = \?/i.test(s)) {
      const id = String(params[0]);
      return this.plans.has(id) ? [{ '1': 1 }] : [];
    }

    // SELECT * FROM network_plans ORDER BY updated_at DESC
    if (/^SELECT \* FROM network_plans/i.test(s)) {
      const list = Array.from(this.plans.values());
      list.sort((a, b) => b.updated_at - a.updated_at);
      return list;
    }

    // SELECT * FROM subnets WHERE plan_id = ? ORDER BY sort_order
    if (/^SELECT \* FROM subnets WHERE plan_id = \?/i.test(s)) {
      const planId = String(params[0]);
      const list = Array.from(this.subnets.values()).filter((s) => s.plan_id === planId);
      list.sort((a, b) => a.sort_order - b.sort_order);
      return list;
    }

    // SELECT * FROM subnets ORDER BY sort_order
    if (/^SELECT \* FROM subnets/i.test(s)) {
      const list = Array.from(this.subnets.values());
      list.sort((a, b) => a.sort_order - b.sort_order);
      return list;
    }

    // SELECT * FROM custom_roles ORDER BY created_at
    if (/^SELECT \* FROM custom_roles/i.test(s)) {
      const list = Array.from(this.customRoles.values());
      list.sort((a, b) => a.created_at - b.created_at);
      return list;
    }

    // UPDATE network_plans SET name = ?, description = ?, parent_cidr = ?, profile = ?, updated_at = ? WHERE id = ?
    if (/^UPDATE network_plans/i.test(s)) {
      const id = String(params[5]);
      const existing = this.plans.get(id);
      if (existing) {
        this.plans.set(id, {
          ...existing,
          name: String(params[0]),
          description: String(params[1]),
          parent_cidr: String(params[2]),
          profile: String(params[3]),
          updated_at: Number(params[4]),
        });
        this.persist();
      }
      return [];
    }

    // INSERT INTO network_plans (id, name, description, parent_cidr, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    if (/^INSERT INTO network_plans/i.test(s)) {
      const row: PlanRow = {
        id: String(params[0]),
        name: String(params[1]),
        description: String(params[2]),
        parent_cidr: String(params[3]),
        profile: String(params[4]),
        created_at: Number(params[5]),
        updated_at: Number(params[6]),
      };
      this.plans.set(row.id, row);
      this.persist();
      return [];
    }

    // DELETE FROM subnets WHERE plan_id = ?
    if (/^DELETE FROM subnets WHERE plan_id = \?/i.test(s)) {
      const planId = String(params[0]);
      for (const [id, subnet] of this.subnets.entries()) {
        if (subnet.plan_id === planId) {
          this.subnets.delete(id);
        }
      }
      this.persist();
      return [];
    }

    // INSERT INTO subnets
    if (/^INSERT INTO subnets/i.test(s)) {
      const row: SubnetRow = {
        id: String(params[0]),
        plan_id: String(params[1]),
        name: String(params[2]),
        role: String(params[3]),
        custom_role_label: params[4] !== null ? String(params[4]) : null,
        vlan_id: params[5] !== null ? Number(params[5]) : null,
        network_address: String(params[6]),
        cidr: String(params[7]),
        mask: String(params[8]),
        gateway: params[9] !== null ? String(params[9]) : null,
        requested_hosts: Number(params[10]),
        sort_order: Number(params[11]),
        created_at: Number(params[12]),
      };
      this.subnets.set(row.id, row);
      this.persist();
      return [];
    }

    // DELETE FROM network_plans WHERE id = ?
    if (/^DELETE FROM network_plans WHERE id = \?/i.test(s)) {
      const id = String(params[0]);
      this.plans.delete(id);
      for (const [subId, subnet] of this.subnets.entries()) {
        if (subnet.plan_id === id) {
          this.subnets.delete(subId);
        }
      }
      this.persist();
      return [];
    }

    // INSERT OR REPLACE INTO custom_roles
    if (/^INSERT OR REPLACE INTO custom_roles/i.test(s)) {
      const row: CustomRoleRow = {
        id: String(params[0]),
        name: String(params[1]),
        created_at: Number(params[2]),
      };
      this.customRoles.set(row.id, row);
      this.persist();
      return [];
    }

    // DELETE FROM custom_roles WHERE id = ?
    if (/^DELETE FROM custom_roles WHERE id = \?/i.test(s)) {
      const id = String(params[0]);
      this.customRoles.delete(id);
      this.persist();
      return [];
    }

    return [];
  }
}

export function createWebFallbackDatabase(): SQLiteDatabase {
  const store = new WebFallbackStorage();

  const fakeDb = {
    execSync(sql: string): void {
      store.execute(sql);
    },
    withTransactionSync<T>(callback: () => T): T {
      return callback();
    },
    closeSync(): void {
      store.clear();
    },
    prepareSync(sql: string) {
      return {
        runSync(params: (string | number | null)[] = []): void {
          store.execute(sql, params);
        },
        getSync<T>(): T | null {
          const rows = store.execute(sql);
          return (rows[0] as T) ?? null;
        },
        executeSync<T>(params: (string | number | null)[] = []) {
          const rows = store.execute(sql, params);
          return {
            getFirstSync(): T | null {
              return (rows[0] as T) ?? null;
            },
            getAllSync(): T[] {
              return rows as T[];
            },
          };
        },
        finalizeSync(): void {
          // no-op
        },
      };
    },
  };

  return fakeDb as unknown as SQLiteDatabase;
}
