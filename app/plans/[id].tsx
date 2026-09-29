/**
 * Plan detail — read-only overview with actions.
 *
 * Shows summary stats, address-space bar, subnet table, severity-grouped issue counts.
 * Actions: Edit, Duplicate, Export, Delete.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Alert } from 'react-native';
import { Edit2, Copy, Download, Trash2, AlertTriangle } from 'lucide-react-native';

import {
  AppText,
  Badge,
  Button,
  Card,
  Divider,
  Screen,
  Snackbar,
  useSnackbar,
} from '@/components';
import { useNetworkStore } from '@/store/network-store';
import { buildPlanView } from '@/utils/planner-view';
import { exportPlan } from '@/utils/export';
import { getPlan } from '@/database';
import { evaluatePlan, type PlanDraft, type SubnetRowDraft } from '@/core/planner-input';
import type { GatewayMode } from '@/core/planner-input';

import type { NetworkPlan } from '@/types/network';

export default function PlanDetailScreen({ route }: { route: { params: { id: string } } }) {
  const planId = route.params.id;
  const { duplicateAndLoad: storeDuplicate, deletePlan: storeDelete, loadPlan } = useNetworkStore();
  const { snackbars, showSnackbar, dismissSnackbar } = useSnackbar();

  const [plan] = useState<NetworkPlan | null>(() => getPlan(planId));
  const [outcome, setOutcome] = useState<ReturnType<typeof evaluatePlan> | null>(null);
  const [view, setView] = useState<ReturnType<typeof buildPlanView> | null>(null);

  // Compute derived state when plan changes using useMemo to avoid setState in effect
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

  // Sync derived state to state
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutcome(derived.outcome);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(derived.view);
  }, [derived]);

  if (!plan) {
    return (
      <Screen title="Loading…" subtitle="">
        <View className="flex-1 items-center justify-center">
          <AppText variant="body" tone="muted">Loading plan…</AppText>
        </View>
      </Screen>
    );
  }

  const handleEdit = () => {
    // Load into planner store and navigate to planner
    loadPlan(planId);
    showSnackbar('Opened in Planner', 'Go', () => { /* navigate */ });
  };

  const handleDuplicate = async () => {
    const copy = await storeDuplicate(planId, `${plan.name} (copy)`);
    if (copy) {
      showSnackbar('Plan duplicated', 'Open', () => { /* navigate to copy */ });
    }
  };

  const handleExport = async () => {
    try {
      await exportPlan(plan);
      showSnackbar('Plan exported', 'Open', () => { /* share */ });
    } catch (e) {
      showSnackbar('Export failed: ' + (e as Error).message);
    }
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
            showSnackbar(`"${plan.name}" deleted`);
          },
        },
      ],
    );
  };

  const findings = outcome?.kind === 'ready' ? outcome.findings : [];
  const criticalFindings = findings.filter((f) => ['overlap', 'outside-parent'].includes(f.kind)).length;
  const highFindings = findings.filter((f) => f.kind === 'duplicate-vlan').length;

  return (
    <Screen title={plan.name} subtitle={`${plan.subnets.length} subnets · ${plan.parentCidr}`} scroll>
      <View className="gap-4">
        {/* Summary card */}
        {view?.summary && (
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
              {view.summary.overParent && (
                <AppText variant="caption" tone="muted">
                  Subnets claim more than the parent holds.
                </AppText>
              )}
            </View>
          </Card>
        )}

        {/* Issue counts */}
        {(criticalFindings > 0 || highFindings > 0) && (
          <Card tone="critical" padding="md" className="gap-2">
            <View className="flex-row items-center gap-2">
              <AlertTriangle size={16} strokeWidth={2.5} className="text-critical" />
              <AppText variant="label" tone="primary">
                {criticalFindings + highFindings} issue{criticalFindings + highFindings === 1 ? '' : 's'} found
              </AppText>
            </View>
            <View className="flex-row gap-4">
              {criticalFindings > 0 && (
                <Badge tone="critical">{criticalFindings} Critical</Badge>
              )}
              {highFindings > 0 && (
                <Badge tone="high">{highFindings} High</Badge>
              )}
              {findings.length - criticalFindings - highFindings > 0 && (
                <Badge tone="info">{findings.length - criticalFindings - highFindings} Other</Badge>
              )}
            </View>
          </Card>
        )}

        {/* Subnet table */}
        {view && (
          <Card padding="md" className="gap-3">
            <View className="flex-row items-center justify-between">
              <AppText variant="title" tone="primary">Subnets ({view.rows.length})</AppText>
            </View>
            <SubnetTableView rows={view.rows} />
          </Card>
        )}

        {/* Actions */}
        <Card padding="md" className="gap-2">
          <Button variant="secondary" block icon={<Edit2 size={16} strokeWidth={2} />} onPress={handleEdit}>
            Edit in Planner
          </Button>
          <Button variant="secondary" block icon={<Copy size={16} strokeWidth={2} />} onPress={handleDuplicate}>
            Duplicate
          </Button>
          <Button variant="secondary" block icon={<Download size={16} strokeWidth={2} />} onPress={handleExport}>
            Export
          </Button>
          <Button variant="danger" block icon={<Trash2 size={16} strokeWidth={2} />} onPress={handleDelete}>
            Delete
          </Button>
        </Card>

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

function SubnetTableView({ rows }: { readonly rows: ReturnType<typeof buildPlanView>['rows'] }) {
  return (
    <View className="gap-2">
      {rows.map((row, index) => (
        <View key={row.id} className="gap-1">
          {index > 0 ? <Divider inset="pl-2" /> : null}
          <View className="flex-row items-baseline gap-2 flex-wrap">
            <AppText variant="body" tone="primary" mono className="min-w-[70px] shrink-0">
              {row.cidr}
            </AppText>
            <AppText variant="body" tone="muted" className="flex-1 min-w-0 truncate">
              {row.name}
            </AppText>
            <Badge tone="medium">{row.requested} / {row.capacity}</Badge>
            <AppText variant="caption" tone="faint" mono className="shrink-0">
              {row.utilization}
            </AppText>
            {row.hasConflict && (
              <Badge tone="critical" className="shrink-0">Conflict</Badge>
            )}
            {row.overCapacity && (
              <Badge tone="high" className="shrink-0">Over</Badge>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}