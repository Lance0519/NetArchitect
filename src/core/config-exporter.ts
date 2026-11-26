/**
 * Configuration Export.
 *
 * Pure string generation, so it is testable. Supports Cisco IOS, Linux
 * iptables (Zero Trust baseline), Linux Netplan YAML, MikroTik RouterOS,
 * Terraform / OpenTofu AWS VPC HCL, Markdown documentation table, and JSON.
 *
 * Every output (except raw JSON) begins with a properly commented banner
 * making it unmistakably a template, not a deployed config, unless the caller
 * explicitly sets `includeBanner: false`.
 *
 * The app never executes anything. No shell, no SSH, no network calls.
 */

import type { ExportOptions, ExportTarget, NetworkPlan, PlannedSubnet } from '../types/network';
import { ROLE_DEFINITION_BY_ROLE } from './roles';
import { CONFIG_TEMPLATE_BANNER_LINES } from './standards';
import { calculateSubnet, computeHostAllocation, integerToIPv4, parseCidr } from './ip-engine';

/** Current schema version for JSON export. */
const SCHEMA_VERSION = 1;

/** Format the template banner with a vendor-appropriate comment prefix. */
function bannerLines(commentPrefix: string, options: ExportOptions): string[] {
  if (options.includeBanner === false) return [];
  return [...CONFIG_TEMPLATE_BANNER_LINES.map((line) => `${commentPrefix}${line}`), ''];
}

/** Safely resolve a subnet's CIDR + SubnetInfo, returning null for incomplete draft rows. */
function tryResolveSubnet(subnet: PlannedSubnet) {
  try {
    const cidr = parseCidr(subnet.cidr);
    const info = calculateSubnet(cidr.ip, cidr.prefix);
    const network = integerToIPv4(info.networkAddress);
    const mask = integerToIPv4(info.subnetMask);
    const gatewayIp =
      subnet.gatewayMode === 'none'
        ? null
        : (subnet.gateway ?? integerToIPv4(info.firstUsableHost));
    return { cidr, info, network, mask, gatewayIp };
  } catch {
    return null;
  }
}

/** Generate Cisco IOS configuration. */
function generateCiscoConfig(plan: NetworkPlan, options: ExportOptions): string {
  const lines: string[] = [...bannerLines('! ', options)];

  // Group subnets by VLAN
  const vlanGroups = new Map<number, PlannedSubnet[]>();
  const untagged: PlannedSubnet[] = [];
  for (const subnet of plan.subnets) {
    if (subnet.vlanId !== undefined) {
      const group = vlanGroups.get(subnet.vlanId) ?? [];
      group.push(subnet);
      vlanGroups.set(subnet.vlanId, group);
    } else {
      untagged.push(subnet);
    }
  }

  const template = options.subinterfaceTemplate ?? 'GigabitEthernet0/0.{vlan}';

  // Generate sub-interface config per VLAN
  for (const [vlanId, subnets] of vlanGroups) {
    const interfaceName = template.replace('{vlan}', String(vlanId));

    lines.push(`interface ${interfaceName}`);
    lines.push(`  encapsulation dot1Q ${vlanId}`);

    for (const subnet of subnets) {
      const resolved = tryResolveSubnet(subnet);
      if (!resolved) {
        lines.push(`  ! Skipped ${subnet.name}: invalid CIDR (${subnet.cidr})`);
        continue;
      }
      lines.push(`  description ${subnet.name}`);
      if (resolved.gatewayIp !== null) {
        lines.push(`  ip address ${resolved.gatewayIp} ${resolved.mask}`);
      } else {
        lines.push('  no ip address');
      }
    }

    lines.push('  no shutdown');
    lines.push('!');
    lines.push('');
  }

  // Note untagged subnets (e.g. P2P links)
  for (const subnet of untagged) {
    const resolved = tryResolveSubnet(subnet);
    if (!resolved) continue;
    lines.push(`! Untagged segment: ${subnet.name} (${subnet.cidr})`);
    if (resolved.gatewayIp !== null) {
      lines.push(`!   ip address ${resolved.gatewayIp} ${resolved.mask}`);
    }
    lines.push('!');
    lines.push('');
  }

  // Access port example (using first VLAN as example)
  const firstVlan = vlanGroups.keys().next().value;
  if (firstVlan !== undefined) {
    lines.push('! Access port configuration (example)');
    lines.push('interface GigabitEthernet0/1');
    lines.push(`  switchport access vlan ${firstVlan}`);
    lines.push('  switchport mode access');
    lines.push('  no shutdown');
    lines.push('!');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Determine Zero Trust (NIST SP 800-207) forwarding policy from `src` to `dst`.
 *
 * - Untrusted segments (GUEST, IOT) are explicitly DROPPED from reaching internal networks.
 * - DMZ is explicitly DROPPED from initiating connections into internal/management segments.
 * - Non-management segments are explicitly DROPPED from reaching MANAGEMENT.
 * - MANAGEMENT is permitted to reach managed segments; LAN is permitted to reach SERVERS/VOIP.
 * - Remaining internal pairs stay default-deny with commented review templates.
 */
function classifyForwardPolicy(
  src: PlannedSubnet,
  dst: PlannedSubnet,
): { readonly action: 'ACCEPT' | 'DROP' | 'COMMENT'; readonly reason: string } {
  const srcDef = ROLE_DEFINITION_BY_ROLE[src.role];
  const dstDef = ROLE_DEFINITION_BY_ROLE[dst.role];

  if (srcDef.isUntrusted) {
    return {
      action: 'DROP',
      reason: `Zero Trust isolation (NIST SP 800-207): block untrusted ${src.role} -> ${dst.role}`,
    };
  }

  if (src.role === 'DMZ' && !dstDef.isUntrusted) {
    return {
      action: 'DROP',
      reason: 'NIST SP 800-41: deny DMZ-initiated connections to internal networks',
    };
  }

  if (dst.role === 'MANAGEMENT' && src.role !== 'MANAGEMENT') {
    return {
      action: 'DROP',
      reason: 'Zero Trust control-plane protection: restrict access to MANAGEMENT',
    };
  }

  if (src.role === 'MANAGEMENT') {
    return {
      action: 'ACCEPT',
      reason: 'Allow management plane to administer subnet (return traffic via conntrack)',
    };
  }

  if (src.role === 'LAN' && (dst.role === 'SERVERS' || dst.role === 'VOIP' || dst.role === 'DMZ')) {
    return {
      action: 'ACCEPT',
      reason: `Allow ${src.role} to initiate sessions to ${dst.role} (restrict ports before deploying)`,
    };
  }

  return {
    action: 'COMMENT',
    reason: `Default-deny: uncomment and scope to specific ports if ${src.role} -> ${dst.role} is needed`,
  };
}

/** Generate Linux iptables configuration with Zero Trust isolation defaults. */
function generateIptablesConfig(plan: NetworkPlan, options: ExportOptions): string {
  // Kernel requires `#!/bin/bash` strictly on line 1 before any comment banner.
  const lines: string[] = ['#!/bin/bash'];
  lines.push(...bannerLines('# ', options));
  lines.push('# NetArchitect iptables Zero Trust baseline (NIST SP 800-207)');
  lines.push('');

  // Flush existing rules
  lines.push('# Flush existing rules');
  lines.push('iptables -F');
  lines.push('iptables -X');
  lines.push('iptables -t nat -F');
  lines.push('');

  // Default policies
  lines.push('# Default policies (deny forwarded traffic unless explicitly allowed)');
  lines.push('iptables -P FORWARD DROP');
  lines.push('iptables -P INPUT ACCEPT');
  lines.push('iptables -P OUTPUT ACCEPT');
  lines.push('');

  // Allow established connections
  lines.push('# Allow established and related return traffic');
  lines.push('iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT');
  lines.push('');

  // Role-aware Zero Trust inter-subnet policies
  lines.push('# Role-aware inter-subnet policies');
  const resolvedList = plan.subnets
    .map((subnet) => ({ subnet, resolved: tryResolveSubnet(subnet) }))
    .filter((entry): entry is { subnet: PlannedSubnet; resolved: NonNullable<ReturnType<typeof tryResolveSubnet>> } => entry.resolved !== null);

  for (let i = 0; i < resolvedList.length; i += 1) {
    for (let j = 0; j < resolvedList.length; j += 1) {
      if (i === j) continue;
      const src = resolvedList[i]!;
      const dst = resolvedList[j]!;
      const policy = classifyForwardPolicy(src.subnet, dst.subnet);
      const srcSpec = `${src.resolved.network}/${src.resolved.cidr.prefix}`;
      const dstSpec = `${dst.resolved.network}/${dst.resolved.cidr.prefix}`;

      lines.push(`# ${src.subnet.name} -> ${dst.subnet.name}: ${policy.reason}`);
      if (policy.action === 'COMMENT') {
        lines.push(`# iptables -A FORWARD -s ${srcSpec} -d ${dstSpec} -j ACCEPT`);
      } else {
        lines.push(`iptables -A FORWARD -s ${srcSpec} -d ${dstSpec} -j ${policy.action}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Generate Linux Netplan v2 YAML configuration. */
function generateNetplanConfig(plan: NetworkPlan, options: ExportOptions): string {
  const lines: string[] = [...bannerLines('# ', options)];
  lines.push('network:');
  lines.push('  version: 2');
  lines.push('  renderer: networkd');
  lines.push('  ethernets:');
  lines.push('    eth0:');
  lines.push('      dhcp4: false');

  const untagged = plan.subnets.filter((s) => s.vlanId === undefined);
  const tagged = plan.subnets.filter((s) => s.vlanId !== undefined);

  if (untagged.length > 0) {
    lines.push('      addresses:');
    for (const subnet of untagged) {
      const resolved = tryResolveSubnet(subnet);
      if (!resolved || resolved.gatewayIp === null) continue;
      lines.push(`        - ${resolved.gatewayIp}/${resolved.cidr.prefix} # ${subnet.name}`);
    }
  }

  if (tagged.length > 0) {
    lines.push('  vlans:');
    for (const subnet of tagged) {
      const resolved = tryResolveSubnet(subnet);
      if (!resolved) continue;
      lines.push(`    vlan${subnet.vlanId}:`);
      lines.push(`      id: ${subnet.vlanId}`);
      lines.push('      link: eth0');
      if (resolved.gatewayIp !== null) {
        lines.push('      addresses:');
        lines.push(`        - ${resolved.gatewayIp}/${resolved.cidr.prefix} # ${subnet.name}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Generate MikroTik RouterOS configuration. */
function generateMikrotikConfig(plan: NetworkPlan, options: ExportOptions): string {
  const lines: string[] = [
    ...bannerLines('# ', options),
    '# MikroTik RouterOS Configuration Script',
    '',
    '# --------------------------------------------------',
    '# 1. VLAN Interfaces',
    '# --------------------------------------------------',
  ];

  for (const subnet of plan.subnets) {
    if (subnet.vlanId !== undefined) {
      lines.push(
        `/interface vlan add name=vlan${subnet.vlanId} vlan-id=${subnet.vlanId} interface=bridge comment="${subnet.name}"`,
      );
    }
  }

  lines.push('');
  lines.push('# --------------------------------------------------');
  lines.push('# 2. IP Addresses');
  lines.push('# --------------------------------------------------');

  for (const subnet of plan.subnets) {
    const resolved = tryResolveSubnet(subnet);
    if (!resolved || resolved.gatewayIp === null) continue;
    const iface = subnet.vlanId !== undefined ? `vlan${subnet.vlanId}` : 'ether2';

    lines.push(
      `/ip address add address=${resolved.gatewayIp}/${resolved.cidr.prefix} interface=${iface} comment="${subnet.name}"`,
    );
  }

  lines.push('');
  lines.push('# --------------------------------------------------');
  lines.push('# 3. DHCP Server & IP Pools');
  lines.push('# --------------------------------------------------');

  for (const subnet of plan.subnets) {
    const resolved = tryResolveSubnet(subnet);
    if (!resolved || resolved.gatewayIp === null) continue;
    const iface = subnet.vlanId !== undefined ? `vlan${subnet.vlanId}` : 'ether2';
    const safeName = subnet.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const alloc = computeHostAllocation(subnet.cidr, resolved.gatewayIp);

    if (alloc.dhcpPool) {
      lines.push(
        `/ip pool add name=pool_${safeName} ranges=${alloc.dhcpPool.start}-${alloc.dhcpPool.end}`,
      );
      lines.push(
        `/ip dhcp-server add name=dhcp_${safeName} interface=${iface} address-pool=pool_${safeName} disabled=no`,
      );
      lines.push(
        `/ip dhcp-server network add address=${alloc.networkAddress}/${resolved.cidr.prefix} gateway=${resolved.gatewayIp} dns-server=${resolved.gatewayIp} comment="${subnet.name}"`,
      );
    }
  }

  return lines.join('\n');
}

/** Generate Terraform / OpenTofu AWS VPC & Subnets configuration. */
function generateTerraformConfig(plan: NetworkPlan, options: ExportOptions): string {
  const lines: string[] = [
    ...bannerLines('# ', options),
    '# Terraform / OpenTofu HCL',
    '# AWS VPC & Subnets architecture generated offline by NetArchitect',
    '',
    'terraform {',
    '  required_version = ">= 1.5.0"',
    '  required_providers {',
    '    aws = {',
    '      source  = "hashicorp/aws"',
    '      version = "~> 5.0"',
    '    }',
    '  }',
    '}',
    '',
    'locals {',
    `  vpc_cidr = "${plan.parentCidr}"`,
    '}',
    '',
    'resource "aws_vpc" "main" {',
    '  cidr_block           = local.vpc_cidr',
    '  enable_dns_hostnames = true',
    '  enable_dns_support   = true',
    '',
    '  tags = {',
    `    Name = "${plan.name}"`,
    '  }',
    '}',
    '',
  ];

  let parentPrefix = 16;
  try {
    parentPrefix = parseCidr(plan.parentCidr).prefix;
  } catch {
    parentPrefix = 16;
  }

  for (const subnet of plan.subnets) {
    const resolved = tryResolveSubnet(subnet);
    if (!resolved) continue;
    const safeId = (subnet.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'subnet').replace(
      /^_+|_+$/g,
      '',
    );
    const newbits = Math.max(0, resolved.cidr.prefix - parentPrefix);

    lines.push(`resource "aws_subnet" "${safeId}" {`);
    lines.push('  vpc_id            = aws_vpc.main.id');
    lines.push(`  cidr_block        = "${subnet.cidr}"`);
    lines.push(`  # cidrsubnet() equivalent with newbits = ${newbits}:`);
    lines.push(`  # cidr_block      = cidrsubnet(local.vpc_cidr, ${newbits}, /* index */)`);
    lines.push('');
    lines.push('  tags = {');
    lines.push(`    Name     = "${subnet.name}"`);
    lines.push(`    Role     = "${subnet.role}"`);
    if (subnet.vlanId !== undefined) {
      lines.push(`    VLAN     = "${subnet.vlanId}"`);
    }
    lines.push(`    Capacity = "${resolved.info.usableHosts}"`);
    lines.push('  }');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

/** Generate Markdown documentation table for runbooks and architecture wikis. */
function generateMarkdownExport(plan: NetworkPlan, options: ExportOptions): string {
  const lines: string[] = [];
  if (options.includeBanner !== false) {
    for (const line of CONFIG_TEMPLATE_BANNER_LINES) {
      lines.push(`> ${line}`);
    }
    lines.push('');
  }

  lines.push(`# ${plan.name || 'Network Plan'}`);
  if (plan.description.trim().length > 0) {
    lines.push('');
    lines.push(plan.description.trim());
  }
  lines.push('');
  lines.push(`- **Parent Block:** \`${plan.parentCidr || 'N/A'}\``);
  lines.push(`- **Profile:** \`${plan.profile}\``);
  lines.push(`- **Subnets:** ${plan.subnets.length}`);
  lines.push('');
  lines.push('| Subnet | Role | VLAN | CIDR | Subnet Mask | Gateway | Usable Hosts | Requested |');
  lines.push('| :--- | :--- | :---: | :--- | :--- | :--- | ---: | ---: |');

  for (const subnet of plan.subnets) {
    const resolved = tryResolveSubnet(subnet);
    const roleLabel =
      subnet.role === 'CUSTOM' && subnet.customRoleLabel
        ? `CUSTOM (${subnet.customRoleLabel})`
        : subnet.role;
    const vlan = subnet.vlanId !== undefined ? String(subnet.vlanId) : 'Untagged';
    const mask = resolved?.mask ?? 'N/A';
    const gateway = resolved?.gatewayIp ?? 'None';
    const usable = resolved ? String(resolved.info.usableHosts) : 'N/A';

    lines.push(
      `| ${subnet.name} | ${roleLabel} | ${vlan} | \`${subnet.cidr}\` | \`${mask}\` | \`${gateway}\` | ${usable} | ${subnet.requestedHosts} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/** Generate JSON export. */
function generateJsonExport(plan: NetworkPlan, _options: ExportOptions): string {
  const exportData = {
    schemaVersion: SCHEMA_VERSION,
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
        gatewayMode: s.gatewayMode,
        requestedHosts: s.requestedHosts,
        sortOrder: s.sortOrder,
      })),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    },
  };

  return JSON.stringify(exportData, null, 2);
}

/** Export a plan to the specified target. */
export function exportPlan(
  plan: NetworkPlan,
  target: ExportTarget,
  options: ExportOptions = {},
): string {
  switch (target) {
    case 'cisco-ios':
      return generateCiscoConfig(plan, options);
    case 'linux-iptables':
      return generateIptablesConfig(plan, options);
    case 'linux-netplan':
      return generateNetplanConfig(plan, options);
    case 'mikrotik':
      return generateMikrotikConfig(plan, options);
    case 'terraform':
      return generateTerraformConfig(plan, options);
    case 'markdown':
      return generateMarkdownExport(plan, options);
    case 'json':
      return generateJsonExport(plan, options);
  }
}

/** All export targets. */
export const EXPORT_TARGETS: readonly ExportTarget[] = Object.freeze([
  'cisco-ios',
  'linux-iptables',
  'linux-netplan',
  'mikrotik',
  'terraform',
  'markdown',
  'json',
]);
