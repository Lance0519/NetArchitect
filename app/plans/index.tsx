/**
 * Saved Plans - Redesigned.
 *
 * Project files view for managing saved network plans.
 * Shows plan cards with name, parent network, subnet count, and last modified.
 *
 * Design principles:
 * - Project files metaphor: cards, not table rows
 * - Clear status indicators
 * - Easy management: open, rename, duplicate, delete
 * - Confirmation for destructive actions
 */

import { useCallback, useEffect, useState } from 'react';
import { View, TextInput } from 'react-native';
import { Plus, Search } from 'lucide-react-native';

import { useRouter } from 'expo-router';

import { AppText, Card, EmptyState, Screen, Snackbar, useSnackbar } from '@/components';
import { Button } from '@/components/ui/Button';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { useTheme } from '@/theme';
import { useNetworkStore } from '@/store/network-store';

import type { NetworkPlan } from '@/types/network';

const SEARCH_DEBOUNCE_MS = 150;

export default function PlansListScreen() {
  const router = useRouter();
  const { scheme } = useTheme();
  const { listPlans } = useNetworkStore();
  const { snackbars } = useSnackbar();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const plans = useCallback(() => {
    const all = listPlans();
    if (!debouncedQuery.trim()) return all;
    const q = debouncedQuery.toLowerCase();
    return all.filter((p) => p.name.toLowerCase().includes(q));
  }, [listPlans, debouncedQuery]);

  return (
    <Screen title="My Network Plans" subtitle={`${plans().length} plan${plans().length === 1 ? '' : 's'} stored on this device.`} scroll>
      <View className="gap-4">
        {/* Search */}
        <Card padding="md" className="flex-row items-center gap-3">
          <Search size={20} strokeWidth={2} className="text-ink-muted shrink-0" />
          <TextInput
            placeholder="Search by name..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="flex-1 text-ink"
            placeholderTextColor={scheme === 'dark' ? '#94A3B8' : '#64748B'}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            clearButtonMode="while-editing"
          />
        </Card>

        {/* Plans List */}
        {plans().length === 0 ? (
          <EmptyState
            icon={Plus}
            title={debouncedQuery ? 'No matching plans' : 'No plans yet'}
            description={debouncedQuery
              ? 'Try a different search term, or create a new plan.'
              : 'Create your first plan in the Network Planner, then save it here.'}
            action={
              <Button
                variant="primary"
                size="sm"
                onPress={() => router.push('/planner')}
              >
                Create Network Plan
              </Button>
            }
          />
        ) : (
          <View className="gap-2">
            {plans().map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onPress={() => router.push(`/plans/${plan.id}`)}
              />
            ))}
          </View>
        )}

        <View className="py-4">
          <AppText variant="caption" tone="faint" className="text-center">
            Plans are stored locally on this device. NetArchitect never connects to a network.
          </AppText>
        </View>
      </View>

      {/* Snackbars */}
      <View className="absolute bottom-4 left-4 right-4 z-50 flex-col items-center gap-2 pointer-events-none">
        {snackbars.map((sb) => (
          <Snackbar
            key={sb.id}
            message={sb.message}
            actionLabel={sb.actionLabel}
            onAction={sb.onAction}
            duration={sb.duration}
          />
        ))}
      </View>
    </Screen>
  );
}

function PlanCard({
  plan,
  onPress,
}: {
  readonly plan: NetworkPlan;
  readonly onPress: () => void;
}) {
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
    <Card padding="md">
      <Button
        variant="ghost"
        block
        onPress={onPress}
        className="flex-row items-center gap-3 p-0"
        icon={null}
      >
        <View className="flex-1 gap-1">
          <AppText variant="subheading" tone="primary" numberOfLines={1}>
            {plan.name}
          </AppText>
          <AppText variant="caption" tone="muted">
            {plan.parentCidr} · {plan.subnets.length} subnet{plan.subnets.length === 1 ? '' : 's'}
          </AppText>
          <View className="flex-row items-center gap-2">
            <StatusIndicator label={formatRelative(plan.updatedAt)} tone="neutral" />
          </View>
        </View>
      </Button>
    </Card>
  );
}
