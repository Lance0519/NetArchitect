/**
 * Binary Subnet Splitter Tool View.
 *
 * Standalone network utility to split and merge subnets recursively along
 * binary power-of-two boundaries.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Copy,
  GitFork,
  Minimize2,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native';

import { AppText, Badge, Button, Card, TextField } from '@/components';
import {
  createSubnetTree,
  getActiveLeafSubnets,
  mergeSubnetNode,
  splitSubnetNode,
  type SubnetTree,
} from '@/core/splitter-engine';

const SPLITTER_PRESETS = [
  { label: 'Class C (/24)', cidr: '192.168.1.0/24' },
  { label: 'Branch Block (/22)', cidr: '172.16.0.0/22' },
  { label: 'Campus Block (/20)', cidr: '10.0.0.0/20' },
] as const;

export function SubnetSplitterView() {
  const [rootInput, setRootInput] = useState('192.168.1.0/24');
  const [tree, setTree] = useState<SubnetTree>(() => createSubnetTree('192.168.1.0/24'));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleInitRoot = (cidr: string) => {
    try {
      const nextTree = createSubnetTree(cidr);
      setRootInput(cidr);
      setTree(nextTree);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSplit = (nodeId: string) => {
    setTree((prev) => splitSubnetNode(prev, nodeId));
  };

  const handleMerge = (parentId: string) => {
    setTree((prev) => mergeSubnetNode(prev, parentId));
  };

  const handleReset = () => {
    handleInitRoot(rootInput);
  };

  const leaves = getActiveLeafSubnets(tree);

  const totalUsable = leaves.reduce((acc, leaf) => acc + leaf.usableHosts, 0);

  const handleCopyAll = () => {
    const text = leaves.map((l) => `${l.cidr} - ${l.usableHosts} usable hosts`).join('\n');
    void Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View className="gap-4">
      {/* Presets */}
      <Card padding="md" className="gap-2">
        <View className="flex-row items-center gap-1.5">
          <Sparkles size={16} strokeWidth={2} className="text-accent" />
          <AppText variant="label" tone="muted">
            ROOT BLOCK PRESETS
          </AppText>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {SPLITTER_PRESETS.map((p) => (
            <Pressable
              key={p.label}
              accessibilityRole="button"
              accessibilityLabel={`Select root block ${p.label}`}
              onPress={() => handleInitRoot(p.cidr)}
              className="rounded-pill border border-line bg-surface-raised px-3 py-1.5 active:bg-accent"
            >
              <AppText variant="caption" tone="accent" className="font-medium">
                {p.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </Card>

      {/* Root input */}
      <Card padding="md" className="gap-3">
        <TextField
          label="Root Network Block"
          value={rootInput}
          onChangeText={(val) => {
            setRootInput(val);
            try {
              setTree(createSubnetTree(val));
              setError(null);
            } catch {
              // Ignore while typing
            }
          }}
          placeholder="192.168.1.0/24"
          mono
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          error={error ?? undefined}
          hint="Start with any parent block. Tap 'Split' below to slice it into smaller subnets."
        />
      </Card>

      {/* Summary */}
      <Card padding="md" className="gap-2">
        <View className="flex-row items-center justify-between">
          <View className="gap-0.5">
            <AppText variant="label" tone="muted">
              ACTIVE SUBDIVISIONS
            </AppText>
            <AppText variant="title" tone="primary">
              {leaves.length} subnet{leaves.length === 1 ? '' : 's'}
            </AppText>
          </View>
          <View className="items-end gap-0.5">
            <AppText variant="label" tone="muted">
              USABLE CAPACITY
            </AppText>
            <AppText mono variant="subheading" tone="accent">
              {totalUsable.toLocaleString()} hosts
            </AppText>
          </View>
        </View>
      </Card>

      {/* Subnet Slices List */}
      <View className="gap-2.5">
        {leaves.map((leaf) => {
          const canSplit = leaf.prefix < 32;
          const parentNode = leaf.parentId ? tree.nodes.get(leaf.parentId) : null;
          const canMerge = parentNode !== null && parentNode !== undefined && parentNode.isSplit;

          return (
            <Card key={leaf.id} padding="md" className="gap-2.5 border-line-subtle bg-surface-raised">
              <View className="flex-row items-center justify-between flex-wrap gap-2">
                <View className="gap-0.5">
                  <AppText mono variant="title" tone="primary">
                    {leaf.cidr}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {leaf.networkAddress} – {leaf.broadcastAddress}
                  </AppText>
                </View>
                <Badge tone="medium">
                  {`${leaf.usableHosts.toLocaleString()} usable hosts`}
                </Badge>
              </View>

              {/* Split & Merge controls */}
              <View className="flex-row items-center gap-2 pt-1 border-t border-line-subtle">
                {canSplit ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    icon={<GitFork size={14} strokeWidth={2} />}
                    onPress={() => handleSplit(leaf.id)}
                  >
                    {`Split into two /${leaf.prefix + 1}s`}
                  </Button>
                ) : null}

                {canMerge && leaf.parentId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    icon={<Minimize2 size={14} strokeWidth={2} />}
                    onPress={() => handleMerge(leaf.parentId!)}
                  >
                    {`Merge to /${leaf.prefix - 1}`}
                  </Button>
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>

      {/* Global Actions */}
      <View className="flex-row gap-2 pt-2">
        <Button
          variant="secondary"
          className="flex-1"
          icon={<RotateCcw size={16} strokeWidth={2} />}
          onPress={handleReset}
        >
          Reset Tree
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          icon={<Copy size={16} strokeWidth={2} />}
          onPress={handleCopyAll}
        >
          {copied ? 'Copied ✓' : 'Copy All Subnets'}
        </Button>
      </View>
    </View>
  );
}
