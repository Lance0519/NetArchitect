/**
 * Tab layout - the five top-level tools.
 *
 * Dark theme tab bar with vector icons, high contrast colors,
 * and safe area inset padding.
 */

import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Calculator,
  ClipboardCheck,
  LayoutList,
  Network,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';

import { useTheme } from '@/theme';

const TABS: readonly { name: string; title: string; Icon: LucideIcon }[] = [
  { name: 'index', title: 'Home', Icon: Network },
  { name: 'calculator', title: 'Tools', Icon: Calculator },
  { name: 'vlsm', title: 'VLSM', Icon: LayoutList },
  { name: 'planner', title: 'Planner', Icon: ClipboardCheck },
  { name: 'audit', title: 'Audit', Icon: ShieldCheck },
];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const isDark = scheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? '#609CFF' : '#1D4ED8',
        tabBarInactiveTintColor: isDark ? '#94A3B8' : '#64748B',
        tabBarStyle: {
          backgroundColor: isDark ? '#161922' : '#FFFFFF',
          borderTopColor: isDark ? '#242A38' : '#E2E8F0',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 56 + insets.bottom : 64 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          marginTop: 2,
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
                size={20}
                strokeWidth={focused ? 2.5 : 1.8}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
