/**
 * Configuration export.
 *
 * Exports a plan to a text file via expo-file-system + expo-sharing.
 * JSON payload includes the full plan, its parentCidr, and an export timestamp.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { NetworkPlan } from '@/types/network';

/** The export file format version. */
export const EXPORT_VERSION = 1;

/** Get the cache directory, with fallback. */
const getCacheDir = (): string => {
  // expo-file-system uses FileSystem.cacheDirectory as a string property
  return (FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory ?? '';
};

/** Export a plan to a JSON file and share it. */
export async function exportPlan(plan: NetworkPlan): Promise<void> {
  const exportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    plan: {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      parentCidr: plan.parentCidr,
      profile: plan.profile,
      subnets: plan.subnets.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        customRoleLabel: s.customRoleLabel,
        vlanId: s.vlanId,
        cidr: s.cidr,
        gateway: s.gateway,
        requestedHosts: s.requestedHosts,
        sortOrder: s.sortOrder,
      })),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    },
  };

  const json = JSON.stringify(exportData, null, 2);

  // Write to a temporary file
  const cacheDir = getCacheDir();
  if (!cacheDir) throw new Error('No cache directory available');
  const fileName = `netarchitect-${plan.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.json`;
  const fileUri = `${cacheDir}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });

  // Share the file
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Export NetArchitect Plan',
      UTI: 'public.json',
    });
  } else {
    throw new Error('Sharing is not available on this platform');
  }
}

/** Import a plan from a JSON file. */
export async function importPlan(fileUri: string): Promise<NetworkPlan | null> {
  try {
    const content = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.UTF8 });
    const data = JSON.parse(content);

    if (data.version !== EXPORT_VERSION) {
      throw new Error(`Unsupported export version: ${data.version}`);
    }

    if (!data.plan || !data.plan.id) {
      throw new Error('Invalid export file: missing plan data');
    }

    return data.plan;
  } catch (e) {
    throw new Error(`Failed to import plan: ${(e as Error).message}`);
  }
}

/** Generate a human-readable text export for the plan. */
export function generateTextExport(plan: NetworkPlan): string {
  const lines: string[] = [];
  lines.push(`NetArchitect Plan Export`);
  lines.push(`========================`);
  lines.push(``);
  lines.push(`Plan: ${plan.name}`);
  lines.push(`Description: ${plan.description || '(none)'}`);
  lines.push(`Parent CIDR: ${plan.parentCidr}`);
  lines.push(`Profile: ${plan.profile}`);
  lines.push(`Subnets: ${plan.subnets.length}`);
  lines.push(`Created: ${new Date(plan.createdAt).toISOString()}`);
  lines.push(`Updated: ${new Date(plan.updatedAt).toISOString()}`);
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`SUBNETS`);
  lines.push(`-------`);

  for (const subnet of plan.subnets) {
    lines.push(``);
    lines.push(`Name: ${subnet.name}`);
    lines.push(`Role: ${subnet.role}${subnet.customRoleLabel ? ` (${subnet.customRoleLabel})` : ''}`);
    lines.push(`CIDR: ${subnet.cidr}`);
    lines.push(`Gateway: ${subnet.gateway || '(none)'}`);
    lines.push(`VLAN: ${subnet.vlanId !== undefined ? subnet.vlanId : '(untagged)'}`);
    lines.push(`Requested Hosts: ${subnet.requestedHosts}`);
    lines.push(`Sort Order: ${subnet.sortOrder}`);
  }

  return lines.join('\n');
}

/** Export to a text file and share. */
export async function exportPlanText(plan: NetworkPlan): Promise<void> {
  const text = generateTextExport(plan);
  const cacheDir = getCacheDir();
  if (!cacheDir) throw new Error('No cache directory available');
  const fileName = `netarchitect-${plan.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.txt`;
  const fileUri = `${cacheDir}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/plain',
      dialogTitle: 'Export NetArchitect Plan (Text)',
      UTI: 'public.plain-text',
    });
  } else {
    throw new Error('Sharing is not available on this platform');
  }
}