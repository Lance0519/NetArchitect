import { describe, expect, it } from 'vitest';
import { exportPlan, EXPORT_TARGETS } from '../src/core/config-exporter';
import type { NetworkPlan } from '../src/types/network';

const samplePlan: NetworkPlan = {
  id: 'plan-1',
  name: 'Branch Office',
  description: 'Test corporate branch network',
  parentCidr: '10.0.0.0/16',
  profile: 'enterprise',
  subnets: [
    {
      id: 'sub-1',
      name: 'Corporate LAN',
      role: 'LAN',
      vlanId: 10,
      cidr: '10.0.1.0/24',
      requestedHosts: 100,
      sortOrder: 0,
    },
    {
      id: 'sub-2',
      name: 'Guest Wi-Fi',
      role: 'GUEST',
      vlanId: 20,
      cidr: '10.0.2.0/24',
      requestedHosts: 50,
      sortOrder: 1,
    },
    {
      id: 'sub-3',
      name: 'Servers',
      role: 'SERVERS',
      vlanId: 30,
      cidr: '10.0.3.0/24',
      requestedHosts: 40,
      sortOrder: 2,
    },
    {
      id: 'sub-4',
      name: 'Management',
      role: 'MANAGEMENT',
      vlanId: 99,
      cidr: '10.0.99.0/28',
      requestedHosts: 10,
      sortOrder: 3,
    },
  ],
  createdAt: 1000000,
  updatedAt: 1000000,
};

describe('config-exporter', () => {
  it('exposes all supported export targets', () => {
    expect(EXPORT_TARGETS).toEqual([
      'cisco-ios',
      'linux-iptables',
      'linux-netplan',
      'mikrotik',
      'terraform',
      'markdown',
      'json',
    ]);
  });

  describe('Cisco IOS export', () => {
    it('prefixes banner with Cisco comment markers (`!`) and emits sub-interfaces', () => {
      const output = exportPlan(samplePlan, 'cisco-ios');
      expect(output.split('\n')[0]).toMatch(/^! /);
      expect(output).toContain('CONFIGURATION TEMPLATE');
      expect(output).toContain('interface GigabitEthernet0/0.10');
      expect(output).toContain('encapsulation dot1Q 10');
      expect(output).toContain('description Corporate LAN');
      expect(output).toContain('ip address 10.0.1.1 255.255.255.0');
      expect(output).toContain('interface GigabitEthernet0/0.20');
      expect(output).toContain('encapsulation dot1Q 20');
    });

    it('honors includeBanner: false and custom sub-interface templates', () => {
      const output = exportPlan(samplePlan, 'cisco-ios', {
        includeBanner: false,
        subinterfaceTemplate: 'TenGigabitEthernet1/0/1.{vlan}',
      });
      expect(output).not.toContain('CONFIGURATION TEMPLATE');
      expect(output).toContain('interface TenGigabitEthernet1/0/1.10');
      expect(output).toContain('interface TenGigabitEthernet1/0/1.20');
    });
  });

  describe('Linux iptables export', () => {
    it('puts #!/bin/bash on line 1, comments the banner, and enforces Zero Trust isolation', () => {
      const output = exportPlan(samplePlan, 'linux-iptables');
      const lines = output.split('\n');
      expect(lines[0]).toBe('#!/bin/bash');
      expect(lines[1]).toMatch(/^# /);
      expect(output).toContain('CONFIGURATION TEMPLATE');
      expect(output).toContain('iptables -F');
      expect(output).toContain('iptables -P FORWARD DROP');

      // Zero Trust: untrusted Guest MUST be dropped toward LAN, Servers, and Management
      expect(output).toContain('iptables -A FORWARD -s 10.0.2.0/24 -d 10.0.1.0/24 -j DROP');
      expect(output).toContain('iptables -A FORWARD -s 10.0.2.0/24 -d 10.0.99.0/28 -j DROP');
      expect(output).not.toContain('iptables -A FORWARD -s 10.0.2.0/24 -d 10.0.1.0/24 -j ACCEPT');

      // Zero Trust: LAN must NOT reach Management, but may reach Servers
      expect(output).toContain('iptables -A FORWARD -s 10.0.1.0/24 -d 10.0.99.0/28 -j DROP');
      expect(output).toContain('iptables -A FORWARD -s 10.0.1.0/24 -d 10.0.3.0/24 -j ACCEPT');

      // Management may administer managed segments
      expect(output).toContain('iptables -A FORWARD -s 10.0.99.0/28 -d 10.0.3.0/24 -j ACCEPT');
    });
  });

  describe('Linux Netplan export', () => {
    it('generates valid commented Netplan v2 YAML with VLAN interfaces', () => {
      const output = exportPlan(samplePlan, 'linux-netplan');
      expect(output.split('\n')[0]).toMatch(/^# /);
      expect(output).toContain('network:');
      expect(output).toContain('version: 2');
      expect(output).toContain('vlan10:');
      expect(output).toContain('id: 10');
      expect(output).toContain('- 10.0.1.1/24 # Corporate LAN');
    });
  });

  describe('MikroTik RouterOS export', () => {
    it('comments the banner and generates VLAN, IP, and DHCP configurations', () => {
      const output = exportPlan(samplePlan, 'mikrotik');
      expect(output.split('\n')[0]).toMatch(/^# /);
      expect(output).toContain('CONFIGURATION TEMPLATE');
      expect(output).toContain('MikroTik RouterOS');
      expect(output).toContain('/interface vlan add name=vlan10 vlan-id=10');
      expect(output).toContain('/interface vlan add name=vlan20 vlan-id=20');
      expect(output).toContain('/ip address add address=10.0.1.1/24 interface=vlan10');
      expect(output).toContain('/ip pool add name=pool_corporate_lan');
      expect(output).toContain('/ip dhcp-server add name=dhcp_corporate_lan');
      expect(output).toContain('/ip dhcp-server network add address=10.0.1.0/24 gateway=10.0.1.1');
    });
  });

  describe('Terraform export', () => {
    it('comments the banner and generates AWS VPC + subnet HCL', () => {
      const output = exportPlan(samplePlan, 'terraform');
      expect(output.split('\n')[0]).toMatch(/^# /);
      expect(output).toContain('CONFIGURATION TEMPLATE');
      expect(output).toContain('resource "aws_vpc" "main"');
      expect(output).toContain('cidr_block           = local.vpc_cidr');
      expect(output).toContain('resource "aws_subnet" "corporate_lan"');
      expect(output).toContain('cidr_block        = "10.0.1.0/24"');
      expect(output).toContain('cidrsubnet()');
      expect(output).toContain('resource "aws_subnet" "guest_wi_fi"');
      expect(output).toContain('cidr_block        = "10.0.2.0/24"');
    });
  });

  describe('Markdown documentation export', () => {
    it('renders a structured Markdown table with plan summary and all subnets', () => {
      const output = exportPlan(samplePlan, 'markdown');
      expect(output.split('\n')[0]).toMatch(/^> /);
      expect(output).toContain('# Branch Office');
      expect(output).toContain('| Subnet | Role | VLAN | CIDR | Subnet Mask | Gateway | Usable Hosts | Requested |');
      expect(output).toContain('| Corporate LAN | LAN | 10 | `10.0.1.0/24` | `255.255.255.0` | `10.0.1.1` | 254 | 100 |');
    });
  });

  describe('JSON export', () => {
    it('produces valid JSON containing the full plan structure', () => {
      const output = exportPlan(samplePlan, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.plan.name).toBe('Branch Office');
      expect(parsed.plan.parentCidr).toBe('10.0.0.0/16');
      expect(parsed.plan.subnets).toHaveLength(4);
      expect(parsed.plan.subnets[0].vlanId).toBe(10);
    });
  });

  describe('edge cases across all export targets', () => {
    const complexPlan: NetworkPlan = {
      id: 'plan-complex',
      name: 'Complex Edge Site',
      description: '',
      parentCidr: 'invalid-parent',
      profile: 'custom',
      subnets: [
        {
          id: 'dmz',
          name: 'Edge DMZ',
          role: 'DMZ',
          vlanId: 50,
          cidr: '10.0.50.0/27',
          requestedHosts: 10,
          sortOrder: 0,
        },
        {
          id: 'iot',
          name: 'Sensors',
          role: 'IOT',
          vlanId: 60,
          cidr: '10.0.60.0/26',
          gatewayMode: 'none',
          requestedHosts: 20,
          sortOrder: 1,
        },
        {
          id: 'p2p',
          name: 'WAN Uplink',
          role: 'POINT_TO_POINT',
          cidr: '10.0.255.0/31',
          requestedHosts: 2,
          sortOrder: 2,
        },
        {
          id: 'custom',
          name: 'Lab Bench',
          role: 'CUSTOM',
          customRoleLabel: 'QA Lab',
          cidr: '10.0.70.0/28',
          requestedHosts: 5,
          sortOrder: 3,
        },
        {
          id: 'broken',
          name: 'Incomplete',
          role: 'LAN',
          vlanId: 90,
          cidr: 'not-a-cidr',
          requestedHosts: 0,
          sortOrder: 4,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    it('handles DMZ isolation, untagged segments, gateway-less subnets, custom roles, and invalid draft CIDRs without throwing', () => {
      const cisco = exportPlan(complexPlan, 'cisco-ios');
      expect(cisco).toContain('no ip address');
      expect(cisco).toContain('! Untagged segment: WAN Uplink');
      expect(cisco).toContain('! Skipped Incomplete: invalid CIDR');

      const iptables = exportPlan(complexPlan, 'linux-iptables', { includeBanner: false });
      expect(iptables.startsWith('#!/bin/bash\n')).toBe(true);
      expect(iptables).not.toContain('CONFIGURATION TEMPLATE');
      expect(iptables).toContain('# Edge DMZ -> WAN Uplink: NIST SP 800-41');
      expect(iptables).toContain('-s 10.0.50.0/27 -d 10.0.255.0/31 -j DROP');
      expect(iptables).toContain('# WAN Uplink -> Edge DMZ: Default-deny');
      expect(iptables).toContain('# Lab Bench -> WAN Uplink: Zero Trust isolation');

      const netplan = exportPlan(complexPlan, 'linux-netplan', { includeBanner: false });
      expect(netplan).toContain('- 10.0.255.0/31 # WAN Uplink');
      expect(netplan).toContain('vlan60:');

      const mikrotik = exportPlan(complexPlan, 'mikrotik', { includeBanner: false });
      expect(mikrotik).toContain('interface=ether2');

      const terraform = exportPlan(complexPlan, 'terraform', { includeBanner: false });
      expect(terraform).toContain('resource "aws_subnet" "edge_dmz"');

      const md = exportPlan(complexPlan, 'markdown', { includeBanner: false });
      expect(md).toContain('CUSTOM (QA Lab)');
      expect(md).toContain('| Untagged |');
      expect(md).toContain('| `None` |');
    });
  });
});
