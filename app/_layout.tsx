/**
 * Root layout.
 *
 * The order of these providers is load-bearing, not stylistic.
 *
 * ```
 * SafeAreaProvider          outermost - every other component reads insets from it
 *   ThemeSync               applies the colour scheme before anything paints
 *     StatusBar             needs the resolved scheme to pick a legible style
 *       Stack               needs StatusBar so headers do not sit under it
 *         ...routes
 * ```
 *
 * ## The `global.css` import is mandatory
 *
 * `import '../global.css'` is the line that makes NativeWind work, and it is the
 * line whose absence fails silently. Without it Metro never compiles the
 * stylesheet: the build succeeds, `metro.config.js` never complains, and every
 * `className` in the app quietly does nothing. The app renders unstyled and
 * nothing anywhere reports a problem. It must be a side-effect-only import - no
 * binding, no use.
 *
 * ## Why there is no database provider yet
 *
 * The plan puts `SQLiteProvider` here, and it will arrive with the persistence
 * layer (Phase 9) along with the migrations it has to run. Adding it now with an
 * empty migration set would mean shipping an untested database bootstrap that
 * exists only to be modified, and - worse - a schema-less database file on a
 * user's device from the very first launch. Deferred deliberately; see the
 * Phase 5 notes in PLAN.md.
 */

import '../global.css';
import '@/theme/icons';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ErrorBoundaryProps } from 'expo-router';

import { ErrorBoundary as AppErrorBoundary, ErrorFallback, SnackbarHost } from '@/components';
import { useTheme } from '@/theme';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorFallback error={error} resetErrorBoundary={retry} />;
}

/**
 * Applies the resolved colour scheme to NativeWind and renders the root Stack
 * with a native-compatible canvas background colour (CSS `var()` strings are
 * not understood by React Native's native Stack `contentStyle`).
 */
function RootNavigator() {
  const { scheme } = useTheme();
  const canvasColor = scheme === 'dark' ? '#0A0C10' : '#F6F7FA';

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AppErrorBoundary>
        <Stack
          screenOptions={{
            // Each screen renders its own heading via `Screen`, so the native header
            // is off. Two headers on one screen is a layout bug, and having the
            // native one appear conditionally per platform is worse.
            headerShown: false,
            contentStyle: { backgroundColor: canvasColor },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="learning" options={{ presentation: 'card' }} />
          <Stack.Screen name="plans" options={{ presentation: 'card' }} />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
        </Stack>
      </AppErrorBoundary>
      <SnackbarHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}
