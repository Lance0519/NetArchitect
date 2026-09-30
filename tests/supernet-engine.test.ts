import { describe, expect, it } from 'vitest';
import { summarizeRoutes } from '../src/core/supernet-engine';

describe('supernet-engine (Route Summarization)', () => {
  it('returns empty for empty inputs', () => {
    expect(summarizeRoutes([])).toEqual({ kind: 'empty' });
    expect(summarizeRoutes(['', '  ', '# comment'])).toEqual({ kind: 'empty' });
  });

  it('summarizes 4 contiguous /24 subnets into a single /22 with 100% efficiency and no holes', () => {
    const outcome = summarizeRoutes([
      '192.168.0.0/24',
      '192.168.1.0/24',
      '192.168.2.0/24',
      '192.168.3.0/24',
    ]);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok' || !outcome.result) return;

    expect(outcome.result.summaryCidr).toBe('192.168.0.0/22');
    expect(outcome.result.networkAddress).toBe('192.168.0.0');
    expect(outcome.result.broadcastAddress).toBe('192.168.3.255');
    expect(outcome.result.subnetMask).toBe('255.255.252.0');
    expect(outcome.result.totalAddresses).toBe(1024);
    expect(outcome.result.coveredAddresses).toBe(1024);
    expect(outcome.result.holeAddresses).toBe(0);
    expect(outcome.result.efficiencyPercent).toBe(100);
    expect(outcome.result.holes).toEqual([]);
  });

  it('detects holes when a subnet is missing from the summary block', () => {
    // 192.168.0.0/24, 192.168.1.0/24, and 192.168.3.0/24 (missing 192.168.2.0/24)
    const outcome = summarizeRoutes([
      '192.168.0.0/24',
      '192.168.1.0/24',
      '192.168.3.0/24',
    ]);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok' || !outcome.result) return;

    expect(outcome.result.summaryCidr).toBe('192.168.0.0/22');
    expect(outcome.result.totalAddresses).toBe(1024);
    expect(outcome.result.coveredAddresses).toBe(768);
    expect(outcome.result.holeAddresses).toBe(256);
    expect(outcome.result.efficiencyPercent).toBe(75);
    expect(outcome.result.holes).toEqual(['192.168.2.0/24']);
  });

  it('summarizes disparate non-contiguous enterprise blocks', () => {
    const outcome = summarizeRoutes(['10.1.0.0/24', '10.1.1.0/24']);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok' || !outcome.result) return;

    expect(outcome.result.summaryCidr).toBe('10.1.0.0/23');
    expect(outcome.result.holeAddresses).toBe(0);
    expect(outcome.result.efficiencyPercent).toBe(100);
  });

  it('returns error on invalid CIDR input', () => {
    const outcome = summarizeRoutes(['192.168.1.0/24', 'invalid-ip/99']);
    expect(outcome.kind).toBe('error');
    expect(outcome.message).toContain('Invalid subnet');
  });
});
