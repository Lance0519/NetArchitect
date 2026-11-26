/**
 * VLSM Allocator - Guided Workflow.
 *
 * The centerpiece of the application, designed as a guided workflow:
 * 1. Enter parent network
 * 2. Define requirements (name, hosts, role)
 * 3. Calculate VLSM
 * 4. Review results
 *
 * Design principles:
 * - Step indicator shows progress
 * - Requirements as clean editable cards
 * - Results as visual dashboard with address space bar
 * - Progressive disclosure: summary first, details expandable
 */

import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { CircleDashed, ClipboardCheck, RotateCcw, Send } from 'lucide-react-native';

import {
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Screen,
  SubnetBar,
  SubnetCard,
  SubnetTable,
  TextField,
  VlsmRequirementList,
  showSnackbar,
} from '@/components';
import { evaluateVlsm } from '@/core/vlsm-input';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useVlsmStore } from '@/store/vlsm-store';
import { buildVlsmText, buildVlsmView, outcomeNotice } from '@/utils/vlsm-view';

const EMPTY_MESSAGES: ReadonlyMap<string, string> = new Map();

export default function VlsmScreen() {
  const draft = useVlsmStore((state) => state.draft);
  const setParent = useVlsmStore((state) => state.setParent);
  const updateRow = useVlsmStore((state) => state.updateRow);
  const addRow = useVlsmStore((state) => state.addRow);
  const removeRow = useVlsmStore((state) => state.removeRow);
  const moveRow = useVlsmStore((state) => state.moveRow);
  const reset = useVlsmStore((state) => state.reset);
  const stageHandoff = useVlsmStore((state) => state.stageHandoff);

  const settled = useDebouncedValue(draft);
  const outcome = useMemo(() => evaluateVlsm(settled), [settled]);
  const view = useMemo(() => (outcome.kind === 'ok' ? buildVlsmView(outcome.result) : null), [outcome]);
  const notice = outcomeNotice(outcome);

  const copyAll = useCallback(() => {
    if (outcome.kind !== 'ok') return;
    void Clipboard.setStringAsync(buildVlsmText(outcome.result));
    showSnackbar('Allocation table copied to clipboard');
  }, [outcome]);

  const sendToPlanner = useCallback(() => {
    if (!stageHandoff()) return;
    router.push('/planner');
  }, [stageHandoff]);

  return (
    <Screen
      title="VLSM Allocator"
      subtitle="Fit variable-length subnets into a parent block."
      back={false}
      width="full"
      scroll
    >
      <View className="gap-4">
        {/* Parent Network Input */}
        <Card padding="md">
          <View className="gap-3">
            <AppText variant="label" tone="muted">
              PARENT NETWORK
            </AppText>
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
              hint="The block every subnet must fit inside."
              error={outcome.kind === 'parent-invalid' ? outcome.message : undefined}
            />
          </View>
        </Card>

        {/* Requirements */}
        <VlsmRequirementList
          rows={draft.rows}
          errors={outcome.kind === 'rows-invalid' ? outcome.messages : EMPTY_MESSAGES}
          suggestion={outcome.kind === 'exhausted' ? outcome.suggestion : null}
          culpritId={outcome.kind === 'exhausted' ? outcome.culpritId : null}
          onChange={updateRow}
          onAdd={addRow}
          onRemove={removeRow}
          onMove={moveRow}
        />

        {/* Empty State */}
        {outcome.kind === 'empty' ? (
          <EmptyState
            icon={CircleDashed}
            title="No requirements yet"
            description="Add a row for each thing that needs addresses - a student LAN, a server block, a link to a branch office."
          />
        ) : null}

        {/* Notices */}
        {notice === null ? null : (
          <Banner tone={notice.kind === 'warn' ? 'error' : 'info'} title={notice.title}>
            <AppText variant="caption">{notice.body}</AppText>
          </Banner>
        )}

        {/* Results */}
        {view === null ? null : (
          <>
            {/* Educational & engineering notices (RFC 3021 /31, RFC 7600 alignment, fullness) */}
            {view.notices.map((item) => (
              <Banner
                key={item.title}
                tone={item.kind === 'warn' ? 'warn' : 'info'}
                title={item.citation ? `${item.title} · ${item.citation}` : item.title}
              >
                {item.body}
              </Banner>
            ))}

            {/* Address Space Visualization */}
            <Card padding="md">
              <View className="gap-3">
                <AppText variant="label" tone="muted">
                  ADDRESS SPACE
                </AppText>
                <AppText mono variant="title" tone="primary">
                  {view.summary.parentCidr}
                </AppText>
                <SubnetBar
                  segments={view.segments}
                  parentCidr={view.summary.parentCidr}
                  summary={barSummary(view)}
                />
              </View>
            </Card>

            {/* Summary Stats & Free Ranges */}
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

                {view.summary.freeRanges.length > 0 ? (
                  <View className="gap-1.5 border-t border-line-subtle pt-3">
                    <AppText variant="caption" tone="muted">
                      REMAINING FREE BLOCKS ({view.summary.freeRanges.length})
                    </AppText>
                    <View className="flex-row flex-wrap gap-2">
                      {view.summary.freeRanges.map((free) => (
                        <Badge
                          key={free.cidr}
                          tone={free.isFragmented ? 'medium' : 'neutral'}
                        >
                          {`${free.cidr} (${free.addresses})`}
                        </Badge>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            </Card>

            {/* Subnet Cards */}
            <View className="gap-2">
              <AppText variant="label" tone="muted">
                ALLOCATED SUBNETS
              </AppText>
              <View className="gap-2">
                {view.rows.map((row) => (
                  <SubnetCard
                    key={row.id}
                    name={row.name}
                    cidr={row.cidr}
                    capacity={row.capacity}
                    requested={row.requested}
                    utilization={row.utilisation}
                    role={row.roleLabel}
                    isUntrusted={row.isUntrusted}
                  />
                ))}
              </View>
            </View>

            {/* Detailed Table */}
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <AppText variant="label" tone="muted">
                  ALLOCATION TABLE
                </AppText>
                <AppText variant="caption" tone="faint">
                  Scroll the table sideways for the address columns
                </AppText>
              </View>
              <SubnetTable rows={view.rows} />
            </View>

            {/* Actions */}
            <Card padding="lg">
              <View className="gap-2">
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
                <Button
                  variant="ghost"
                  size="sm"
                  block
                  icon={<RotateCcw size={16} strokeWidth={2} />}
                  onPress={reset}
                >
                  Reset allocator
                </Button>
              </View>
            </Card>

            <AppText variant="caption" tone="faint" className="text-center py-2">
              Allocated on this device. NetArchitect never connects to a network.
            </AppText>
          </>
        )}
      </View>
    </Screen>
  );
}

function barSummary(view: ReturnType<typeof buildVlsmView>): string {
  const allocated = view.summary.figures.find((f) => f.label === 'Allocated')?.value ?? '0';
  const free = view.summary.figures.find((f) => f.label === 'Free')?.value ?? '0';
  const count = view.summary.subnetCount;
  return `${count} ${count === 1 ? 'subnet' : 'subnets'}, ${allocated} addresses allocated, ${free} free`;
}
