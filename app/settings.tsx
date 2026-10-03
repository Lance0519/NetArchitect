/**
 * Settings - Redesigned.
 *
 * Clean, organized settings interface.
 * Theme, display preferences, and about information.
 *
 * Design principles:
 * - Grouped settings by category
 * - Clear descriptions
 * - Live preview of changes
 * - Consistent with app design language
 */

import { Image, View } from 'react-native';

import { AppText, Card, Screen, SegmentedControl, type SegmentOption } from '@/components';
import { useTheme } from '@/theme';
import { useUiStore, type CidrDisplayFormat, type ThemeMode } from '@/store/ui-store';

const THEME_OPTIONS: readonly SegmentOption<ThemeMode>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const CIDR_OPTIONS: readonly SegmentOption<CidrDisplayFormat>[] = [
  { value: 'full', label: 'Full' },
  { value: 'badge', label: 'Badge' },
];

export default function SettingsScreen() {
  const { mode, scheme, setMode } = useTheme();
  const cidrDisplayFormat = useUiStore((s) => s.cidrDisplayFormat);
  const setCidrDisplayFormat = useUiStore((s) => s.setCidrDisplayFormat);
  const showAdvancedFields = useUiStore((s) => s.showAdvancedFields);
  const setShowAdvancedFields = useUiStore((s) => s.setShowAdvancedFields);

  return (
    <Screen title="Settings" scroll width="form">
      <View className="gap-6">
        {/* Appearance */}
        <View className="gap-3">
          <AppText variant="label" tone="muted">
            APPEARANCE
          </AppText>
          <SegmentedControl
            label="Theme"
            options={THEME_OPTIONS}
            value={mode}
            onChange={setMode}
          />
          <AppText variant="caption" tone="faint">
            {`Currently rendering in ${scheme} mode.` +
              (mode === 'system' ? ' Following the system setting.' : '')}
          </AppText>
        </View>

        {/* Display */}
        <View className="gap-3">
          <AppText variant="label" tone="muted">
            DISPLAY
          </AppText>
          <SegmentedControl
            label="CIDR display"
            options={CIDR_OPTIONS}
            value={cidrDisplayFormat}
            onChange={setCidrDisplayFormat}
          />
          <AppText variant="caption" tone="faint">
            How subnets are shown in lists. Both forms parse identically; this changes presentation only.
          </AppText>
        </View>

        {/* Advanced */}
        <Card>
          <View className="gap-1">
            <AppText variant="label">Advanced fields</AppText>
            <AppText variant="caption" tone="faint">
              Show collapsed options on input screens. Off by default so the common case stays a single field.
            </AppText>
          </View>
          <View className="mt-3">
            <SegmentedControl
              label="Visibility"
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              value={showAdvancedFields ? 'on' : 'off'}
              onChange={(next) => setShowAdvancedFields(next === 'on')}
            />
          </View>
        </Card>

        {/* About & License */}
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <Image
              source={require('../assets/NetArchitect_Logo.png')}
              style={{ width: 44, height: 44, borderRadius: 22 }}
              resizeMode="contain"
              accessibilityLabel="NetArchitect Logo"
            />
            <View className="flex-1 gap-0.5">
              <AppText variant="subheading" tone="primary" className="font-semibold">
                NetArchitect v1.0.0
              </AppText>
              <AppText variant="caption" tone="muted">
                Offline-First IPv4 Subnet Calculator, VLSM Allocator & Security Auditor
              </AppText>
            </View>
          </View>

          <View className="gap-1 border-t border-line-subtle pt-2.5">
            <AppText variant="caption" tone="faint">
              Copyright © 2026 Justine Lance Martin (Lance0519). All Rights Reserved.
            </AppText>
            <AppText variant="caption" tone="faint">
              Proprietary software. Unauthorized copying, distribution, or modification is prohibited.
            </AppText>
            <AppText variant="caption" tone="faint" className="mt-1">
              NetArchitect performs local static analysis. It does not scan, test, or connect to any network.
            </AppText>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
