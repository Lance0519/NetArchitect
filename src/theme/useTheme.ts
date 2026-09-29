/**
 * Theme resolution and the bridge to NativeWind.
 *
 * ## The three moving parts, and why they must agree
 *
 *   1. `tailwind.config.js` sets `darkMode: 'class'`.
 *   2. `global.css` defines the dark token values under `:root.dark`.
 *   3. This module puts the `dark` class on the root element.
 *
 * If any one of them drifts, dark mode stops working and nothing throws. The
 * failure is that the app looks wrong and the user cannot tell you why. So the
 * mechanism lives in exactly one place, {@link applyScheme}, and the comment on
 * `:root.dark` in `global.css` points back here.
 *
 * ## Why this is not just NativeWind's `useColorScheme`
 *
 * That hook follows the *OS* setting only. The user here can choose light, dark,
 * or follow the system, and the third of those is a stored preference rather than
 * a device read. Worse, resolving `system` once at startup and freezing the result
 * would pin the app to whatever the theme happened to be at that moment, so
 * someone who switches their phone to dark at 6pm would be stuck in light until
 * they relaunched.
 *
 * So the effective scheme is a function of the stored mode and the *live* OS
 * value, recomputed whenever either changes.
 *
 * ## Known limitation: a first-frame flash is possible
 *
 * `zustand/persist` reads AsyncStorage asynchronously, so on a cold launch the
 * first frame renders under the default `'system'` mode and the stored preference
 * lands a frame or two later. A user who explicitly chose dark can see a brief
 * light frame.
 *
 * This is not fixed by gating the first render on hydration. That trades a
 * one-frame colour flash for an indefinite blank screen on a slow device, and a
 * blank screen is a much worse failure than a wrong colour for 100ms. Making it
 * go away entirely would mean reading the preference synchronously at module
 * load, which means giving up AsyncStorage for the one value that must be
 * available before anything is drawn. Accepted as a deliberate trade.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';
import { colorScheme } from 'nativewind';

import { useUiStore, type ThemeMode } from '@/store/ui-store';

export type ResolvedScheme = 'light' | 'dark';

/**
 * Collapse the user's choice and the OS setting into one scheme.
 *
 * A null or undefined OS scheme means the platform is not reporting one, which
 * happens on web in some browsers and briefly on Android during startup.
 * Defaulting to light is the conservative choice: it is what a bright
 * environment makes readable, and a one-frame flip to dark is far less
 * disorienting than a one-frame flash of a white screen at night.
 *
 * Pure and exported, so it can be reasoned about - and tested - without React.
 */
export const resolveScheme = (
  mode: ThemeMode,
  systemScheme: ColorSchemeName | undefined,
): ResolvedScheme => {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemScheme === 'dark' ? 'dark' : 'light';
};

/**
 * Tell NativeWind which scheme is active.
 *
 * Exported separately from the hook so the root layout can force an initial
 * apply before the first render, which is what removes the flash for the common
 * case where the default and the stored preference happen to agree.
 */
export const applyScheme = (scheme: ResolvedScheme): void => {
  colorScheme.set(scheme);
};

export interface Theme {
  /** What the user chose, including `system`. */
  mode: ThemeMode;
  /** What that resolves to right now. */
  scheme: ResolvedScheme;
  /** True when the resolved scheme came from the OS rather than an explicit choice. */
  followsSystem: boolean;
  setMode: (mode: ThemeMode) => void;
  /** Flip light/dark, resolving `system` first so the first tap is predictable. */
  toggle: () => void;
}

/**
 * The single source of truth for "what colour scheme is the app in right now".
 *
 * Components should read colour from class names - `bg-surface`, `text-ink` - and
 * not branch on the scheme. Branching on it is precisely how a screen ends up
 * correct in light and wrong in dark. The one legitimate use of this hook is
 * choosing between genuinely different *content*, such as a chart series palette
 * where a dark canvas needs lighter strokes.
 */
export const useTheme = (): Theme => {
  const mode = useUiStore((s) => s.themeMode);
  const setMode = useUiStore((s) => s.setThemeMode);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  // The hook, not `Appearance.getColorScheme()`. The latter is a one-time
  // snapshot, so the app would keep the scheme it started with when the OS
  // changes at sunset or the user flips it in Control Centre.
  const systemScheme = useColorScheme();

  const scheme = useMemo(() => resolveScheme(mode, systemScheme), [mode, systemScheme]);

  useEffect(() => {
    applyScheme(scheme);
  }, [scheme]);

  // `scheme` is a dependency of `toggle`, so including it is correct rather than
  // a lint appeasement: without it, tapping toggle on a device whose OS scheme
  // just changed would flip relative to the stale value.
  const toggle = useCallback(() => toggleTheme(scheme), [toggleTheme, scheme]);

  return { mode, scheme, followsSystem: mode === 'system', setMode, toggle };
};
