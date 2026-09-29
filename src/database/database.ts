/**
 * Database connection and transaction helpers.
 *
 * This module is the only place that creates a database handle. The rest of
 * the app imports `openDatabase` and `withTransaction` from here.
 *
 * Why a sync API in an async React Native app:
 *
 * The persistence layer is called from Zustand actions that are themselves
 * synchronous - the store mutates immediately and the UI re-renders. Making
 * the database async would force every save/load to be a thunk, which adds
 * indirection and makes the store harder to test. `expo-sqlite` provides
 * a synchronous API (`execSync`, `prepareSync`, `withTransactionSync`) that
 * runs on the JS thread but crosses to native via JSI where SQLite actually
 * runs. On web it uses a WASM shim that is also synchronous for the caller.
 *
 * If this ever needs to be async (e.g., a very large plan that blocks the
 * frame budget), the change is local to this module - the callers already
 * treat `withTransaction` as an opaque boundary.
 */
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { runMigrations } from './migrations';

/** The singleton database handle. Initialized on first call to `openDatabase`. */
let dbHandle: SQLiteDatabase | null = null;

/**
 * Open (or return) the database handle and run migrations.
 *
 * Called once at app start (in `_layout.tsx`) and thereafter returns the
 * cached handle. `runMigrations` is idempotent: if `user_version` is already
 * at `SCHEMA_VERSION` it returns immediately.
 */
export const openDatabase = (): SQLiteDatabase => {
  if (dbHandle !== null) return dbHandle;

  // `expo-sqlite` stores the file in the app's sandboxed documents directory.
  // The filename is stable, so the same database is opened on every launch.
  dbHandle = openDatabaseSync('netarchitect.db');

  // Run migrations on every open. The cost is a few microseconds when current,
  // and the one-time DDL cost on first launch or after a version bump.
  runMigrations(dbHandle as any);

  return dbHandle;
};

/**
 * Execute a callback inside a transaction.
 *
 * The callback receives the database handle. If it throws, the transaction
 * is rolled back and the error is rethrown. If it returns, the transaction
 * is committed and the return value is propagated.
 *
 * This is the only way the app writes. Reads can use the handle directly,
 * but writes *must* go through this to guarantee atomicity of plan + subnets.
 */
export const withTransaction = <T,>(
  callback: (db: SQLiteDatabase) => T,
): T => {
  const db = openDatabase();
  let result: T;
  db.withTransactionSync(() => {
    result = callback(db);
  });
  return result!;
};

/** Reset the database to a clean state. Test-only. */
export const resetDatabase = (): void => {
  if (dbHandle === null) return;
  dbHandle.closeSync();
  dbHandle = null;
};

/**
 * Helper to run a SELECT query and return all rows.
 */
export const selectAll = <T,>(db: SQLiteDatabase, sql: string, ...params: Array<string | number | null>): T[] => {
  const stmt = db.prepareSync(sql);
  try {
    return stmt.executeSync(params).getAllSync() as T[];
  } finally {
    stmt.finalizeSync();
  }
};

/**
 * Helper to run a SELECT query and return the first row.
 */
export const selectOne = <T,>(db: SQLiteDatabase, sql: string, ...params: Array<string | number | null>): T | null => {
  const stmt = db.prepareSync(sql);
  try {
    return stmt.executeSync(params).getFirstSync() as T | null;
  } finally {
    stmt.finalizeSync();
  }
};

/**
 * Helper to run an INSERT/UPDATE/DELETE query.
 */
export const execute = (db: SQLiteDatabase, sql: string, ...params: Array<string | number | null>): void => {
  const stmt = db.prepareSync(sql);
  try {
    stmt.executeSync(params);
  } finally {
    stmt.finalizeSync();
  }
};