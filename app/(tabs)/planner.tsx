/**
 * Network Planner.
 *
 * A named plan, a parent block, and a list of subnets the user wrote themselves.
 *
 * ## Where the logic went, and why
 *
 * Four pure modules, all tested with no render mock:
 *
 *   `@/core/planner-input`   draft text -> empty | header-invalid | rows-invalid | ready,
 *                            plus the row add/move/remove operations
 *   `@/core/plan-changes`    the two destructive operations (repack, profile) and the VLSM
 *                            hand-off, each returning a previewable diff
 *   `@/core/profiles`        the templates, as names, roles and host *hints* - never
 *                            addresses
 *   `@/utils/planner-view`   a draft + outcome -> rows, summary, notices, per-row findings
 *
 * R4 declined a component-test runner, so the Phase 8 exit criteria are only checkable if
 * this output exists as a value Vitest can reach. This file is the thin remainder that
 * connects them: it routes each outcome to a place on screen, contains no arithmetic, and
 * makes no decision about what a number should be. The exhaustive `switch` over the outcome
 * lives in `planner-view.ts` instead — next to the wording it selects.
 *
 * ## React Hook Form: still not used, and the Phase 7 prediction was wrong
 *
 * The Phase 7 screen's header comment predicted RHF would arrive here, on the grounds that
 * the planner "saves" and RHF is good at submit-time validation. That prediction is wrong
 * about the timeline: persistence is **Phase 9**, so this screen has no submit and nothing
 * to save yet. The correction is recorded in `PLAN.md` rather than quietly dropped.
 *
 * The rest of the reasoning from Phase 7 still holds unchanged. The row list is pure
 * functions over an immutable draft, each tested directly. RHF would add a subscription per
 * field, a resolver, and a second validation path that has to agree with `evaluatePlan` - and
 * two validation paths on one screen is how a row ends up showing an error the plan ignored.
 *
 * ## A plan with an overlap is representable, and flagged
 *
 * The Phase 8 exit criterion. Every CIDR here is the user's own text, so two rows claiming
 * the same addresses is something a person can genuinely do. The screen does not refuse: it
 * builds the plan, lists the finding, and marks both rows. Refusing would make the finding
 * the Phase 11 auditor exists to report impossible to create.
 *
 * `PlanFinding` carries no severity, deliberately. "Overlap" is a true statement about the
 * plan; rating it Critical would be a security judgement made by a display layer. Phase 11
 * does that, with a citation.
 *
 * ## Three messages about state, and where each lives
 *
 * The screen has to report four different conditions, and collapsing them makes one look
 * like another:
 *
 *   - **The draft does not parse.**  `view.notice` - a plan-level banner plus a message on
 *     each offending row.
 *   - **The plan is complete but the rows disagree.**  `PlanFindingList`.
 *   - **An operation could not be performed.**  `operationError`, local state.
 *   - **A change is waiting to be confirmed.**  `ChangePreview`, a sheet.
 *
 * The third is local rather than in the store because it is not a property of the plan. It
 * describes the last thing the user tapped and disappears when they do anything else - a
 * "there is no room in this block" message still sitting on screen after the user has
 * widened the parent would be a stale claim.
 *
 * ## The draft is in a store, the evaluation is not
 *
 * `usePlanStore` holds the text so switching tabs does not discard a half-built plan. The
 * outcome, the view and the findings are recomputed here from the debounced draft, and never
 * stored - a cached view would be one keystroke behind the rows above it.
 *
 * ## What this screen cannot do yet
 *
 * There is no save. Phase 9 adds local persistence, and until then a plan here is a draft
 * that lives as long as the app does. The screen says so rather than implying otherwise.
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

  /**
   * Why the last operation did not happen, or `null`.
   *
   * Local state, deliberately. The store holds the draft and the pending change, and a
   * message about the last button press is neither - it is true of the moment the user
   * tapped something, and putting it in the store would mean deciding when to clear it,
   * which is a screen's decision. See the module note.
   */
  const [operationError, setOperationError] = useState<string | null>(null);

  /**
   * The VLSM hand-off is taken once, on mount.
   *
   * `consumeHandoff` clears the slot on read, so a second call finds nothing - the effect
   * cannot double-apply even if it ran twice. Zustand actions are referentially stable, so
   * listing them as the only dependencies is correct and does not re-run on every render.
   */
  useEffect(() => {
    takeHandoff(consumeHandoff());
  }, [consumeHandoff, takeHandoff]);

  /**
   * The draft is typed immediately; the plan waits for the typing to settle.
   *
   * "192.168.1.0/2" is three different subnets on the way in, and without this the derived
   * columns under a row would rearrange themselves under the user's finger. See
   * `useDebouncedValue` for why the delay is on the value and not on the input.
   *
   * Note the *inputs* are the live draft, not `settled`. The fields have to track the
   * keystroke - a debounced `TextField` lags behind the caret by 200ms and reads as dropped
   * input.
   */
  const settled = useDebouncedValue(draft);
  const outcome = useMemo(() => evaluatePlan(settled), [settled]);

  /**
   * The built view, computed during render.
   *
   * On `settled` rather than `draft`, so a row's derived columns describe the same text the
   * outcome was computed from. A view built from the live draft against a debounced outcome
   * would show a CIDR resolving to columns the finding list has not caught up with.
   */
  const view = useMemo(() => buildPlanView(settled, outcome), [settled, outcome]);

  const findings = outcome.kind === 'ready' ? outcome.findings : [];
  const orphaned = unassignedFindings(findings, view.conflictsByRow);

  /**
   * Run an operation, and report why it did not happen.
   *
   * One helper for both, so a failure always produces a banner and never produces nothing.
   * A staging action returns the engine's own refusal message or `null`, and discarding the
   * message would leave the user with a button that silently does nothing - which reads as
   * a broken app rather than as a plan that will not fit.
   */
  const runOperation = useCallback((outcomeMessage: string | null) => {
    setOperationError(outcomeMessage);
  }, []);

  /**
   * Editing the plan clears the operation error.
   *
   * The error described a specific attempt against a specific draft. Once the draft changes
   * it is no longer a statement about what is on screen, and leaving it there would be a
   * stale claim about a plan the user has already edited.
   *
   * ## Why these wrappers exist at all
   *
   * A `useEffect` keyed on the draft would say the same rule once, and the
   * `react-hooks/set-state-in-effect` rule is right that it should not: a state update in
   * an effect body is a render pass the user did not ask for, every time.
   *
   * The alternative is clearing at each mutation, which is where the rule actually belongs -
   * the message is invalidated by the act that invalidates it. Ten stable wrappers rather
   * than one inline closure per field per render: `setOperationError` and the Zustand
   * actions are both referentially stable, so every dependency list here is empty and none
   * of these is reallocated while the user types.
   */
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
      subtitle="Build a plan from a site and its needs, then check it before you keep it."
      scroll
    >
      <View className="gap-4">
        {/* The header first, because nothing below it can be judged without a parent. */}
        <Card padding="md" className="gap-3">
          <TextField
            label="Plan name"
            value={draft.name}
            onChangeText={editName}
            placeholder="Ground floor"
            autoCapitalize="words"
            hint="What this plan is for. It is how the plan is listed once saving arrives."
            error={headerError(outcome, 'name')}
          />

          <TextField
            label="Parent block"
            value={draft.parent}
            onChangeText={editParent}
            placeholder="192.168.1.0/24"
            mono
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardType="numbers-and-punctuation"
            hint="The block the whole plan lives in. Every subnet must fit inside it."
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

        <TemplatePicker
          onApply={(profileId) => {
            const profile = profileById(profileId);
            if (profile === null) return;
            runOperation(stageProfile(profile));
          }}
        />

        <SubnetEditor
          rows={view.rows}
          drafts={settled.rows}
          onChange={editRow}
          onGatewayMode={editGatewayMode}
          onAdd={addSubnet}
          onRemove={dropSubnet}
          onMove={moveSubnet}
        />

        {operationError === null ? null : (
          <Banner tone="warn" title="That did not work">
            <AppText variant="caption">{operationError}</AppText>
          </Banner>
        )}

        {/*
          All four outcome kinds reach the screen, and by four different routes rather than
          one `switch` — which is worth stating, because the Phase 7 screen uses a switch and
          a reader will look for one here.

          `empty`      → this EmptyState. The editor above is already empty too, but it is a
                         form the user is about to use, and a form with no explanation under
                         it reads as a form that has failed to load.
          `header-invalid` and `rows-invalid` → `view.notice`, plus `headerError()` on the
                         named field and a message on each offending row. The view model owns
                         the wording; the screen only decides where to put it.
          `ready`      → the summary card and `PlanFindingList`, and nothing here.

          So no state falls through silently. The exhaustive `switch` is
          `planNotice()` in `planner-view.ts`, which is where the wording lives and where it
          is tested — and it has a `case` per kind with no `default`, so a fifth state added
          to `PlannerOutcome` fails to compile there rather than rendering nothing.
        */}
        {outcome.kind === 'empty' ? (
          <EmptyState
            icon={CircleDashed}
            title="No subnets yet"
            description="Add a row for each segment you need - a staff LAN, a server block, a link to a branch office - and give it a name and either a subnet or a host count. The address columns resolve as you type, and anything two rows disagree about is listed below the plan."
          />
        ) : null}

        {view.notice === null ? null : (
          <Banner
            tone={view.notice.kind === 'warn' ? 'error' : 'info'}
            title={view.notice.title}
          >
            <AppText variant="caption">{view.notice.body}</AppText>
          </Banner>
        )}

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
                  The subnets claim more than the parent holds. Each is a valid block on its
                  own; they cannot all be part of this one address space.
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
                  Re-derives every CIDR from its host count, packed largest first. It cannot
                  infer the intent behind a subnet you sized by hand, so you will see a
                  preview of what moves before anything is applied.
                </AppText>
              </View>
            </View>
          </Card>
        )}

        {/*
          The plan-level finding list. Every finding also appears on the rows it names, and
          this is the summary - the "your plan has three problems" list. `orphaned` is
          normally empty; it is here so a finding whose rows have all been deleted is still
          visible rather than silently dropped from the one place a plan-level problem is
          summarised.
        */}
        <PlanFindingList
          findings={[...findings, ...orphaned]}
          title={findings.length === 1 ? '1 thing to fix' : `${findings.length} things to fix`}
          explanation="Every value here parsed. The plan is complete; these rows just disagree with each other."
        />

        <Card padding="md" className="gap-2">
          <Select
            label="Plan profile"
            value={draft.profile}
            options={PROFILE_OPTIONS}
            onChange={editProfile}
            hint="A label for this plan, used when several plans share a device. It does not change any address."
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

        <AppText variant="caption" tone="faint">
          Planned on this device. NetArchitect never connects to a network.
        </AppText>
      </View>

      <ChangePreview pending={pending} onConfirm={commitChange} onCancel={discardChange} />
    </Screen>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

/**
 * The profile label options.
 *
 * Built from the two module-level lists rather than from a literal here, so a profile added
 * to `profiles.ts` appears in this picker without a second edit. `CUSTOM` is here by hand
 * because it is the absence of a profile rather than one, and it is not in
 * `SELECTABLE_PROFILES` for exactly that reason.
 */
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

/**
 * The template picker.
 *
 * A `Sheet` rather than an inline `Select`, because the profiles carry a description and a
 * host budget and a list of names is not enough to choose from. The description is what
 * tells someone whether "Home / small office" is their situation.
 */
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
        subtitle="A starting set of segments. Every host count is a hint, and every subnet is allocated inside the parent block you have entered."
        footer={
          <Button variant="ghost" block onPress={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <View className="gap-3">
          {SELECTABLE_PROFILES.map((profileId) => {
            const profile = profileById(profileId);
            // Unreachable today: `SELECTABLE_PROFILES` and `profileById` read the same
            // list. Kept because a null here means the picker would render a card with a
            // hole in it, and a `null` from a lookup is a thing that has to be handled
            // rather than asserted away.
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

/** One template, with what it would add up to. */
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
        {profile.entries.length} segments, about {totalHostsOf(profile.entries)} hosts before
        rounding up.
      </AppText>
      <Button variant="secondary" size="sm" block onPress={onApply}>
        Use this template
      </Button>
    </Card>
  );
}

/**
 * The host total a template adds up to.
 *
 * A sum of the hints, described as "about". Not a capacity figure - the engine rounds each
 * hint up to the next power of two, and the real total is larger. Saying so is the
 * difference between a useful headline and a claim that can be checked and found wrong.
 */
function totalHostsOf(entries: readonly { readonly hosts: number }[]): number {
  return entries.reduce((sum, entry) => sum + entry.hosts, 0);
}

/* ------------------------------------------------------------------ *
 * Outcome readers
 * ------------------------------------------------------------------ */

/**
 * A header field's message, or `undefined` when it is not the one at fault.
 *
 * The `header-invalid` outcome names one field, so a screen that showed its message on both
 * fields would blame the name for a bad parent. Passing the field is the check.
 */
function headerError(
  outcome: PlannerOutcome,
  field: 'name' | 'parent',
): string | undefined {
  return outcome.kind === 'header-invalid' && outcome.field === field ? outcome.message : undefined;
}
