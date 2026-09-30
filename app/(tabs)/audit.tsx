/**
 * Security Audit - Redesigned.
 *
 * A calm diagnostic interface for reviewing network security against CIS & NIST standards.
 * Shows audit summary, address space visualization, and issues by severity.
 *
 * Design principles:
 * - Calm, not alarming: issues are clearly categorized
 * - Summary first: counts by severity, then details
 * - Color is never the only signal: icons and labels always present
 * - Progressive disclosure: summary, then filterable list
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CircleDashed, Plus } from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  AddressSpaceBar,
  AppText,
  Banner,
  Card,
  EmptyState,
  Screen,
  SecurityIssueCard,
  SegmentedControl,
} from '@/components';
import { Button } from '@/components/ui/Button';
import { AuditSummary } from '@/components/security';
import { auditPlan } from '@/core/security-auditor';
import { SECURITY_DISCLAIMER } from '@/core/standards';
import { useNetworkStore } from '@/store/network-store';
import type { NetworkPlan, SecurityIssue, Severity } from '@/types/network';
import { SEVERITY_ORDERED, severityMeta } from '@/theme/severity';
import { cn } from '@/utils/cn';

export default function AuditScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ planId?: string }>();
  const { listPlans } = useNetworkStore();
  const [plans, setPlans] = useState<readonly NetworkPlan[]>(() => listPlans());
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    () => searchParams.planId ?? null,
  );
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');

  useFocusEffect(
    useCallback(() => {
      const currentPlans = listPlans();
      setPlans(currentPlans);
      if (searchParams.planId && currentPlans.some((p) => p.id === searchParams.planId)) {
        setSelectedPlanId(searchParams.planId);
      }
    }, [listPlans, searchParams.planId]),
  );

  const activePlanId = selectedPlanId ?? plans[0]?.id ?? null;

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === activePlanId) ?? null,
    [plans, activePlanId],
  );

  const issues = useMemo(
    () => (selectedPlan ? auditPlan(selectedPlan) : []),
    [selectedPlan],
  );

  const filteredIssues = useMemo(
    () => (severityFilter === 'all' ? issues : issues.filter((i) => i.severity === severityFilter)),
    [issues, severityFilter],
  );

  const issuesBySeverity = useMemo(() => {
    const grouped = new Map<Severity, SecurityIssue[]>();
    for (const issue of issues) {
      const list = grouped.get(issue.severity) ?? [];
      list.push(issue);
      grouped.set(issue.severity, list);
    }
    return grouped;
  }, [issues]);

  const handleSubnetPress = (_subnetId: string) => {
    if (selectedPlan) {
      router.push(`/plans/${selectedPlan.id}` as any);
    }
  };

  const criticalCount = issuesBySeverity.get('critical')?.length ?? 0;
  const highCount = issuesBySeverity.get('high')?.length ?? 0;
  const mediumCount = issuesBySeverity.get('medium')?.length ?? 0;
  const infoCount = issuesBySeverity.get('info')?.length ?? 0;
  const totalWarnings = mediumCount + infoCount;
  const totalCritical = criticalCount + highCount;

  return (
    <Screen title="Security Audit" subtitle="Static design review of a saved plan." scroll>
      <View className="gap-4">
        {/* Disclaimer */}
        <Banner tone="warn" title="What this does not do">
          {SECURITY_DISCLAIMER}
        </Banner>

        {/* Plan Selector */}
        {plans.length === 0 ? (
          <Card padding="lg" className="gap-3">
            <AppText variant="subheading" tone="primary">
              No Saved Plans to Audit
            </AppText>
            <AppText variant="caption" tone="muted">
              Create and save a network plan in the Network Planner or VLSM Allocator first. Once saved, you can run automated CIS/NIST static security audits here.
            </AppText>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={16} strokeWidth={2} />}
              onPress={() => router.push('/planner')}
            >
              Create Network Plan
            </Button>
          </Card>
        ) : (
          <Card padding="md" className="gap-2.5">
            <View className="flex-row items-center justify-between">
              <AppText variant="label" tone="muted">
                SELECT A PLAN ({plans.length})
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View all plans"
                onPress={() => router.push('/plans')}
              >
                <AppText variant="caption" tone="accent">
                  Manage Plans
                </AppText>
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
            >
              {plans.map((p) => {
                const isSelected = p.id === activePlanId;
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${p.name} (${p.parentCidr})`}
                    onPress={() => setSelectedPlanId(p.id)}
                    className={cn(
                      'flex-row items-center gap-2 rounded-pill border px-3.5 py-2 active:bg-surface-raised',
                      isSelected
                        ? 'border-accent bg-accent'
                        : 'border-line bg-surface',
                    )}
                  >
                    <AppText
                      variant="caption"
                      className={cn('font-medium', isSelected ? 'text-accent-on font-semibold' : 'text-ink')}
                    >
                      {p.name}
                    </AppText>
                    <AppText
                      mono
                      variant="caption"
                      className={cn(isSelected ? 'text-accent-on/80' : 'text-ink-faint')}
                    >
                      {p.parentCidr}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Card>
        )}

        {/* Results */}
        {selectedPlan ? (
          <View className="gap-4">
            {/* Audit Summary */}
            <AuditSummary
              planName={selectedPlan.name}
              parentCidr={selectedPlan.parentCidr}
              subnetCount={selectedPlan.subnets.length}
              checksPassed={17 - issues.length}
              warnings={totalWarnings}
              critical={totalCritical}
            />

            {/* Address Space Visualization */}
            <Card padding="md">
              <View className="gap-3">
                <AppText variant="label" tone="muted">
                  ADDRESS SPACE
                </AppText>
                <AddressSpaceBar plan={selectedPlan} />
              </View>
            </Card>

            {/* Severity Filter */}
            <SegmentedControl
              label="Filter by severity"
              value={severityFilter}
              onChange={setSeverityFilter}
              options={[
                { value: 'all', label: `All (${issues.length})` },
                ...SEVERITY_ORDERED.map((s) => ({
                  value: s as Severity | 'all',
                  label: `${severityMeta(s).short} (${issuesBySeverity.get(s)?.length ?? 0})`,
                })),
              ]}
            />

            {/* Issue List */}
            {filteredIssues.length === 0 ? (
              <EmptyState
                icon={CircleDashed}
                title="No issues found"
                description={
                  issues.length === 0
                    ? 'This plan passed all security checks.'
                    : 'No issues match the selected severity filter.'
                }
              />
            ) : (
              <View className="gap-3">
                {filteredIssues.map((issue) => (
                  <SecurityIssueCard
                    key={`${issue.ruleId}-${issue.affectedSubnetIds.join(',')}`}
                    issue={issue}
                    onSubnetPress={handleSubnetPress}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
