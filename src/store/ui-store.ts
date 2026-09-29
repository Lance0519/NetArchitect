/**
 * Persisted user interface preferences.
 *
 * ## Scope
 *
 * This store holds *preferences only* - how the user wants the app to behave.
 * It holds no plan data, no computed networking values, and nothing that could
 * be derived from the engine. Plan state belongs to the persistence layer
 * (Phase 9) and domain state to its own store; mixing them here would mean a
 * corrupt preference blob could take a saved plan with it.
 *
 * ## Why AsyncStorage
 *
 * These are small, non-critical, and worthless to compute at startup. A blob read
 * on every launch would add latency to the first frame for a colour preference.
 * AsyncStorage is the right shape: fire-and-forget writes, no schema to migrate,
 * and losing it costs nothing but a reset to defaults.
 *
 * ## `partialize`
 *
 * Zustand's `persist` would otherwise serialise the entire store, including
 * every action function. `partialize` restricts the write to the preference
 * fields, which is both smaller and means adding a transient action later
 * cannot accidentally start writing it to disk.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * How the user has chosen to resolve light vs dark.
 *
 * `system` is the default and is a first-class choice, not a fallback: it is
 * what most people want, and collapsing it into a resolved value at first launch
 * would silently freeze the app into whichever theme was active at that moment.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * How a CIDR is rendered and accepted.
 *
 * `dotted` shows the full address and prefix. `prefix` shows the network address
 * and the prefix in a monospace badge, which is what a network engineer reads.
 * This is a display preference; it never changes the parsed value, and both
 * forms round-trip through `cidrSchema` unchanged.
 */
export type CidrDisplayFormat = 'full' | 'badge';

export interface UiPreferences {
  themeMode: ThemeMode;
  cidrDisplayFormat: CidrDisplayFormat;
  /** Last plan profile used, so a returning user lands on familiar defaults. */
  lastProfile: 'custom' | 'personal' | 'enterprise';
  /**
   * Whether to show the collapsed "advanced" fields on input screens.
   * Defaults to false: a student opening the calculator should see a CIDR
   * field, not a wall of options.
   */
  showAdvancedFields: boolean;
}

interface UiActions {
  setThemeMode: (mode: ThemeMode) => void;
  /** Flip between light and dark, resolving `system` against the current scheme. */
  toggleTheme: (currentScheme: 'light' | 'dark') => void;
  setCidrDisplayFormat: (format: CidrDisplayFormat) => void;
  setLastProfile: (profile: UiPreferences['lastProfile']) => void;
  setShowAdvancedFields: (show: boolean) => void;
}

export type UiStore = UiPreferences & UiActions;

const DEFAULTS: UiPreferences = {
  themeMode: 'system',
  cidrDisplayFormat: 'full',
  lastProfile: 'custom',
  showAdvancedFields: false,
};

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setThemeMode: (themeMode) => set({ themeMode }),
      toggleTheme: (currentScheme) =>
        set({ themeMode: currentScheme === 'dark' ? 'light' : 'dark' }),
      setCidrDisplayFormat: (cidrDisplayFormat) => set({ cidrDisplayFormat }),
      setLastProfile: (lastProfile) => set({ lastProfile }),
      setShowAdvancedFields: (showAdvancedFields) => set({ showAdvancedFields }),
    }),
    {
      name: 'netarchitect.ui',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state): UiPreferences => ({
        themeMode: state.themeMode,
        cidrDisplayFormat: state.cidrDisplayFormat,
        lastProfile: state.lastProfile,
        showAdvancedFields: state.showAdvancedFields,
      }),
    },
  ),
);

/**
 * Read one preference outside React.
 *
 * Needed by the theme bootstrap, which has to apply the stored theme before the
 * first render to avoid a flash of the wrong theme. Calling a hook from a
 * module-level function is not possible, and `useUiStore.getState()` is the
 * supported escape hatch.
 */
export const readUiPreference = <K extends keyof UiPreferences>(key: K): UiPreferences[K] =>
  useUiStore.getState()[key];
