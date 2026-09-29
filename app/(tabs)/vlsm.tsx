/**
 * VLSM Allocator.
 *
 * Requirements in, a provably-correct allocation out.
 *
 * ## Where the logic went, and why
 *
 * Three pure modules, all tested with no render mock:
 *
 *   `@/core/vlsm-input`   draft text -> empty | parent-invalid | rows-invalid |
 *                         exhausted | ok, plus the row add/move/remove operations
 *   `@/core/vlsm-engine`  the packer itself, built in Phase 3
 *   `@/utils/vlsm-view`   a result -> table rows, summary figures, notices, bar segments
 *
 * R4 declined a component-test runner, so the Phase 7 exit criteria - "the spec example
 * reproduces exactly" and "exhaustion is recoverable" - are only checkable if the output
 * exists as a value Vitest can reach. This file is the thin remainder that connects
 * them. It contains one `switch`, no arithmetic, and no decisions about what a number
 * should be.
 *
 * ## React Hook Form: still not used, and this is the phase that was supposed to use it
 *
 * Recorded, because the plan names it for this screen and it is not here. The thing RHF
 * plus `useFieldArray` would have solved is a growing, reorderable list of rows - and
 * that list is four pure functions over an immutable draft, each tested directly in
 * `tests/vlsm-view.test.ts`. `useFieldArray` is a way to manage that state; it is not
 * the reason the state is correct.
 *
 * The thing it would have added is a subscription per field, a resolver, and a second
 * validation path that has to agree with `evaluateVlsm`. Two validation paths on one
 * screen is how a row ends up showing an error the allocation ignored.
 *
 * Phase 8 changes this. The planner has a plan name, a description, a profile and a
 * gateway per row, and it *saves*. That is a submit-time validation problem rather than a
 * live-preview one, which is what RHF is actually good at. Recorded in `PLAN.md` as a
 * Phase 7 deviation rather than quietly skipped.
 *
 * ## One switch, no fall-through
 *
 * The five outcomes are mutually exclusive and exhaustive, so the render is a chain of
 * ternaries keyed on `outcome.kind`. There is no branch where a state falls through and
 * the user sees a form with no explanation of why nothing appeared below it.
 *
 * ## The draft is in a store, the evaluation is not
 *
 * `useVlsmStore` holds the text so switching tabs does not discard a half-built plan. The
 * allocation is recomputed here, from the debounced draft, and never stored - a cached
 * allocation would be one keystroke behind the requirements above it.
 */

import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { CircleDashed, ClipboardCheck, Send } from 'lucide-react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  EmptyState,
  Screen,
  SubnetBar,
  SubnetTable,
  TextField,
  VlsmRequirementList,
} from '@/components';
import { evaluateVlsm } from '@/core/vlsm-input';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useVlsmStore } from '@/store/vlsm-store';
import { buildVlsmText, buildVlsmView, outcomeNotice } from '@/utils/vlsm-view';

export default function VlsmScreen() {
  const draft = useVlsmStore((state) => state.draft);
  const setParent = useVlsmStore((state) => state.setParent);
  const updateRow = useVlsmStore((state) => state.updateRow);
  const addRow = useVlsmStore((state) => state.addRow);
  const removeRow = useVlsmStore((state) => state.removeRow);
  const moveRow = useVlsmStore((state) => state.moveRow);
  const stageHandoff = useVlsmStore((state) => state.stageHandoff);

  /**
   * The draft is typed immediately; the allocation waits for the typing to settle.
   *
   * "100" packs three different subnets on the way in - 1 host, 10 hosts, 100 hosts - and
   * without this the table would rearrange itself under the user's finger. See
   * `useDebouncedValue` for why the delay is on the value and not on the input.
   */
  const settled = useDebouncedValue(draft);
  const outcome = useMemo(() => evaluateVlsm(settled), [settled]);

  /**
   * The built view, computed during render.
   *
   * A `useEffect` feeding a `useState` would make this one frame stale, which is exactly
   * the bug class the Phase 6 screen was written to avoid.
   */
  const view = useMemo(() => (outcome.kind === 'ok' ? buildVlsmView(outcome.result) : null), [
    outcome,
  ]);

  const notice = outcomeNotice(outcome);

  const copyAll = useCallback(() => {
    if (outcome.kind !== 'ok') return;
    void Clipboard.setStringAsync(buildVlsmText(outcome.result));
  }, [outcome]);

  const sendToPlanner = useCallback(() => {
    // Staging returns false when there is nothing valid to hand over, so the button can
    // never navigate to an empty planner pretending the hand-off worked.
    if (!stageHandoff()) return;
    router.push('/planner');
  }, [stageHandoff]);

  return (
    <Screen
      title="VLSM Allocator"
      subtitle="Fit variable-length subnets into a parent block, with no overlaps."
      // `full`, not `form`: the table is ten columns wide and the non-scrolling layout
      // only earns its keep if the screen is allowed to be as wide as the window.
      width="full"
      scroll
    >
      <View className="gap-4">
        <TextField
          label="Parent block"
          value={draft.parent}
          onChangeText={setParent}
          placeholder="192.168.1.0/24"
          mono
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="numbers-and-punctuation"
          // No split mode here, unlike the calculator. A parent block is a single
          // concept, and offering a prefix-only entry would mean accepting `24` and
          // guessing what it is relative to.
          hint="The block every subnet must fit inside. A host address is accepted and normalised."
          error={outcome.kind === 'parent-invalid' ? outcome.message : undefined}
        />

        <VlsmRequirementList
          rows={draft.rows}
          errors={outcome.kind === 'rows-invalid' ? outcome.messages : EMPTY_MESSAGES}
          suggestion={outcome.kind === 'exhausted' ? outcome.suggestion : null}
          culpritId={outcome.kind === 'exhausted' ? outcome.culpritId : null}
          onChange={updateRow}
          onAdd={() => {
            addRow();
          }}
          onRemove={removeRow}
          onMove={moveRow}
        />

        {/*
          A total switch, so no state falls through and leaves the user with a form and
          no explanation. `empty` gets no banner: the screen has its own empty state with
          copy written for the condition, and two messages for one state is one too many.
        */}
        {outcome.kind === 'empty' ? (
          <EmptyState
            icon={CircleDashed}
            title="No requirements yet"
            description="Add a row for each thing that needs addresses - a student LAN, a server block, a link to a branch office - and give each one a name and a host count. The allocation appears here as you type, and every subnet is aligned to its own size so none of them lands off a network boundary."
          />
        ) : null}

        {notice === null ? null : (
          <Banner tone={notice.kind === 'warn' ? 'error' : 'info'} title={notice.title}>
            <AppText variant="caption">{notice.body}</AppText>
          </Banner>
        )}

        {view === null ? null : (
          <>
            <SubnetBar
              segments={view.segments}
              parentCidr={view.summary.parentCidr}
              summary={barSummary(view)}
            />

            {view.notices.map((item) => (
              <Banner
                key={item.title}
                tone={item.kind === 'warn' ? 'error' : 'info'}
                title={item.title}
              >
                <AppText variant="caption">
                  {item.body}
                  {item.citation === '' ? '' : ` (${item.citation})`}
                </AppText>
              </Banner>
            ))}

            <Card padding="lg">
              <View className="gap-3">
                <AppText variant="label" tone="muted">
                  SUMMARY
                </AppText>

                <View className="flex-row flex-wrap gap-4">
                  {view.summary.figures.map((figure) => (
                    <View key={figure.label} className="min-w-[40%] flex-1 gap-0.5">
                      <AppText variant="caption" tone="faint">
                        {figure.label}
                      </AppText>
                      <AppText variant="title" tone="primary" mono={figure.mono}>
                        {figure.value}
                      </AppText>
                      {figure.detail === null ? null : (
                        <AppText variant="caption" tone="faint">
                          {figure.detail}
                        </AppText>
                      )}
                    </View>
                  ))}
                </View>

                {view.summary.freeRanges.length === 0 ? null : (
                  <View className="gap-1.5">
                    <AppText variant="label" tone="muted">
                      FREE SPACE
                    </AppText>
                    {view.summary.freeRanges.map((free) => (
                      <View
                        key={free.cidr}
                        className="flex-row items-center justify-between gap-2"
                      >
                        <AppText variant="caption" tone="primary" mono>
                          {free.cidr}
                        </AppText>
                        <AppText variant="caption" tone="faint" mono>
                          {free.range} · {free.addresses}
                        </AppText>
                      </View>
                    ))}
                    {/*
                      Fragmented runs are listed but not offered as usable space. A /28 of
                      stranded addresses is a genuine result of alignment, and hiding it
                      would make the free total look wrong; presenting it as somewhere to
                      plan a subnet would be a lie.
                    */}
                    {view.summary.freeRanges.some((free) => free.isFragmented) ? (
                      <AppText variant="caption" tone="medium">
                        Some of these runs are too small to hold a subnet worth planning.
                      </AppText>
                    ) : null}
                  </View>
                )}
              </View>
            </Card>

            <View className="gap-2">
              <AppText variant="label" tone="muted">
                ALLOCATION
              </AppText>
              <SubnetTable rows={view.rows} />
              <AppText variant="caption" tone="faint">
                Scroll the table sideways for the address columns. Requested against
                capacity is the pair worth reading: a block far larger than its
                requirement is the usual sign of a size that was rounded up.
              </AppText>
            </View>

            <Card padding="lg">
              <View className="gap-2">
                {/*
                  A real hand-off, not a copy and paste. The allocation is staged in the
                  store and the planner opens on it, so the next step continues from what
                  is on screen rather than from a re-derivation that could disagree.
                */}
                <Button
                  variant="primary"
                  block
                  icon={<Send size={16} strokeWidth={2} />}
                  onPress={sendToPlanner}
                >
                  Send to Network Planner
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  block
                  icon={<ClipboardCheck size={16} strokeWidth={2} />}
                  onPress={copyAll}
                >
                  Copy as a table
                </Button>
              </View>
            </Card>

            <AppText variant="caption" tone="faint">
              Allocated on this device. NetArchitect never connects to a network.
            </AppText>
          </>
        )}
      </View>
    </Screen>
  );
}

/** No row errors when there is no row-error state. A shared, stable empty map. */
const EMPTY_MESSAGES: ReadonlyMap<string, string> = new Map();

/**
 * The bar's spoken summary, in one sentence.
 *
 * Reads the figures the view model already formatted rather than recomputing from the
 * result, so the spoken number and the visible number cannot disagree. Returns a
 * complete sentence on every path, because a partially-filled label is announced
 * verbatim and "undefined addresses" is worse than silence.
 */
function barSummary(view: ReturnType<typeof buildVlsmView>): string {
  const allocated = view.summary.figures.find((f) => f.label === 'Allocated')?.value ?? '0';
  const free = view.summary.figures.find((f) => f.label === 'Free')?.value ?? '0';
  const count = view.summary.subnetCount;
  return `${count} ${count === 1 ? 'subnet' : 'subnets'}, ${allocated} addresses allocated, ${free} free`;
}
