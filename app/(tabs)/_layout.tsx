/**
 * Tab layout - the five top-level tools.
 *
 * ## Why the fifth tab is "Audit" and not "Settings"
 *
 * The five are the things a user came here to *do*. Settings, Plans and Learning
 * are reachable but are not primary, so they live in the stack rather than
 * consuming a fifth of the screen on a phone. A tab bar is a statement about what
 * the app is; spending one of five slots on preferences misstates that.
 *
 * ## Labels, not icons alone
 *
 * Every tab has a visible label. An icon-only tab bar is a guessing game for
 * anyone who has not used the app before, and unreadable for a screen reader,
 * which is why this one is a deliberate departure from most mobile apps.
 *
 * ## Five tabs is the ceiling
 *
 * Material Design and the iOS HIG both put the practical limit at five on a
 * phone. Six would mean labels truncating to nothing on a small screen, which is
 * the point at which icons become necessary and the guessing game starts again.
 */

import { Tabs } from 'expo-router';
import {
  Calculator,
  ClipboardCheck,
  LayoutList,
  Network,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * Tab bar config, one entry per route.
 *
 * The `href` strings are checked by Expo Router's generated types once
 * `expo start` has generated `.expo/types/router.d.ts`, so a renamed or misspelled
 * route becomes a compile error rather than a blank screen.
 */
const TABS: readonly { name: string; title: string; Icon: LucideIcon }[] = [
  { name: 'index', title: 'Home', Icon: Network },
  { name: 'calculator', title: 'Calculator', Icon: Calculator },
  { name: 'vlsm', title: 'VLSM', Icon: LayoutList },
  { name: 'planner', title: 'Planner', Icon: ClipboardCheck },
  { name: 'audit', title: 'Audit', Icon: ShieldCheck },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // `rgb(var(--token))` rather than a literal, so the bar follows the theme
        // automatically. A hard-coded `#ffffff` here is the single most common way
        // a NativeWind app ends up with an unreadable tab bar in dark mode.
        tabBarActiveTintColor: 'rgb(var(--accent-base))',
        tabBarInactiveTintColor: 'rgb(var(--text-secondary))',
        tabBarStyle: {
          backgroundColor: 'rgb(var(--bg-surface))',
          borderTopColor: 'rgb(var(--border-subtle))',
        },
      }}
    >
      {TABS.map(({ name, title, Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <Icon
                size={22}
                strokeWidth={focused ? 2.4 : 1.9}
                color={color}
                // The tab's own accessibility label comes from `title`, so the
                // icon must not be announced as a second, redundant element.
                accessibilityElementsHidden
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
