/**
 * Home.
 *
 * The first screen, so it has one job: say what the app is, and get the user to
 * the tool they came for. It deliberately shows no sample plans and no example
 * subnets.
 *
 * That is a considered choice. A "recent plans" list populated with plausible
 * looking entries - `10.0.0.0/22`, "Branch Office", 12 subnets - is the most
 * tempting thing to put here, and it is a lie in an app whose entire value is
 * that its numbers are real. Every figure on this screen is either text written
 * by hand or a value read from `standards.ts`. Nothing is illustrative, because
 * anything illustrative would be indistinguishable from a real result to anyone
 * glancing at the screen, and would eventually be mistaken for one.
 *
 * ## No networking values here
 *
 * The plan's exit criterion for this phase includes a check that no route file
 * computes a networking value. This screen does not import the engine at all,
 * which makes that check trivially true for it.
 */

import { useRouter } from 'expo-router';
import {
  Calculator,
  ClipboardCheck,
  LayoutList,
  Network,
  ShieldCheck,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Banner, Card, Divider, ListRow, Screen } from '@/components';
import { STANDARD_REFS } from '@/core/standards';
import { useNetworkStore } from '@/store/network-store';

interface ToolEntry {
  readonly route: '/(tabs)/calculator' | '/(tabs)/vlsm' | '/(tabs)/planner' | '/(tabs)/audit';
  readonly title: string;
  readonly description: string;
  readonly Icon: LucideIcon;
}

const TOOLS: readonly ToolEntry[] = [
  {
    route: '/(tabs)/calculator',
    title: 'IP Calculator',
    description: 'Network, broadcast, masks, host range and usable count for any CIDR.',
    Icon: Calculator,
  },
  {
    route: '/(tabs)/vlsm',
    title: 'VLSM Allocator',
    description: 'Fit variable-length subnets into a parent block without overlap.',
    Icon: LayoutList,
  },
  {
    route: '/(tabs)/planner',
    title: 'Network Planner',
    description: 'Describe a site and its requirements, and get a full allocation plan.',
    Icon: ClipboardCheck,
  },
  {
    route: '/(tabs)/audit',
    title: 'Security Audit',
    description: 'Static design review of a plan, with every rule cited to a standard.',
    Icon: ShieldCheck,
  },
];

/** The standards this app's output is attributed to. Real, from standards.ts. */
const KEY_STANDARDS = [
  { ref: STANDARD_REFS.RFC1918, subject: 'Private address space' },
  { ref: STANDARD_REFS.RFC3021, subject: '/31 point-to-point links' },
  { ref: STANDARD_REFS.RFC4632, subject: 'CIDR' },
  { ref: STANDARD_REFS.IEEE8021Q, subject: 'VLAN tagging' },
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { listPlans } = useNetworkStore();
  const recentPlans = listPlans().slice(0, 5);
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const formatRelative = (ts: number): string => {
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <Screen title="NetArchitect" subtitle="IPv4 subnetting, VLSM and network design." scroll>
      <View className="gap-4">
        <Card padding="lg">
          <View className="gap-2">
            <AppText variant="heading">Works entirely offline</AppText>
            <AppText variant="body" tone="muted">
              Every calculation runs on this device. There is no account, no server and no
              telemetry. Your plans are stored locally and never leave the device.
            </AppText>
          </View>
        </Card>

        <View className="gap-2">
          <AppText variant="label" tone="faint">TOOLS</AppText>
          <Card padding="none" className="overflow-hidden">
            {TOOLS.map((tool, index) => (
              <View key={tool.route}>
                {index > 0 ? <Divider inset="pl-4" /> : null}
                <ListRow
                  title={tool.title}
                  description={tool.description}
                  onPress={() => router.push(tool.route)}
                />
              </View>
            ))}
          </Card>
        </View>

        {recentPlans.length > 0 ? (
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <AppText variant="label" tone="faint">RECENT PLANS</AppText>
              <AppText variant="caption" tone="faint" onPress={() => router.push('/plans')}>
                View all
              </AppText>
            </View>
            <Card padding="none" className="overflow-hidden">
              {recentPlans.map((plan, index) => (
                <View key={plan.id}>
                  {index > 0 ? <Divider inset="pl-4" /> : null}
                  <ListRow
                    title={plan.name}
                    description={`${plan.subnets.length} subnets · ${plan.parentCidr} · ${formatRelative(plan.updatedAt)}`}
                    onPress={() => { router.push('/plans/' + plan.id as any); }}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View className="gap-2">
          <AppText variant="label" tone="faint">REFERENCE</AppText>
          <Card padding="lg">
            <View className="gap-3">
              <AppText variant="body" tone="muted">
                Results are attributed to the standard that defines them, so a
                recommendation can be checked rather than taken on trust.
              </AppText>
              <Divider />
              {KEY_STANDARDS.map((entry) => (
                <View key={entry.ref} className="flex-row items-baseline gap-3">
                  <AppText mono variant="caption" tone="accent" className="w-32 shrink-0">
                    {entry.ref}
                  </AppText>
                  <AppText variant="caption" tone="muted" className="flex-1">
                    {entry.subject}
                  </AppText>
                </View>
              ))}
            </View>
          </Card>
        </View>

        <View className="gap-2">
          <AppText variant="label" tone="faint">MORE</AppText>
          <Card padding="none" className="overflow-hidden">
            <ListRow
              title="Saved plans"
              description="Plans you have created, stored on this device."
              onPress={() => router.push('/plans')}
            />
            <Divider inset="pl-4" />
            <ListRow
              title="Learn the standards"
              description="What each RFC actually requires, and why it matters."
              onPress={() => router.push('/learning')}
            />
            <Divider inset="pl-4" />
            <ListRow
              title="Settings"
              description="Appearance and input preferences."
              onPress={() => router.push('/settings')}
            />
          </Card>
        </View>

        <Banner tone="info" title="Static analysis only">
          <View className="mt-1 flex-row items-center gap-1.5">
            <WifiOff size={13} strokeWidth={2.5} className="text-info" accessibilityElementsHidden />
            <AppText variant="caption" tone="muted">
              NetArchitect never connects to, scans or configures a network. It analyses the
              design you enter.
            </AppText>
          </View>
        </Banner>

        <View className="items-center py-2">
          <Network size={20} strokeWidth={1.5} className="text-ink-faint" accessibilityElementsHidden />
        </View>
      </View>
    </Screen>
  );
}