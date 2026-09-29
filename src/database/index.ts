/**
 * Database barrel.
 *
 * The only public API from the database layer. Tests import the concrete
 * functions; UI code imports `savePlan`, `getPlan`, `listPlans`, etc.
 */
export { initRepository, listPlans, getPlan, savePlan, deletePlan, duplicatePlan } from './plans-repository';
export { listCustomRoles, saveCustomRole, deleteCustomRole } from './plans-repository';
export { openDatabase, withTransaction, resetDatabase } from './database';
export { runMigrations, SCHEMA_VERSION, MIGRATIONS } from './migrations';
export { resetRepository } from './plans-repository';