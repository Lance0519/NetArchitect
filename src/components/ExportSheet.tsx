/**
 * Export Sheet.
 *
 * Target selector, live preview (scrollable monospace), Copy / Share /
 * Save-as-file actions.
 *
 * The app never executes anything. No shell, no SSH, no network calls.
 */

import { useMemo, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';
import { useSnackbar } from './Snackbar';
import { TextField } from './TextField';
import { exportPlan, EXPORT_TARGETS } from '@/core/config-exporter';
import type { ExportTarget, NetworkPlan } from '@/types/network';

export interface ExportSheetProps {
  readonly visible: boolean;
  readonly plan: NetworkPlan;
  readonly onClose: () => void;
}

const TARGET_LABELS: Record<ExportTarget, string> = {
  'cisco-ios': 'Cisco',
  'linux-iptables': 'iptables',
  'linux-netplan': 'Netplan',
  mikrotik: 'MikroTik',
  terraform: 'Terraform',
  markdown: 'Markdown',
  json: 'JSON',
};

const TARGET_EXTENSIONS: Record<ExportTarget, { readonly ext: string; readonly mime: string }> = {
  'cisco-ios': { ext: 'cfg', mime: 'text/plain' },
  'linux-iptables': { ext: 'sh', mime: 'text/x-shellscript' },
  'linux-netplan': { ext: 'yaml', mime: 'text/yaml' },
  mikrotik: { ext: 'rsc', mime: 'text/plain' },
  terraform: { ext: 'tf', mime: 'text/plain' },
  markdown: { ext: 'md', mime: 'text/markdown' },
  json: { ext: 'json', mime: 'application/json' },
};

function buildExportFileName(planName: string, target: ExportTarget): string {
  const slug =
    planName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'netarchitect-plan';
  return `${slug}-${target}.${TARGET_EXTENSIONS[target].ext}`;
}

function triggerWebDownload(fileName: string, content: string, mimeType: string): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Browser download APIs are unavailable.');
  }
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  doc.body.appendChild(link);
  link.click();
  doc.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ExportSheet({ visible, plan, onClose }: ExportSheetProps) {
  const [target, setTarget] = useState<ExportTarget>('cisco-ios');
  const [subinterfaceTemplate, setSubinterfaceTemplate] = useState('GigabitEthernet0/0.{vlan}');
  const { showSnackbar } = useSnackbar();

  const preview = useMemo(() => {
    if (!visible || !plan) return '';
    return exportPlan(plan, target, { subinterfaceTemplate });
  }, [visible, plan, target, subinterfaceTemplate]);

  const handleTargetChange = (newTarget: ExportTarget) => {
    setTarget(newTarget);
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(preview);
      showSnackbar('Copied configuration to clipboard');
    } catch {
      showSnackbar('Could not copy to clipboard');
    }
  };

  const handleShare = async () => {
    const fileName = buildExportFileName(plan.name, target);
    const { mime } = TARGET_EXTENSIONS[target];

    try {
      if (Platform.OS === 'web') {
        triggerWebDownload(fileName, preview, mime);
        showSnackbar(`Downloaded ${fileName}`);
        return;
      }

      if (!(await Sharing.isAvailableAsync())) {
        showSnackbar('Sharing is not available on this device');
        return;
      }

      const file = new File(Paths.cache, fileName);
      file.write(preview);
      await Sharing.shareAsync(file.uri, {
        mimeType: mime,
        dialogTitle: `Share ${fileName}`,
      });
    } catch {
      showSnackbar('Could not share configuration file');
    }
  };

  const handleSave = async () => {
    const fileName = buildExportFileName(plan.name, target);
    const { mime } = TARGET_EXTENSIONS[target];

    try {
      if (Platform.OS === 'web') {
        triggerWebDownload(fileName, preview, mime);
        showSnackbar(`Downloaded ${fileName}`);
        return;
      }

      const file = new File(Paths.document, fileName);
      file.write(preview);
      showSnackbar(`Saved ${fileName}`);
    } catch {
      showSnackbar('Could not save configuration file');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Export Configuration">
      <View className="gap-4">
        {/* Target selector (horizontally scrollable so 7 targets stay legible on narrow screens) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedControl
            label="Export target"
            value={target}
            onChange={handleTargetChange}
            options={EXPORT_TARGETS.map((t) => ({
              value: t,
              label: TARGET_LABELS[t] ?? t,
            }))}
          />
        </ScrollView>

        {/* Interface template (Cisco only) */}
        {target === 'cisco-ios' && (
          <Card padding="md">
            <View className="gap-2">
              <AppText variant="caption" tone="muted">
                INTERFACE TEMPLATE
              </AppText>
              <TextField
                label="Subinterface template"
                value={subinterfaceTemplate}
                onChangeText={setSubinterfaceTemplate}
                placeholder="GigabitEthernet0/0.{vlan}"
                mono
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              <AppText variant="caption" tone="faint">
                {'Use {vlan} as a placeholder for the VLAN ID.'}
              </AppText>
            </View>
          </Card>
        )}

        {/* Preview */}
        <Card padding="md">
          <View className="gap-2">
            <AppText variant="caption" tone="muted">
              PREVIEW
            </AppText>
            <ScrollView className="max-h-64 rounded-control bg-surface-inset p-2">
              <AppText mono variant="caption" tone="primary">
                {preview}
              </AppText>
            </ScrollView>
          </View>
        </Card>

        {/* Actions */}
        <View className="flex-row gap-2">
          <Button variant="secondary" onPress={() => void handleCopy()} className="flex-1">
            Copy
          </Button>
          {Platform.OS !== 'web' ? (
            <Button variant="secondary" onPress={() => void handleShare()} className="flex-1">
              Share
            </Button>
          ) : null}
          <Button variant="primary" onPress={() => void handleSave()} className="flex-1">
            {Platform.OS === 'web' ? 'Download' : 'Save'}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}
