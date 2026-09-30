/**
 * Route Summarizer (Supernetting) Tool View.
 *
 * Standalone network utility to calculate the minimal summary route
 * across multiple subnets, analyzing routing efficiency and flagging
 * unadvertised routing "holes".
 */

import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  AlertTriangle,
  CheckCircle,
  Copy,
  Layers,
  Sparkles,
} from 'lucide-react-native';

import { AppText, Badge, Banner, Button, Card, ProgressBar, TextField } from '@/components';
import { summarizeRoutes, type RouteSummaryResult } from '@/core/supernet-engine';

const PRESETS = [
  {
    label: 'Contiguous /24s',
    subnets: '192.168.0.0/24\n192.168.1.0/24\n192.168.2.0/24\n192.168.3.0/24',
  },
  {
    label: 'With Routing Hole',
    subnets: '192.168.0.0/24\n192.168.1.0/24\n192.168.3.0/24',
  },
  {
    label: 'Dual Campus',
    subnets: '10.50.0.0/24\n10.50.1.0/24',
  },
] as const;

export function RouteSummarizerView() {
  const [inputText, setInputText] = useState<string>(PRESETS[0].subnets);
  const [copied, setCopied] = useState(false);

  const lines = useMemo(() => inputText.split('\n'), [inputText]);
  const outcome = useMemo(() => summarizeRoutes(lines), [lines]);

  const handleCopy = (val: string) => {
    void Clipboard.setStringAsync(val);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View className="gap-4">
      {/* Preset shortcuts */}
      <Card padding="md" className="gap-2">
        <View className="flex-row items-center gap-1.5">
          <Sparkles size={16} strokeWidth={2} className="text-accent" />
          <AppText variant="label" tone="muted">
            QUICK PRESETS
          </AppText>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Pressable
              key={p.label}
              accessibilityRole="button"
              accessibilityLabel={`Load preset ${p.label}`}
              onPress={() => setInputText(p.subnets)}
              className="rounded-pill border border-line bg-surface-raised px-3 py-1.5 active:bg-accent"
            >
              <AppText variant="caption" tone="accent" className="font-medium">
                {p.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </Card>

      {/* Input Field */}
      <Card padding="md" className="gap-2">
        <TextField
          label="Subnets to Summarize (one per line)"
          value={inputText}
          onChangeText={setInputText}
          placeholder="192.168.0.0/24&#10;192.168.1.0/24"
          multiline
          numberOfLines={5}
          mono
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          hint="Enter two or more IPv4 subnets to compute the optimal bounding supernet."
        />
      </Card>

      {/* Outcome states */}
      {outcome.kind === 'error' ? (
        <Banner tone="error" title="Invalid Subnet Input">
          <AppText variant="caption">{outcome.message}</AppText>
        </Banner>
      ) : null}

      {outcome.kind === 'empty' ? (
        <Card padding="lg" className="items-center justify-center gap-2">
          <Layers size={24} strokeWidth={1.5} className="text-ink-muted" />
          <AppText variant="subheading" tone="primary">
            No Subnets Entered
          </AppText>
          <AppText variant="caption" tone="muted">
            Enter a list of subnets above or tap a preset to calculate the summary route.
          </AppText>
        </Card>
      ) : null}

      {outcome.kind === 'ok' && outcome.result ? (
        <SummaryResults result={outcome.result} onCopy={handleCopy} copied={copied} />
      ) : null}
    </View>
  );
}

function SummaryResults({
  result,
  onCopy,
  copied,
}: {
  readonly result: RouteSummaryResult;
  readonly onCopy: (val: string) => void;
  readonly copied: boolean;
}) {
  return (
    <View className="gap-4">
      {/* Primary Summary Route Card */}
      <Card padding="lg" className="gap-3 border-accent/40 bg-surface-raised">
        <View className="flex-row items-center justify-between">
          <AppText variant="label" tone="accent">
            OPTIMAL SUPERNET / SUMMARY ROUTE
          </AppText>
          {copied ? (
            <Badge tone="success">Copied ✓</Badge>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy summary CIDR"
              onPress={() => onCopy(result.summaryCidr)}
              className="flex-row items-center gap-1"
            >
              <Copy size={14} className="text-accent" />
              <AppText variant="caption" tone="accent">
                Copy
              </AppText>
            </Pressable>
          )}
        </View>

        <View className="rounded-control bg-surface-inset p-3.5 border border-line-subtle items-center">
          <AppText mono variant="title" tone="accent" className="text-2xl font-bold">
            {result.summaryCidr}
          </AppText>
          <AppText variant="caption" tone="muted" className="mt-1">
            Aggregates {result.inputSubnetCount} subnets ({result.coveredAddresses} addresses)
          </AppText>
        </View>

        {/* Detailed Stats */}
        <View className="flex-row flex-wrap gap-3 pt-1">
          <View className="min-w-[45%] flex-1 gap-0.5">
            <AppText variant="caption" tone="faint">
              Network Address
            </AppText>
            <AppText mono variant="subheading" tone="primary">
              {result.networkAddress}
            </AppText>
          </View>
          <View className="min-w-[45%] flex-1 gap-0.5">
            <AppText variant="caption" tone="faint">
              Broadcast Address
            </AppText>
            <AppText mono variant="subheading" tone="primary">
              {result.broadcastAddress}
            </AppText>
          </View>
          <View className="min-w-[45%] flex-1 gap-0.5">
            <AppText variant="caption" tone="faint">
              Subnet Mask
            </AppText>
            <AppText mono variant="subheading" tone="primary">
              {result.subnetMask}
            </AppText>
          </View>
          <View className="min-w-[45%] flex-1 gap-0.5">
            <AppText variant="caption" tone="faint">
              Total Block Space
            </AppText>
            <AppText mono variant="subheading" tone="primary">
              {result.totalAddresses.toLocaleString()} IPs
            </AppText>
          </View>
        </View>

        {/* Efficiency */}
        <View className="gap-1.5 pt-2 border-t border-line-subtle">
          <View className="flex-row items-center justify-between">
            <AppText variant="caption" tone="muted">
              Route Aggregation Efficiency
            </AppText>
            <AppText mono variant="caption" tone={result.efficiencyPercent === 100 ? 'success' : 'medium'}>
              {result.efficiencyPercent}%
            </AppText>
          </View>
          <ProgressBar value={result.efficiencyPercent / 100} />
        </View>
      </Card>

      {/* Holes Detection */}
      {result.holeAddresses > 0 ? (
        <Card tone="medium" padding="md" className="gap-2.5">
          <View className="flex-row items-center gap-2">
            <AlertTriangle size={18} strokeWidth={2.5} className="text-medium" />
            <AppText variant="label" tone="primary">
              UNADVERTISED ROUTING HOLES ({result.holeAddresses} IPs)
            </AppText>
          </View>
          <AppText variant="caption" tone="muted">
            The summary route encompasses addresses that are not part of your input subnets.
            Ensure these unallocated blocks are not routed elsewhere to avoid black-holing traffic:
          </AppText>
          <View className="flex-row flex-wrap gap-2 pt-1">
            {result.holes.map((hole) => (
              <Badge key={hole} tone="high">
                {hole}
              </Badge>
            ))}
          </View>
        </Card>
      ) : (
        <Card padding="md" className="gap-2">
          <View className="flex-row items-center gap-2">
            <CheckCircle size={18} strokeWidth={2.5} className="text-success" />
            <AppText variant="label" tone="success">
              PERFECT AGGREGATION
            </AppText>
          </View>
          <AppText variant="caption" tone="muted">
            Zero routing holes. The summary route covers exactly 100% of the input subnets with no unallocated addresses.
          </AppText>
        </Card>
      )}

      {/* Actions */}
      <Button
        variant="secondary"
        block
        icon={<Copy size={16} strokeWidth={2} />}
        onPress={() => onCopy(result.summaryCidr)}
      >
        Copy Summary CIDR
      </Button>
    </View>
  );
}
