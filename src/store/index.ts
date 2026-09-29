/**
 * Store barrel.
 *
 * Route files import from here. The three stores have distinct lifecycles:
 *
 *   `useUiStore`       - preferences, persisted to AsyncStorage, survives app restart
 *   `usePlanStore`     - the working draft + one pending change, ephemeral
 *   `useNetworkStore`  - load/save operations against the SQLite repository
 *   `useVlsmStore`     - VLSM draft + hand-off, ephemeral
 */
export { useUiStore, readUiPreference, type ThemeMode, type CidrDisplayFormat } from './ui-store';
export { usePlanStore, selectRows, selectHasPending, freshDraft, blankDraft, type PlanStore, type PlanActions, type PendingChange } from './plan-store';
export { useNetworkStore, type NetworkStore, type NetworkActions } from './network-store';
export { useVlsmStore, type VlsmStore, type PlanHandoff } from './vlsm-store';