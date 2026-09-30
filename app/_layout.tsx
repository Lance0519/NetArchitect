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
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ErrorBoundaryProps } from 'expo-router';

import { ErrorBoundary as AppErrorBoundary, ErrorFallback } from '@/components';
import { useTheme } from '@/theme';

// Suppress floating warning overlay over bottom navigation bar in dev
LogBox.ignoreAllLogs();

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorFallback error={error} resetErrorBoundary={retry} />;
}

/**
 * Applies the resolved colour scheme to NativeWind.
 *
 * Renders nothing. It exists as a component because the scheme has to come from a
 * hook - it depends on both the stored preference and the live OS setting - and a
 * hook cannot be called at module scope. Mounting it once here means the scheme
 * is applied before any screen renders.
 */
function ThemeSync() {
  const { scheme } = useTheme();
  // Light content on a light status bar is unreadable. The bar background itself
  // is transparent on both platforms, so the *style* is the only thing that needs
  // to track the theme.
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeSync />
      <AppErrorBoundary>
        <Stack
          screenOptions={{
            // Each screen renders its own heading via `Screen`, so the native header
            // is off. Two headers on one screen is a layout bug, and having the
            // native one appear conditionally per platform is worse.
            headerShown: false,
            contentStyle: { backgroundColor: 'rgb(var(--bg-canvas))' },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="learning" options={{ presentation: 'card' }} />
          <Stack.Screen name="plans" options={{ presentation: 'card' }} />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
        </Stack>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
