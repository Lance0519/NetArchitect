/**
 * IP Calculator.
 *
 * Redesigned for clarity and ease of use.
 * Shows a prominent result card with network information.
 * Advanced details are in an expandable section.
 *
 * Design principles:
 * - Information hierarchy: network address first, then details
 * - Progressive disclosure: basic info visible, advanced expandable
 * - Touch-friendly: large input fields, clear buttons
 * - Monospace for all technical values
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ChevronDown, ChevronUp, ClipboardCheck, Copy } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  AppText,
  Banner,
  Card,
  CidrInput,
  IpResultCard,
  Screen,
  SegmentedControl,
} from '@/components';
import { Button } from '@/components/ui/Button';
import { RouteSummarizerView } from '@/components/tools/RouteSummarizerView';
import { SubnetSplitterView } from '@/components/tools/SubnetSplitterView';
import { evaluateCombined, type CalculatorOutcome } from '@/core/calculator-input';
import { classifyCalculatorOutcome } from '@/utils/subnet-view';

type ToolMode = 'calculator' | 'summarizer' | 'splitter';

const TOOL_OPTIONS = [
  { value: 'calculator' as const, label: 'Calculator' },
  { value: 'summarizer' as const, label: 'Summarizer' },
  { value: 'splitter' as const, label: 'Splitter' },
];

const TOOL_METADATA: Record<ToolMode, { title: string; subtitle: string }> = {
  calculator: {
    title: 'IP Calculator',
    subtitle: 'Calculate IPv4 subnet boundaries, masks, and hosts.',
  },
  summarizer: {
    title: 'Route Summarizer',
    subtitle: 'Aggregate subnets and detect unadvertised routing holes.',
  },
  splitter: {
    title: 'Subnet Splitter',
    subtitle: 'Binary tree visualization to recursively split & merge subnets.',
  },
};

const INITIAL_OUTCOME: CalculatorOutcome = evaluateCombined('');
const ACKNOWLEDGE_MS = 2200;

export default function CalculatorScreen() {
  const searchParams = useLocalSearchParams<{ tool?: string }>();
  const [userTool, setUserTool] = useState<ToolMode | null>(null);

  const toolMode: ToolMode =
    userTool ??
    (searchParams.tool === 'summarizer' || searchParams.tool === 'splitter'
      ? searchParams.tool
      : 'calculator');

  const [outcome, setOutcome] = useState<CalculatorOutcome>(INITIAL_OUTCOME);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const state = useMemo(() => classifyCalculatorOutcome(outcome), [outcome]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const acknowledge = useCallback((label: string) => {
    setCopiedLabel(label);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopiedLabel(null);
    }, ACKNOWLEDGE_MS);
  }, []);

  const handleCopy = useCallback(
    (label: string, value: string) => {
      void Clipboard.setStringAsync(value);
      acknowledge(label);
    },
    [acknowledge],
  );

  const copyAll = useCallback(
    (view: { readonly copyText: string }) => {
      void Clipboard.setStringAsync(view.copyText);
      acknowledge('the whole result');
    },
    [acknowledge],
  );

  const [inputCidr, setInputCidr] = useState('');

  const meta = TOOL_METADATA[toolMode];

  return (
    <Screen
      title={meta.title}
      subtitle={meta.subtitle}
      width="form"
      scroll
    >
      <View className="gap-4">
        {/* Tool selector */}
        <SegmentedControl
          label="Tool Mode"
          options={TOOL_OPTIONS}
          value={toolMode}
          onChange={setUserTool}
        />

        {toolMode === 'summarizer' ? (
          <RouteSummarizerView />
        ) : toolMode === 'splitter' ? (
          <SubnetSplitterView />
        ) : (
          <>
            <CidrInput onOutcome={setOutcome} value={inputCidr} onChange={setInputCidr} />

        {state.kind === 'empty' ? (
          <Card padding="md" className="gap-3">
            <AppText variant="subheading" tone="primary">
              Nothing to calculate yet
            </AppText>
            <AppText variant="caption" tone="muted">
              Enter an address above or tap an example to populate instantly:
            </AppText>
            <View className="flex-row flex-wrap gap-2 pt-1">
              {[
                { label: 'Standard LAN (/24)', cidr: '192.168.1.0/24' },
                { label: 'Small Office (/28)', cidr: '192.168.10.0/28' },
                { label: 'Point-to-Point (/30)', cidr: '10.0.0.0/30' },
                { label: 'RFC 3021 Link (/31)', cidr: '10.0.0.0/31' },
                { label: 'Enterprise Core (/16)', cidr: '10.0.0.0/16' },
                { label: 'Medium Branch (/22)', cidr: '172.16.0.0/22' },
              ].map((ex) => (
                <Pressable
                  key={ex.cidr}
                  accessibilityRole="button"
                  accessibilityLabel={`Load example ${ex.cidr}`}
                  onPress={() => setInputCidr(ex.cidr)}
                  className="rounded-pill border border-line bg-surface-raised px-3 py-1.5 active:bg-accent active:border-accent"
                >
                  <AppText variant="caption" tone="accent" mono>
                    {ex.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {state.kind === 'invalid' ? (
          <Banner tone="error" title="That is not a subnet I can read">
            <AppText variant="caption">{state.message}</AppText>
          </Banner>
        ) : null}

        {state.kind === 'ok' ? (
          <>
            <IpResultCard view={state.view} onCopy={handleCopy} />

            {/* Advanced Details Toggle */}
            <Card padding="none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showAdvanced ? 'Hide advanced details' : 'Show advanced details'}
                onPress={() => setShowAdvanced(!showAdvanced)}
                className="flex-row items-center justify-between px-4 py-3 active:bg-surface-raised"
              >
                <AppText variant="label" tone="muted">
                  MORE DETAILS
                </AppText>
                {showAdvanced ? (
                  <ChevronUp size={18} strokeWidth={2} className="text-ink-muted" />
                ) : (
                  <ChevronDown size={18} strokeWidth={2} className="text-ink-muted" />
                )}
              </Pressable>

              {showAdvanced ? (
                <View className="border-t border-line-subtle px-4 py-3">
                  <View className="gap-2">
                    {state.view.detail.map((row) => (
                      <View key={row.label} className="flex-row items-center justify-between">
                        <AppText variant="caption" tone="muted">
                          {row.label}
                        </AppText>
                        <AppText variant="caption" tone="primary" mono>
                          {row.value}
                        </AppText>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </Card>

            <Card padding="lg">
              <View className="gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  block
                  icon={<ClipboardCheck size={16} strokeWidth={2} />}
                  onPress={() => {
                    copyAll(state.view);
                  }}
                >
                  Copy everything
                </Button>

                {copiedLabel === null ? null : (
                  <AppText
                    variant="caption"
                    tone="success"
                    accessibilityLiveRegion="polite"
                  >
                    Copied {copiedLabel} to the clipboard.
                  </AppText>
                )}
              </View>
            </Card>

            <View className="flex-row items-center gap-1.5">
              <Copy
                size={13}
                strokeWidth={2}
                className="shrink-0 text-ink-faint"
                accessibilityElementsHidden
              />
              <AppText variant="caption" tone="faint" className="flex-1">
                Tap any row to copy its value.
              </AppText>
            </View>
          </>
        ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
