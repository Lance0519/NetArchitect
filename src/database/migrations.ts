/**
 * SQLite migrations.
 *
 * Append-only. **Never edit a shipped migration.** A v2 migration that changes
 * the schema must be a new entry with version 2, not an edit of version 1.
 * The runner applies every migration in order whose version is above the
 * current `PRAGMA user_version` and below or equal to the target.
 *
 * The schema is designed for the plan + subnet shape in `NetworkPlan` and
 * `PlannedSubnet`. Columns beyond the spec are justified inline.
 */
/** Minimal database interface for migrations - works with both node:sqlite and expo-sqlite. */
interface MigrationDatabase {
  execSync(sql: string): void;
  prepareSync(sql: string): MigrationStatement;
  withTransactionSync<T>(callback: () => T): T;
}

/** Minimal statement interface for migrations - matches both SQLiteStatement and node:sqlite StatementSync. */
interface MigrationStatement {
  getSync<T>(): T | null;
  runSync(params?: Array<string | number | null>): void;
  executeSync<T>(params?: Array<string | number | null>): { getFirstSync(): T | null; getAllSync(): T[] };
}

/** A single migration step. `up` must be a single transaction's worth of DDL. */
export interface Migration {
  readonly version: number;
  readonly up: (db: MigrationDatabase) => void;
}

/** Current schema version. Increment when adding a migration. */
export const SCHEMA_VERSION = 1;

/**
 * Migration list. Ordered, append-only, never reordered.
 *
 * Version 1: the initial schema as designed in the Phase 9 spec, plus the
 * columns production actually needs. Every addition beyond the spec is
 * annotated with why it exists.
 */
export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    up: (db) => {
      // Enable the pragmas we rely on. `journal_mode = WAL` allows concurrent
      // reads during writes, which matters on mobile. `foreign_keys = ON`
      // makes `ON DELETE CASCADE` actually fire rather than being a decorative
      // annotation.
      db.execSync('PRAGMA journal_mode = WAL');
      db.execSync('PRAGMA foreign_keys = ON');

      // network_plans - one row per saved plan.
      // Columns beyond the minimal spec:
      //   profile: the template label ("personal" | "enterprise" | "custom"),
      //            not an address - addresses are never hardcoded in a profile.
      //   updated_at: written on every save so the list can sort by recency.
      db.execSync(`
        CREATE TABLE network_plans (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          parent_cidr TEXT NOT NULL,
          profile TEXT NOT NULL DEFAULT 'custom',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // subnets - the subnets belonging to a plan.
      // Columns beyond the minimal spec:
      //   network_address: the subnet's network address as a dotted string,
      //                    to avoid recomputing it on every list render.
      //   mask: dotted subnet mask, same reason.
      //   custom_role_label: user-defined role name when role = 'CUSTOM'.
      //   requested_hosts: the host count the user designed for (utilization).
      //   sort_order: user-defined row order (the VLSM engine sorts internally
      //               by size, but the user's order decides ties and is the
      //               order the table is displayed in).
      //   ON DELETE CASCADE: deleting a plan removes its subnets atomically,
      //                      leaving zero orphans. This is enforced by the
      //                      `foreign_keys = ON` pragma above.
      db.execSync(`
        CREATE TABLE subnets (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES network_plans(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          custom_role_label TEXT,
          vlan_id INTEGER,
          network_address TEXT NOT NULL,
          cidr TEXT NOT NULL,
          mask TEXT NOT NULL,
          gateway TEXT,
          requested_hosts INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);

      // The only query that matters: all subnets for a plan, ordered by
      // sort_order. Without this index the list scan is O(N) on every load.
      db.execSync(`
        CREATE INDEX idx_subnets_plan ON subnets(plan_id)
      `);

      // custom_roles - user-defined roles that survive across sessions.
      // name is UNIQUE so two sessions can't create "Loading dock" with
      // different IDs.
      db.execSync(`
        CREATE TABLE custom_roles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        )
      `);
    },
  },
]);

/**
 * Run all pending migrations up to `SCHEMA_VERSION`.
 *
 * Reads `PRAGMA user_version`, applies each migration whose version is
 * greater than the current version, then sets `user_version` to the target.
 * Runs inside a single transaction so a partial migration leaves the database
 * in a consistent state.
 */
export const runMigrations = (db: MigrationDatabase): void => {
  const current = db.prepareSync('PRAGMA user_version').getSync() as { user_version: number } | null;
  const from = current?.user_version ?? 0;

  if (from >= SCHEMA_VERSION) return;

  // Use withTransactionSync directly since we're already in a sync context
  db.withTransactionSync(() => {
    for (const migration of MIGRATIONS) {
      if (migration.version > from && migration.version <= SCHEMA_VERSION) {
        migration.up(db);
      }
    }
    db.prepareSync(`PRAGMA user_version = ${SCHEMA_VERSION}`).runSync();
  });
};