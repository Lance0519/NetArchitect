/**
 * Plan Detail - Redesigned.
 *
 * Read-only overview of a saved plan with actions.
 * Shows summary stats, subnet table, and issue counts.
 *
 * Design principles:
 * - Clear plan header with name and parent
 * - Summary stats in cards
 * - Subnet list with key details
 * - Actions: Edit, Duplicate, Export, Delete
 * - Confirmation for destructive actions
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Alert, Pressable } from 'react-native';
import {
  Copy,
  Download,
  Edit2,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  AppText,
  Badge,
  Button,
  Card,
  ExportSheet,
  Screen,
  Snackbar,
  useSnackbar,
} from '@/components';
import { useNetworkStore } from '@/store/network-store';
import { buildPlanView } from '@/utils/planner-view';
import { getPlan } from '@/database';
import { evaluatePlan, type PlanDraft, type SubnetRowDraft, GatewayMode } from '@/core/planner-input';
import { computeHostAllocation } from '@/core/ip-engine';
import type { NetworkPlan, PlannedSubnet } from '@/types/network';

export default function PlanDetailScreen({ route }: { route?: { params: { id: string } } } = {}) {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ id: string }>();
  const planId = route?.params?.id ?? searchParams.id ?? '';
  const { duplicateAndLoad: storeDuplicate, deletePlan: storeDelete, loadPlan } = useNetworkStore();
  const { snackbars, showSnackbar, dismissSnackbar } = useSnackbar();

  const [plan, setPlan] = useState<NetworkPlan | null>(() => getPlan(planId));
  const [outcome, setOutcome] = useState<ReturnType<typeof evaluatePlan> | null>(null);
  const [view, setView] = useState<ReturnType<typeof buildPlanView> | null>(null);
  const [exportVisible, setExportVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (planId) {
        const refreshed = getPlan(planId);
        if (refreshed) {
          setPlan(refreshed);
        }
      }
    }, [planId]),
  );

  const derived = useMemo(() => {
    if (!plan) return { outcome: null, view: null };
    const draft: PlanDraft = {
      name: plan.name,
      description: plan.description,
      parent: plan.parentCidr,
      profile: plan.profile,
      rows: plan.subnets.map((s): SubnetRowDraft => ({
        id: s.id,
        name: s.name,
        role: s.role,
        customRoleLabel: s.customRoleLabel ?? '',
        vlan: s.vlanId !== undefined ? String(s.vlanId) : '',
        cidr: s.cidr,
        gateway: s.gateway ?? '',
        gatewayMode: (s.gateway !== undefined ? 'manual' : 'auto') as GatewayMode,
        hosts: String(s.requestedHosts),
      })),
    };
    const evalResult = evaluatePlan(draft);
    return {
      outcome: evalResult,
      view: buildPlanView(draft, evalResult),
    };
  }, [plan]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutcome(derived.outcome);
    setView(derived.view);
  }, [derived]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/plans');
    }
  };

  if (!plan) {
    return (
      <Screen title="Plan Not Found" subtitle="" onBack={handleBack} scroll>
        <View className="gap-4">
          <Card padding="lg" className="items-center justify-center gap-2">
            <AppText variant="subheading" tone="primary">Plan does not exist</AppText>
            <AppText variant="caption" tone="muted">This plan may have been deleted.</AppText>
            <Button variant="primary" size="sm" onPress={() => router.replace('/plans')}>
              View All Plans
            </Button>
          </Card>
        </View>
      </Screen>
    );
  }

  const handleEdit = () => {
    loadPlan(planId);
    router.push('/(tabs)/planner');
  };

  const handleDuplicate = () => {
    const copy = storeDuplicate(planId, `${plan.name} (copy)`);
    if (copy) {
      showSnackbar('Plan duplicated', 'Open', () => {
        router.push(`/plans/${copy.id}`);
      });
    }
  };

  const handleExport = () => {
    setExportVisible(true);
  };

  const handleAudit = () => {
    router.push({
      pathname: '/(tabs)/audit',
      params: { planId: plan.id },
    } as any);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete plan?',
      `"${plan.name}" will be permanently deleted. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            storeDelete(planId);
            handleBack();
          },
        },
      ],
    );
  };

  const findings = outcome?.kind === 'ready' ? outcome.findings : [];
  const criticalFindings = findings.filter((f) => ['overlap', 'outside-parent'].includes(f.kind)).length;
  const highFindings = findings.filter((f) => f.kind === 'duplicate-vlan').length;

  return (
    <Screen
      title={plan.name}
      subtitle={`${plan.subnets.length} subnets · ${plan.parentCidr}`}
      onBack={handleBack}
      scroll
    >
      <View className="gap-4">
        {/* Summary card */}
        {view?.summary ? (
          <Card padding="lg">
            <View className="gap-3">
              <AppText variant="label" tone="muted">SUMMARY</AppText>
              <View className="flex-row flex-wrap gap-4">
                <Figure label="Parent" value={view.summary.parent} />
                <Figure label="Subnets" value={view.summary.subnetCount} />
                <Figure label="Claimed" value={view.summary.claimed} />
                <Figure label="Free" value={view.summary.free} />
                <Figure label="Utilisation" value={view.summary.utilization} />
              </View>
              {view.summary.overParent ? (
                <AppText variant="caption" tone="muted">
                  Subnets claim more than the parent holds.
                </AppText>
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* Issue counts */}
        {criticalFindings > 0 || highFindings > 0 ? (
          <Card tone="critical" padding="md" className="gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View issues in Security Audit"
              onPress={handleAudit}
              className="gap-2 active:opacity-80"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <AlertTriangle size={16} strokeWidth={2.5} className="text-critical" />
                  <AppText variant="label" tone="primary">
                    {criticalFindings + highFindings} issue{criticalFindings + highFindings === 1 ? '' : 's'} found
                  </AppText>
                </View>
                <AppText variant="caption" tone="accent" className="font-semibold">
                  Review in Audit →
                </AppText>
              </View>
              <View className="flex-row gap-4">
                {criticalFindings > 0 ? (
                  <Badge tone="critical">{`${criticalFindings} Critical`}</Badge>
                ) : null}
                {highFindings > 0 ? (
                  <Badge tone="high">{`${highFindings} High`}</Badge>
                ) : null}
                {findings.length - criticalFindings - highFindings > 0 ? (
                  <Badge tone="info">{`${findings.length - criticalFindings - highFindings} Other`}</Badge>
                ) : null}
              </View>
            </Pressable>
          </Card>
        ) : null}

        {/* Subnet table & Host Allocations */}
        {view ? (
          <Card padding="md" className="gap-3">
            <View className="flex-row items-center justify-between">
              <AppText variant="title" tone="primary">Subnets & Host Allocation ({view.rows.length})</AppText>
              <AppText variant="caption" tone="faint">Tap row to view host map</AppText>
            </View>
            <SubnetTableView rows={view.rows} subnets={plan.subnets} />
          </Card>
        ) : null}

        {/* Actions */}
        <Card padding="md" className="gap-2">
          <Button
            variant="secondary"
            block
            icon={<ShieldCheck size={16} strokeWidth={2} />}
            onPress={handleAudit}
          >
            Security Audit
          </Button>
          <Button variant="secondary" block icon={<Edit2 size={16} strokeWidth={2} />} onPress={handleEdit}>
            Edit in Planner
          </Button>
          <Button variant="secondary" block icon={<Copy size={16} strokeWidth={2} />} onPress={handleDuplicate}>
            Duplicate Plan
          </Button>
          <Button variant="secondary" block icon={<Download size={16} strokeWidth={2} />} onPress={handleExport}>
            Export Configuration
          </Button>
          <Button variant="danger" block icon={<Trash2 size={16} strokeWidth={2} />} onPress={handleDelete}>
            Delete Plan
          </Button>
        </Card>

        <View className="py-4">
          <AppText variant="caption" tone="faint" className="text-center">
            Plans are stored locally on this device. NetArchitect never connects to a network.
          </AppText>
        </View>
      </View>

      {/* Export sheet */}
      <ExportSheet
        visible={exportVisible}
        plan={plan}
        onClose={() => setExportVisible(false)}
      />

      {/* Snackbars */}
      <View className="absolute bottom-4 left-4 right-4 z-50 flex-col items-center gap-2 pointer-events-none">
        {snackbars.map((sb) => (
          <Snackbar
            key={sb.id}
            message={sb.message}
            actionLabel={sb.actionLabel}
            onAction={sb.onAction}
            duration={sb.duration}
            onDismiss={() => dismissSnackbar(sb.id)}
          />
        ))}
      </View>
    </Screen>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View className="min-w-[30%] flex-1 gap-0.5">
      <AppText variant="caption" tone="faint">{label}</AppText>
      <AppText variant="title" tone="primary" mono>{value}</AppText>
    </View>
  );
}

function SubnetTableView({
  rows,
  subnets,
}: {
  readonly rows: ReturnType<typeof buildPlanView>['rows'];
  readonly subnets: readonly PlannedSubnet[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const subnetMap = useMemo(() => new Map(subnets.map((s) => [s.id, s])), [subnets]);

  return (
    <View className="gap-2.5">
      {rows.map((row) => {
        const subnet = subnetMap.get(row.id);
        const isExpanded = expandedId === row.id;
        const alloc = subnet ? computeHostAllocation(subnet.cidr, subnet.gateway) : null;

        return (
          <View
            key={row.id}
            className="gap-2 rounded-control border border-line-subtle bg-surface-raised p-3"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${row.name}, ${row.cidr}`}
              onPress={() => setExpandedId(isExpanded ? null : row.id)}
              className="flex-row items-center justify-between"
            >
              <View className="flex-1 gap-1 pr-2">
                <View className="flex-row items-center gap-2 flex-wrap">
                  <AppText variant="subheading" tone="primary" mono>
                    {row.cidr}
                  </AppText>
                  {subnet?.vlanId !== undefined ? (
                    <Badge tone="info">{`VLAN ${subnet.vlanId}`}</Badge>
                  ) : null}
                  {subnet?.role ? (
                    <Badge tone="neutral">{subnet.role}</Badge>
                  ) : null}
                </View>
                <AppText variant="caption" tone="muted">
                  {row.name} · {row.requested} / {row.capacity} hosts ({row.utilization})
                </AppText>
              </View>

              <View className="flex-row items-center gap-2">
                {row.hasConflict ? <Badge tone="critical">Conflict</Badge> : null}
                {row.overCapacity ? <Badge tone="high">Over</Badge> : null}
                {isExpanded ? (
                  <ChevronUp size={18} strokeWidth={2} className="text-ink-muted" />
                ) : (
                  <ChevronDown size={18} strokeWidth={2} className="text-ink-muted" />
                )}
              </View>
            </Pressable>

            {/* Expandable Per-Subnet Host Allocation */}
            {isExpanded && alloc ? (
              <View className="mt-1 gap-2 border-t border-line-subtle pt-2.5">
                <AppText variant="label" tone="muted">
                  HOST IP ALLOCATION BREAKDOWN
                </AppText>

                {/* Gateway Router */}
                <View className="flex-row items-center justify-between rounded-control bg-surface p-2.5 border border-line-subtle">
                  <View className="gap-0.5">
                    <AppText variant="caption" tone="accent" className="font-semibold">
                      Default Gateway
                    </AppText>
                    <AppText variant="caption" tone="faint">
                      Router / Firewall interface
                    </AppText>
                  </View>
                  <AppText mono variant="body" tone="accent" className="font-semibold">
                    {alloc.gateway}
                  </AppText>
                </View>

                {/* Static Infrastructure Range */}
                {alloc.staticRange ? (
                  <View className="flex-row items-center justify-between rounded-control bg-surface p-2.5 border border-line-subtle">
                    <View className="gap-0.5">
                      <AppText variant="caption" tone="primary" className="font-semibold">
                        Static Infrastructure ({alloc.staticRange.count} IPs)
                      </AppText>
                      <AppText variant="caption" tone="faint">
                        Reserved for Servers, Switches, Printers, APs
                      </AppText>
                    </View>
                    <AppText mono variant="body" tone="primary" className="font-medium">
                      {alloc.staticRange.start} – {alloc.staticRange.end}
                    </AppText>
                  </View>
                ) : null}

                {/* Dynamic DHCP Client Pool */}
                {alloc.dhcpPool ? (
                  <View className="flex-row items-center justify-between rounded-control bg-surface p-2.5 border border-line-subtle">
                    <View className="gap-0.5">
                      <AppText variant="caption" tone="success" className="font-semibold">
                        Dynamic DHCP Pool ({alloc.dhcpPool.count} hosts)
                      </AppText>
                      <AppText variant="caption" tone="faint">
                        Assigned to workstations, phones, Wi-Fi clients
                      </AppText>
                    </View>
                    <AppText mono variant="body" tone="success" className="font-medium">
                      {alloc.dhcpPool.start} – {alloc.dhcpPool.end}
                    </AppText>
                  </View>
                ) : null}

                {/* Broadcast Address & Metadata */}
                <View className="flex-row items-center justify-between px-1 pt-1">
                  <AppText variant="caption" tone="faint">
                    Network: {alloc.networkAddress}
                  </AppText>
                  {alloc.broadcastAddress ? (
                    <AppText variant="caption" tone="faint">
                      Broadcast: {alloc.broadcastAddress}
                    </AppText>
                  ) : (
                    <AppText variant="caption" tone="faint">
                      RFC 3021 /31 (No Broadcast)
                    </AppText>
                  )}
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
