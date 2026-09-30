/**
 * Network Planner - Redesigned.
 *
 * A network workspace for building and managing network plans.
 * Shows plan details, subnet segments, and utilization.
 *
 * Design principles:
 * - Clear plan header with name and parent block
 * - Network segments as reusable cards
 * - Role badges, VLAN badges, CIDR, host count, utilization
 * - Add segment button for new subnets
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { CircleDashed, LayoutTemplate, RefreshCw, Trash2 } from 'lucide-react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  ChangePreview,
  Divider,
  EmptyState,
  PlanFindingList,
  Screen,
  Select,
  Sheet,
  SubnetEditor,
  TextField,
} from '@/components';
import { evaluatePlan, type PlannerOutcome } from '@/core/planner-input';
import { SELECTABLE_PROFILES, profileById, type ProfileDefinition } from '@/core/profiles';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePlanStore } from '@/store/plan-store';
import { useVlsmStore } from '@/store/vlsm-store';
import { buildPlanView, unassignedFindings } from '@/utils/planner-view';

import type { SubnetEditorProps } from '@/components';
import type { PlanProfile } from '@/types/network';

export default function PlannerScreen() {
  const draft = usePlanStore((state) => state.draft);
  const pending = usePlanStore((state) => state.pending);
  const setName = usePlanStore((state) => state.setName);
  const setDescription = usePlanStore((state) => state.setDescription);
  const setParent = usePlanStore((state) => state.setParent);
  const setProfile = usePlanStore((state) => state.setProfile);
  const updateRow = usePlanStore((state) => state.updateRow);
  const setGatewayMode = usePlanStore((state) => state.setGatewayMode);
  const addRow = usePlanStore((state) => state.addRow);
  const removeRow = usePlanStore((state) => state.removeRow);
  const moveRow = usePlanStore((state) => state.moveRow);
  const stageRepack = usePlanStore((state) => state.stageRepack);
  const stageProfile = usePlanStore((state) => state.stageProfile);
  const takeHandoff = usePlanStore((state) => state.takeHandoff);
  const commitChange = usePlanStore((state) => state.commitChange);
  const discardChange = usePlanStore((state) => state.discardChange);
  const reset = usePlanStore((state) => state.reset);

  const consumeHandoff = useVlsmStore((state) => state.consumeHandoff);

  const [operationError, setOperationError] = useState<string | null>(null);

  useEffect(() => {
    takeHandoff(consumeHandoff());
  }, [consumeHandoff, takeHandoff]);

  const settled = useDebouncedValue(draft);
  const outcome = useMemo(() => evaluatePlan(settled), [settled]);
  const view = useMemo(() => buildPlanView(settled, outcome), [settled, outcome]);

  const findings = outcome.kind === 'ready' ? outcome.findings : [];
  const orphaned = unassignedFindings(findings, view.conflictsByRow);

  const runOperation = useCallback((outcomeMessage: string | null) => {
    setOperationError(outcomeMessage);
  }, []);

  const editName = useCallback((name: string) => {
    setOperationError(null);
    setName(name);
  }, [setName]);
  const editParent = useCallback((parent: string) => {
    setOperationError(null);
    setParent(parent);
  }, [setParent]);
  const editDescription = useCallback((description: string) => {
    setOperationError(null);
    setDescription(description);
  }, [setDescription]);
  const editProfile = useCallback((profile: PlanProfile) => {
    setOperationError(null);
    setProfile(profile);
  }, [setProfile]);
  const editRow = useCallback<SubnetEditorProps['onChange']>(
    (id, patch) => {
      setOperationError(null);
      updateRow(id, patch);
    },
    [updateRow],
  );
  const editGatewayMode = useCallback<SubnetEditorProps['onGatewayMode']>(
    (id, mode) => {
      setOperationError(null);
      setGatewayMode(id, mode);
    },
    [setGatewayMode],
  );
  const addSubnet = useCallback(() => {
    setOperationError(null);
    addRow();
  }, [addRow]);
  const dropSubnet = useCallback((id: string) => {
    setOperationError(null);
    removeRow(id);
  }, [removeRow]);
  const moveSubnet = useCallback((id: string, by: -1 | 1) => {
    setOperationError(null);
    moveRow(id, by);
  }, [moveRow]);
  const clearPlan = useCallback(() => {
    setOperationError(null);
    reset();
  }, [reset]);

  return (
    <Screen
      title="Network Planner"
      subtitle="Build a plan from a site and its needs."
      scroll
    >
      <View className="gap-4">
        {/* Plan Header */}
        <Card padding="md" className="gap-3">
          <TextField
            label="Plan name"
            value={draft.name}
            onChangeText={editName}
            placeholder="School Network"
            autoCapitalize="words"
            hint="What this plan is for."
            error={headerError(outcome, 'name')}
          />

          <TextField
            label="Parent block"
            value={draft.parent}
            onChangeText={editParent}
            placeholder="10.10.0.0/16"
            mono
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardType="numbers-and-punctuation"
            hint="The block the whole plan lives in."
            error={headerError(outcome, 'parent')}
          />

          <TextField
            label="Notes"
            value={draft.description}
            onChangeText={editDescription}
            placeholder="Optional"
            autoCapitalize="sentences"
            multiline
            hint="Free text, kept with the plan."
          />
        </Card>

        {/* Template Picker */}
        <TemplatePicker
          onApply={(profileId) => {
            const profile = profileById(profileId);
            if (profile === null) return;
            runOperation(stageProfile(profile));
          }}
        />

        {/* Subnet Editor */}
        <SubnetEditor
          rows={view.rows}
          drafts={settled.rows}
          onChange={editRow}
          onGatewayMode={editGatewayMode}
          onAdd={addSubnet}
          onRemove={dropSubnet}
          onMove={moveSubnet}
        />

        {/* Operation Error */}
        {operationError === null ? null : (
          <Banner tone="warn" title="That did not work">
            <AppText variant="caption">{operationError}</AppText>
          </Banner>
        )}

        {/* Empty State */}
        {outcome.kind === 'empty' ? (
          <EmptyState
            icon={CircleDashed}
            title="No subnets yet"
            description="Add a row for each segment you need - a staff LAN, a server block, a link to a branch office."
          />
        ) : null}

        {/* Notice */}
        {view.notice === null ? null : (
          <Banner
            tone={view.notice.kind === 'warn' ? 'error' : 'info'}
            title={view.notice.title}
          >
            <AppText variant="caption">{view.notice.body}</AppText>
          </Banner>
        )}

        {/* Summary */}
        {view.summary === null ? null : (
          <Card padding="lg">
            <View className="gap-3">
              <AppText variant="label" tone="muted">
                SUMMARY
              </AppText>

              <View className="flex-row flex-wrap gap-4">
                <Figure label="Parent" value={view.summary.parent} />
                <Figure label="Subnets" value={view.summary.subnetCount} />
                <Figure label="Claimed" value={view.summary.claimed} />
                <Figure label="Free" value={view.summary.free} />
                <Figure label="Utilisation" value={view.summary.utilization} />
              </View>

              {view.summary.overParent ? (
                <AppText variant="caption" tone="muted">
                  The subnets claim more than the parent holds.
                </AppText>
              ) : null}

              <Divider />

              <View className="gap-2">
                <Button
                  variant="secondary"
                  block
                  size="sm"
                  icon={<RefreshCw size={16} strokeWidth={2} />}
                  onPress={() => {
                    runOperation(stageRepack());
                  }}
                >
                  Reallocate from host counts
                </Button>
                <AppText variant="caption" tone="faint">
                  Re-derives every CIDR from its host count, packed largest first.
                </AppText>
              </View>
            </View>
          </Card>
        )}

        {/* Findings */}
        <PlanFindingList
          findings={[...findings, ...orphaned]}
          title={findings.length === 1 ? '1 thing to fix' : `${findings.length} things to fix`}
          explanation="Every value here parsed. The plan is complete; these rows just disagree with each other."
        />

        {/* Profile Selector */}
        <Card padding="md" className="gap-2">
          <Select
            label="Plan profile"
            value={draft.profile}
            options={PROFILE_OPTIONS}
            onChange={editProfile}
            hint="A label for this plan."
          />

          <Button
            variant="secondary"
            block
            icon={<Trash2 size={16} strokeWidth={2} />}
            onPress={clearPlan}
          >
            Clear the plan
          </Button>
          <AppText variant="caption" tone="faint">
            Saving arrives with the local database in the next phase. Nothing here is written
            to disk yet.
          </AppText>
        </Card>

        <AppText variant="caption" tone="faint" className="text-center py-2">
          Planned on this device. NetArchitect never connects to a network.
        </AppText>
      </View>

      <ChangePreview pending={pending} onConfirm={commitChange} onCancel={discardChange} />
    </Screen>
  );
}

const PROFILE_OPTIONS: readonly { value: PlanProfile; label: string; description: string }[] = [
  { value: 'custom', label: 'Custom', description: 'No profile. A plan built by hand.' },
  ...SELECTABLE_PROFILES.map((profileId) => {
    const profile = profileById(profileId);
    return {
      value: profileId as PlanProfile,
      label: profile?.label ?? profileId,
      description: profile?.description ?? '',
    };
  }),
];

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View className="min-w-[30%] flex-1 gap-0.5">
      <AppText variant="caption" tone="faint">
        {label}
      </AppText>
      <AppText variant="title" tone="primary" mono>
        {value}
      </AppText>
    </View>
  );
}

function TemplatePicker({
  onApply,
}: {
  readonly onApply: (profileId: Exclude<PlanProfile, 'custom'>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        block
        icon={<LayoutTemplate size={16} strokeWidth={2} />}
        onPress={() => setOpen(true)}
      >
        Start from a template
      </Button>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Templates"
        subtitle="A starting set of segments. Every host count is a hint."
        footer={
          <Button variant="ghost" block onPress={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <View className="gap-3">
          {SELECTABLE_PROFILES.map((profileId) => {
            const profile = profileById(profileId);
            if (profile === null) return null;
            return (
              <ProfileCard
                key={profile.id}
                profile={profile}
                onApply={() => {
                  setOpen(false);
                  onApply(profile.id);
                }}
              />
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

function ProfileCard({
  profile,
  onApply,
}: {
  readonly profile: ProfileDefinition;
  readonly onApply: () => void;
}) {
  return (
    <Card tone="inset" padding="md" className="gap-2">
      <AppText variant="subheading" tone="primary">
        {profile.label}
      </AppText>
      <AppText variant="caption" tone="muted">
        {profile.description}
      </AppText>
      <AppText variant="caption" tone="faint">
        {profile.entries.length} segments, about {totalHostsOf(profile.entries)} hosts before rounding up.
      </AppText>
      <Button variant="secondary" size="sm" block onPress={onApply}>
        Use this template
      </Button>
    </Card>
  );
}

function totalHostsOf(entries: readonly { readonly hosts: number }[]): number {
  return entries.reduce((sum, entry) => sum + entry.hosts, 0);
}

function headerError(
  outcome: PlannerOutcome,
  field: 'name' | 'parent',
): string | undefined {
  return outcome.kind === 'header-invalid' && outcome.field === field ? outcome.message : undefined;
}
