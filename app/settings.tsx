/**
 * Settings.
 *
 * One of the three routes that is *complete* in this phase rather than a
 * placeholder, because everything it needs already exists: `ui-store` holds the
 * preferences, `useTheme` resolves them, and `SegmentedControl` renders a choice.
 * The alternative - stubbing the only screen whose backing code was finished -
 * would have been a strange place to draw the line.
 *
 * ## The theme control resolves `system` before showing a value
 *
 * The segmented control shows Light / Dark / System. When the user has chosen
 * `system`, the app is currently rendering in whatever the OS says, and the
 * control says `System` rather than pre-selecting `Light`. Highlighting a
 * specific theme the user did not choose is a small lie, and it makes the control
 * look broken - tapping it appears to do nothing.
 *
 * `useTheme().scheme` is still rendered, as the *effective* theme, because
 * knowing what is actually in effect is useful when a screen looks wrong.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Card, IconButton, Screen, SegmentedControl, type SegmentOption } from '@/components';
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
  const router = useRouter();
  const { mode, scheme, setMode } = useTheme();
  const cidrDisplayFormat = useUiStore((s) => s.cidrDisplayFormat);
  const setCidrDisplayFormat = useUiStore((s) => s.setCidrDisplayFormat);
  const showAdvancedFields = useUiStore((s) => s.showAdvancedFields);
  const setShowAdvancedFields = useUiStore((s) => s.setShowAdvancedFields);

  return (
    <Screen
      title="Settings"
      scroll
      width="form"
      // A native back button would sit above our own header, and this screen
      // renders its own. This is the one route that is pushed onto the stack, so
      // it is the one that needs a way back.
      footer={
        <IconButton label="Go back" onPress={() => router.back()}>
          <ChevronLeft size={20} strokeWidth={2} className="text-ink-muted" />
        </IconButton>
      }
    >
      <View className="gap-6">
        <View className="gap-3">
          <SegmentedControl
            label="Appearance"
            options={THEME_OPTIONS}
            value={mode}
            onChange={setMode}
          />
          <AppText variant="caption" tone="faint">
            {`Currently rendering in ${scheme} mode.` +
              (mode === 'system' ? ' Following the system setting.' : '')}
          </AppText>
        </View>

        <View className="gap-3">
          <SegmentedControl
            label="CIDR display"
            options={CIDR_OPTIONS}
            value={cidrDisplayFormat}
            onChange={setCidrDisplayFormat}
          />
          <AppText variant="caption" tone="faint">
            How subnets are shown in lists. Both forms parse identically; this changes
            presentation only.
          </AppText>
        </View>

        <Card>
          <View className="gap-1">
            <AppText variant="label">Advanced fields</AppText>
            <AppText variant="caption" tone="faint">
              Show collapsed options on input screens. Off by default so the common case
              stays a single field.
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

        <Card>
          <View className="gap-1">
            <AppText variant="label" tone="muted">
              About
            </AppText>
            <AppText variant="caption" tone="faint">
              NetArchitect performs static analysis of network designs you enter. It does
              not scan, test, or guarantee the security of any network, and it never
              connects to one.
            </AppText>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
