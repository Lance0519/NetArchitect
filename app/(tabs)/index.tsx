/**
 * Home - Network Operations Dashboard.
 *
 * Professional network operations dashboard displaying:
 * - Active project summary with live network metrics
 * - Quick Subnet Reference for immediate CIDR lookup & conversion
 * - Security & compliance status directly citing CIS/NIST standards
 * - Recent network plans and quick actions
 */

import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Calculator,
  ChevronRight,
  Network,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
  Plus,
  BookOpen,
  Settings as SettingsIcon,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText, Card, Screen, StatusIndicator } from '@/components';
import { NetworkStat } from '@/components/network';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { auditPlan } from '@/core/security-auditor';
import { useNetworkStore } from '@/store/network-store';
import type { NetworkPlan } from '@/types/network';

const QUICK_REFERENCE = [
  { prefix: '/24', hosts: '254 hosts', mask: '255.255.255.0', use: 'Standard LAN' },
  { prefix: '/26', hosts: '62 hosts', mask: '255.255.255.192', use: 'Branch Dept' },
  { prefix: '/28', hosts: '14 hosts', mask: '255.255.255.240', use: 'Small Cluster' },
  { prefix: '/30', hosts: '2 hosts', mask: '255.255.255.252', use: 'Point-to-Point' },
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { listPlans } = useNetworkStore();
  const [allPlans, setAllPlans] = useState<readonly NetworkPlan[]>(() => listPlans());

  useFocusEffect(
    useCallback(() => {
      setAllPlans(listPlans());
    }, [listPlans]),
  );

  const recentPlans = allPlans.slice(0, 3);
  const activePlan = recentPlans[0] ?? null;

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

  const auditIssues = activePlan ? auditPlan(activePlan) : [];

  const criticalCount = auditIssues.filter(
    (i) => i.severity === 'critical' || i.severity === 'high',
  ).length;

  const totalRequestedHosts = activePlan
    ? activePlan.subnets.reduce((acc, s) => acc + (s.requestedHosts || 0), 0)
    : 0;

  return (
    <Screen title="NetArchitect" subtitle="Network Planning Assistant" scroll>
      <View className="gap-4">
        {/* Offline indicator */}
        <View className="flex-row items-center justify-between">
          <StatusIndicator label="Works entirely offline" tone="success" />
          <WifiOff size={14} strokeWidth={2} className="text-ink-faint" accessibilityElementsHidden />
        </View>

        {/* Active Project Summary */}
        {activePlan ? (
          <Card padding="lg" className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Network size={18} strokeWidth={2} className="text-accent" />
                <AppText variant="label" tone="muted">
                  ACTIVE PLAN
                </AppText>
              </View>
              <AppText variant="caption" tone="faint">
                {formatRelative(activePlan.updatedAt)}
              </AppText>
            </View>

            <View className="gap-1">
              <AppText variant="title" tone="primary">
                {activePlan.name}
              </AppText>
              <AppText mono variant="subheading" tone="accent">
                {activePlan.parentCidr}
              </AppText>
            </View>

            <View className="flex-row flex-wrap gap-4 pt-1">
              <NetworkStat label="Subnets" value={String(activePlan.subnets.length)} />
              <NetworkStat label="Allocated Hosts" value={String(totalRequestedHosts)} />
              <NetworkStat
                label="Security Issues"
                value={String(auditIssues.length)}
                tone={criticalCount > 0 ? 'critical' : auditIssues.length > 0 ? 'medium' : 'success'}
              />
            </View>

            <View className="flex-row gap-2 pt-2 border-t border-line-subtle">
              <Button
                variant="secondary"
                size="sm"
                block
                onPress={() => router.push(`/plans/${activePlan.id}` as any)}
              >
                Open Plan
              </Button>
              <Button
                variant="secondary"
                size="sm"
                block
                onPress={() => router.push('/(tabs)/audit')}
              >
                Audit
              </Button>
            </View>
          </Card>
        ) : (
          <Card padding="lg" className="gap-3">
            <View className="flex-row items-center gap-2">
              <Network size={18} strokeWidth={2} className="text-accent" />
              <AppText variant="label" tone="muted">
                GETTING STARTED
              </AppText>
            </View>
            <AppText variant="title" tone="primary">
              Design Your First Network
            </AppText>
            <AppText variant="caption" tone="muted">
              Create subnets, allocate address space, and perform static security audits completely offline.
            </AppText>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={16} strokeWidth={2} />}
              onPress={() => router.push('/(tabs)/planner')}
            >
              Create Network Plan
            </Button>
          </Card>
        )}

        {/* Quick Subnet Reference */}
        <Card padding="lg" className="gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Calculator size={18} strokeWidth={2} className="text-accent" />
              <AppText variant="label" tone="muted">
                QUICK SUBNET REFERENCE
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open IP Calculator"
              onPress={() => router.push('/(tabs)/calculator')}
            >
              <AppText variant="caption" tone="accent">
                Open Calculator
              </AppText>
            </Pressable>
          </View>

          <View className="gap-2">
            {QUICK_REFERENCE.map((ref) => (
              <Pressable
                key={ref.prefix}
                accessibilityRole="button"
                accessibilityLabel={`${ref.prefix} - ${ref.hosts} - ${ref.mask}`}
                onPress={() => router.push('/(tabs)/calculator')}
                className="flex-row items-center justify-between rounded-control border border-line-subtle bg-surface-raised px-3 py-2 active:bg-surface"
              >
                <View className="flex-row items-center gap-3">
                  <AppText mono variant="subheading" tone="accent">
                    {ref.prefix}
                  </AppText>
                  <AppText variant="caption" tone="primary">
                    {ref.hosts}
                  </AppText>
                </View>
                <View className="flex-row items-center gap-2">
                  <AppText mono variant="caption" tone="faint">
                    {ref.mask}
                  </AppText>
                  <ChevronRight size={14} strokeWidth={2} className="text-ink-faint" />
                </View>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Security & Standards Overview */}
        <Card padding="lg" className="gap-3">
          <View className="flex-row items-center gap-2">
            {criticalCount > 0 ? (
              <ShieldAlert size={18} strokeWidth={2} className="text-critical" />
            ) : (
              <ShieldCheck size={18} strokeWidth={2} className="text-success" />
            )}
            <AppText variant="label" tone="muted">
              SECURITY AUDIT & COMPLIANCE
            </AppText>
          </View>

          {activePlan && auditIssues.length > 0 ? (
            <View className="gap-2">
              <AppText variant="subheading" tone="primary">
                {auditIssues.length} finding{auditIssues.length === 1 ? '' : 's'} on {activePlan.name}
              </AppText>
              <AppText variant="caption" tone="muted">
                {criticalCount > 0
                  ? `${criticalCount} high or critical priority security risk(s) identified.`
                  : 'Design warnings flagged against CIS Controls and NIST standards.'}
              </AppText>
              <Button
                variant="secondary"
                size="sm"
                block
                onPress={() => router.push('/(tabs)/audit')}
              >
                Review Findings in Audit
              </Button>
            </View>
          ) : (
            <View className="gap-2">
              <AppText variant="subheading" tone="primary">
                CIS Controls & NIST Ready
              </AppText>
              <AppText variant="caption" tone="muted">
                Automatic offline evaluation for subnet containment, gateway placement, and broadcast isolation.
              </AppText>
              <Button
                variant="secondary"
                size="sm"
                block
                onPress={() => router.push('/(tabs)/audit')}
              >
                Run Security Audit
              </Button>
            </View>
          )}
        </Card>

        {/* Recent Plans */}
        <View className="gap-2">
          <SectionHeader
            title="SAVED PLANS"
            action="View All"
            onAction={() => router.push('/plans')}
          />

          {recentPlans.length > 0 ? (
            <View className="gap-2">
              {recentPlans.map((plan) => (
                <Card key={plan.id} padding="md">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={plan.name}
                    onPress={() => router.push(`/plans/${plan.id}` as any)}
                    className="flex-row items-center gap-3 active:bg-surface-raised"
                  >
                    <View className="flex-1 gap-0.5">
                      <AppText variant="subheading" tone="primary" numberOfLines={1}>
                        {plan.name}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {plan.parentCidr} · {plan.subnets.length} subnet{plan.subnets.length === 1 ? '' : 's'} · {formatRelative(plan.updatedAt)}
                      </AppText>
                    </View>
                    <ChevronRight size={18} strokeWidth={2} className="text-ink-faint" accessibilityElementsHidden />
                  </Pressable>
                </Card>
              ))}
            </View>
          ) : (
            <Card padding="md">
              <EmptyState
                icon={Network}
                title="No plans yet"
                description="Create your first network plan to start designing your address space."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onPress={() => router.push('/(tabs)/planner')}
                  >
                    Create Network Plan
                  </Button>
                }
              />
            </Card>
          )}
        </View>

        {/* Quick Actions */}
        <View className="gap-2">
          <SectionHeader title="QUICK ACTIONS" />
          <View className="flex-row gap-2">
            <Button
              variant="secondary"
              block
              icon={<BookOpen size={16} strokeWidth={2} />}
              onPress={() => router.push('/learning')}
            >
              Learn
            </Button>
            <Button
              variant="secondary"
              block
              icon={<SettingsIcon size={16} strokeWidth={2} />}
              onPress={() => router.push('/settings')}
            >
              Settings
            </Button>
          </View>
        </View>

        <View className="items-center py-2">
          <Network size={20} strokeWidth={1.5} className="text-ink-faint" accessibilityElementsHidden />
        </View>
      </View>
    </Screen>
  );
}
