/**
 * Export Sheet.
 *
 * Target selector, live preview (scrollable monospace), Copy / Share /
 * Save-as-file actions.
 *
 * The app never executes anything. No shell, no SSH, no network calls.
 */

import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
  'mikrotik': 'MikroTik',
  'terraform': 'Terraform',
  'json': 'JSON',
};

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

  const handleTemplateChange = (e: { nativeEvent: { text: string } }) => {
    setSubinterfaceTemplate(e.nativeEvent.text);
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(preview);
    showSnackbar('Copied to clipboard');
  };

  const handleShare = async () => {
    const fileName = `${plan.name.replace(/\s+/g, '-').toLowerCase()}-config.txt`;
    const file = new File(Paths.cache, fileName);
    file.write(preview);
    await Sharing.shareAsync(file.uri);
  };

  const handleSave = async () => {
    const fileName = `${plan.name.replace(/\s+/g, '-').toLowerCase()}-config.txt`;
    const file = new File(Paths.document, fileName);
    file.write(preview);
    showSnackbar(`Saved to ${fileName}`);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Export Configuration">
      <View className="gap-4">
        {/* Target selector */}
        <SegmentedControl
          label="Export target"
          value={target}
          onChange={handleTargetChange}
          options={EXPORT_TARGETS.map((t) => ({
            value: t,
            label: TARGET_LABELS[t] ?? t,
          }))}
        />

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
                onChange={handleTemplateChange}
                placeholder="GigabitEthernet0/0.{vlan}"
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
          <Button variant="secondary" onPress={handleCopy} className="flex-1">
            Copy
          </Button>
          <Button variant="secondary" onPress={handleShare} className="flex-1">
            Share
          </Button>
          <Button variant="primary" onPress={handleSave} className="flex-1">
            Save
          </Button>
        </View>
      </View>
    </Sheet>
  );
}
