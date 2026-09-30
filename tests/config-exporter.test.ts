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
  ],
  createdAt: 1000000,
  updatedAt: 1000000,
};

describe('config-exporter', () => {
  it('exposes all supported export targets', () => {
    expect(EXPORT_TARGETS).toEqual(['cisco-ios', 'linux-iptables', 'mikrotik', 'terraform', 'json']);
  });

  describe('Cisco IOS export', () => {
    it('includes template banner and sub-interface configuration', () => {
      const output = exportPlan(samplePlan, 'cisco-ios');
      expect(output).toContain('CONFIGURATION TEMPLATE');
      expect(output).toContain('interface GigabitEthernet0/0.10');
      expect(output).toContain('encapsulation dot1Q 10');
      expect(output).toContain('description Corporate LAN');
      expect(output).toContain('ip address 10.0.1.1 255.255.255.0');
      expect(output).toContain('interface GigabitEthernet0/0.20');
      expect(output).toContain('encapsulation dot1Q 20');
      expect(output).toContain('description Guest Wi-Fi');
      expect(output).toContain('ip address 10.0.2.1 255.255.255.0');
    });

    it('supports custom sub-interface templates', () => {
      const output = exportPlan(samplePlan, 'cisco-ios', {
        subinterfaceTemplate: 'TenGigabitEthernet1/0/1.{vlan}',
      });
      expect(output).toContain('interface TenGigabitEthernet1/0/1.10');
      expect(output).toContain('interface TenGigabitEthernet1/0/1.20');
    });
  });

  describe('Linux iptables export', () => {
    it('includes template banner, flush rules, and inter-subnet policies', () => {
      const output = exportPlan(samplePlan, 'linux-iptables');
      expect(output).toContain('CONFIGURATION TEMPLATE');
      expect(output).toContain('iptables -F');
      expect(output).toContain('iptables -P FORWARD DROP');
      expect(output).toContain('iptables -A FORWARD -s 10.0.1.0/255.255.255.0 -d 10.0.2.0/255.255.255.0 -j ACCEPT');
    });
  });

  describe('MikroTik RouterOS export', () => {
    it('generates VLAN interfaces, IP addresses, and DHCP server configurations', () => {
      const output = exportPlan(samplePlan, 'mikrotik');
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
    it('generates valid Terraform HCL with VPC and subnet blocks', () => {
      const output = exportPlan(samplePlan, 'terraform');
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

  describe('JSON export', () => {
    it('produces valid JSON containing the full plan structure', () => {
      const output = exportPlan(samplePlan, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.plan.name).toBe('Branch Office');
      expect(parsed.plan.parentCidr).toBe('10.0.0.0/16');
      expect(parsed.plan.subnets).toHaveLength(2);
      expect(parsed.plan.subnets[0].vlanId).toBe(10);
    });
  });
});
