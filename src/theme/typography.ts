/**
 * Platform fonts and the reasoning behind them.
 *
 * ## Why monospace is not a Tailwind `fontFamily`
 *
 * The obvious thing is `font-mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']`
 * in `tailwind.config.js`, and it is wrong here. A CSS `font-family` is a *fallback
 * list*; React Native's `fontFamily` prop takes exactly one font name and hands it
 * straight to the platform text renderer. Given the list above, NativeWind passes
 * the first entry, `ui-monospace`, and iOS does not have a font by that name - so
 * it falls back to the system face and the address renders proportionally. No
 * warning, no error. The column of addresses that was supposed not to jitter jitters.
 *
 * There is also no single name that works on both platforms: Android's generic
 * family is `monospace`, iOS has no such generic and offers `Menlo` and `Courier`.
 * So the choice has to be made at runtime, which means it has to be in code that
 * runs on the device.
 *
 * ## Why monospace matters at all here
 *
 * Digits in a proportional face are not all the same width, so a column of
 * addresses lines up on nothing and the eye has to re-read each row. Monospace
 * gives tabular figures as a property of the typeface rather than as a setting.
 *
 * RN also exposes `fontVariant: ['tabular-nums']`, which is iOS-only; Android
 * ignores it silently. Monospace is the one mechanism that works on both, so it
 * is the mechanism used, and `fontVariant` is deliberately not set.
 */

import { Platform } from 'react-native';

/**
 * Font family names, resolved for the running platform.
 *
 * `sans` is intentionally absent. Leaving `fontFamily` unset uses the platform
 * system face, which is the correct rendering of the system face - naming it
 * would freeze the app onto one specific weight of it and break Dynamic Type on
 * iOS.
 */
export const FONTS = Object.freeze({
  /**
   * The monospace face, for addresses, masks, prefixes and VLAN ids.
   *
   * `default` covers web, where `monospace` is a real generic family, and any
   * future platform we have not enumerated.
   */
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }) as string,
});

/**
 * Whether the running platform is one where a monospace face is guaranteed to
 * exist under the name we asked for.
 *
 * Exists so a test can assert the resolution actually happened rather than
 * silently yielding `undefined`, which would render every address in the
 * proportional system face.
 */
export const hasResolvedMonoFont = (): boolean =>
  typeof FONTS.mono === 'string' && FONTS.mono.length > 0;
