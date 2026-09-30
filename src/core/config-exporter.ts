/**
 * Configuration Export.
 *
 * Pure string generation, so it is testable. Three targets: Cisco IOS,
 * Linux iptables, and JSON.
 *
 * Every output begins with a generated banner making it unmistakably a
 * template, not a deployed config.
 *
 * The app never executes anything. No shell, no SSH, no network calls.
 */

import type { ExportOptions, ExportTarget, NetworkPlan, PlannedSubnet } from '../types/network';
import { CONFIG_TEMPLATE_BANNER } from './standards';
import { calculateSubnet, computeHostAllocation, parseCidr } from './ip-engine';

/** Current schema version for JSON export. */
const SCHEMA_VERSION = 1;

/** Generate Cisco IOS configuration. */
function generateCiscoConfig(plan: NetworkPlan, options: ExportOptions): string {
  const lines: string[] = [CONFIG_TEMPLATE_BANNER, ''];

  // Group subnets by VLAN
  const vlanGroups = new Map<number, PlannedSubnet[]>();
  for (const subnet of plan.subnets) {
    if (subnet.vlanId !== undefined) {
      const group = vlanGroups.get(subnet.vlanId) ?? [];
      group.push(subnet);
      vlanGroups.set(subnet.vlanId, group);
    }
  }

  // Generate sub-interface config per VLAN
  for (const [vlanId, subnets] of vlanGroups) {
    const template = options.subinterfaceTemplate ?? 'GigabitEthernet0/0.{vlan}';
    const interfaceName = template.replace('{vlan}', String(vlanId));

    lines.push(`interface ${interfaceName}`);
    lines.push(`  encapsulation dot1Q ${vlanId}`);

    for (const subnet of subnets) {
      const cidr = parseCidr(subnet.cidr);
      const info = calculateSubnet(cidr.ip, cidr.prefix);
      const mask = [
        (info.subnetMask >>> 24) & 0xff,
        (info.subnetMask >>> 16) & 0xff,
        (info.subnetMask >>> 8) & 0xff,
        info.subnetMask & 0xff,
      ].join('.');

      // Use gateway if available, otherwise first usable host
      const gatewayIp = subnet.gateway ?? intToIp(info.firstUsableHost);
      lines.push(`  description ${subnet.name}`);
      lines.push(`  ip address ${gatewayIp} ${mask}`);
    }

    lines.push('  no shutdown');
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

/** Convert integer to IP address string. */
function intToIp(ip: number): string {
  return [
    (ip >>> 24) & 0xff,
    (ip >>> 16) & 0xff,
    (ip >>> 8) & 0xff,
    ip & 0xff,
  ].join('.');
}

/** Generate Linux iptables configuration. */
function generateIptablesConfig(plan: NetworkPlan, _options: ExportOptions): string {
  const lines: string[] = [CONFIG_TEMPLATE_BANNER, ''];

  lines.push('#!/bin/bash');
  lines.push('#');
  lines.push('# NetArchitect iptables template');
  lines.push('# Generated offline. REVIEW BEFORE APPLYING.');
  lines.push('#');
  lines.push('');

  // Flush existing rules
  lines.push('# Flush existing rules');
  lines.push('iptables -F');
  lines.push('iptables -X');
  lines.push('iptables -t nat -F');
  lines.push('');

  // Default policies
  lines.push('# Default policies');
  lines.push('iptables -P FORWARD DROP');
  lines.push('iptables -P INPUT ACCEPT');
  lines.push('iptables -P OUTPUT ACCEPT');
  lines.push('');

  // Allow established connections
  lines.push('# Allow established connections');
  lines.push('iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT');
  lines.push('');

  // Generate rules for each subnet pair
  lines.push('# Inter-subnet rules');
  const subnets = plan.subnets;

  for (let i = 0; i < subnets.length; i++) {
    for (let j = i + 1; j < subnets.length; j++) {
      const a = subnets[i];
      const b = subnets[j];
      if (!a || !b) continue;

      const aCidr = parseCidr(a.cidr);
      const bCidr = parseCidr(b.cidr);
      const aInfo = calculateSubnet(aCidr.ip, aCidr.prefix);
      const bInfo = calculateSubnet(bCidr.ip, bCidr.prefix);

      const aNetwork = intToIp(aInfo.networkAddress);
      const bNetwork = intToIp(bInfo.networkAddress);
      const aMask = [
        (aInfo.subnetMask >>> 24) & 0xff,
        (aInfo.subnetMask >>> 16) & 0xff,
        (aInfo.subnetMask >>> 8) & 0xff,
        aInfo.subnetMask & 0xff,
      ].join('.');
      const bMask = [
        (bInfo.subnetMask >>> 24) & 0xff,
        (bInfo.subnetMask >>> 16) & 0xff,
        (bInfo.subnetMask >>> 8) & 0xff,
        bInfo.subnetMask & 0xff,
      ].join('.');

      lines.push(`# ${a.name} <-> ${b.name}`);
      lines.push(
        `iptables -A FORWARD -s ${aNetwork}/${aMask} -d ${bNetwork}/${bMask} -j ACCEPT`,
      );
      lines.push(
        `iptables -A FORWARD -s ${bNetwork}/${bMask} -d ${aNetwork}/${aMask} -j ACCEPT`,
      );
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Generate MikroTik RouterOS configuration. */
function generateMikrotikConfig(plan: NetworkPlan, _options: ExportOptions): string {
  const lines: string[] = [
    CONFIG_TEMPLATE_BANNER,
    '#',
    '# MikroTik RouterOS Configuration Script',
    '# Generated offline by NetArchitect. Review before importing.',
    '#',
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
    const cidr = parseCidr(subnet.cidr);
    const info = calculateSubnet(cidr.ip, cidr.prefix);
    const gatewayIp = subnet.gateway ?? intToIp(info.firstUsableHost);
    const iface = subnet.vlanId !== undefined ? `vlan${subnet.vlanId}` : 'ether2';

    lines.push(
      `/ip address add address=${gatewayIp}/${cidr.prefix} interface=${iface} comment="${subnet.name}"`,
    );
  }

  lines.push('');
  lines.push('# --------------------------------------------------');
  lines.push('# 3. DHCP Server & IP Pools');
  lines.push('# --------------------------------------------------');

  for (const subnet of plan.subnets) {
    const cidr = parseCidr(subnet.cidr);
    const info = calculateSubnet(cidr.ip, cidr.prefix);
    const gatewayIp = subnet.gateway ?? intToIp(info.firstUsableHost);
    const iface = subnet.vlanId !== undefined ? `vlan${subnet.vlanId}` : 'ether2';
    const safeName = subnet.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const alloc = computeHostAllocation(subnet.cidr, gatewayIp);

    if (alloc.dhcpPool) {
      lines.push(
        `/ip pool add name=pool_${safeName} ranges=${alloc.dhcpPool.start}-${alloc.dhcpPool.end}`,
      );
      lines.push(
        `/ip dhcp-server add name=dhcp_${safeName} interface=${iface} address-pool=pool_${safeName} disabled=no`,
      );
      lines.push(
        `/ip dhcp-server network add address=${alloc.networkAddress}/${cidr.prefix} gateway=${gatewayIp} dns-server=${gatewayIp} comment="${subnet.name}"`,
      );
    }
  }

  return lines.join('\n');
}

/** Generate Terraform / OpenTofu AWS VPC & Subnets configuration. */
function generateTerraformConfig(plan: NetworkPlan, _options: ExportOptions): string {
  const lines: string[] = [
    CONFIG_TEMPLATE_BANNER,
    '#',
    '# Terraform / OpenTofu HCL',
    '# AWS VPC & Subnets architecture generated offline by NetArchitect',
    '#',
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

  const parent = parseCidr(plan.parentCidr);

  for (const subnet of plan.subnets) {
    const cidr = parseCidr(subnet.cidr);
    const info = calculateSubnet(cidr.ip, cidr.prefix);
    const safeId = (subnet.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'subnet').replace(
      /^_+|_+$/g,
      '',
    );
    const newbits = Math.max(0, cidr.prefix - parent.prefix);

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
    lines.push(`    Capacity = "${info.usableHosts}"`);
    lines.push('  }');
    lines.push('}');
    lines.push('');
  }

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
    case 'mikrotik':
      return generateMikrotikConfig(plan, options);
    case 'terraform':
      return generateTerraformConfig(plan, options);
    case 'json':
      return generateJsonExport(plan, options);
  }
}

/** All export targets. */
export const EXPORT_TARGETS: readonly ExportTarget[] = Object.freeze([
  'cisco-ios',
  'linux-iptables',
  'mikrotik',
  'terraform',
  'json',
]);
