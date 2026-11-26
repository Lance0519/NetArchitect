import { describe, expect, it } from 'vitest';
import {
  generateQuestion,
  generateSmallestCidrQuestion,
  generateSubnetFromIpQuestion,
  generateClassifySpaceQuestion,
  generateComputeMaskQuestion,
  generateVlsmAllocationQuestion,
  QUESTION_TYPES,
} from '../src/core/question-generator';

describe('question-generator', () => {
  it('exposes all 5 question types', () => {
    expect(QUESTION_TYPES).toHaveLength(5);
  });

  describe('deterministic generation with seeds', () => {
    it('produces identical questions given identical seed', () => {
      const q1 = generateSmallestCidrQuestion(42);
      const q2 = generateSmallestCidrQuestion(42);
      expect(q1).toEqual(q2);
    });

    it('produces valid 4-option questions across all types with unique options', () => {
      for (const type of QUESTION_TYPES) {
        const q = generateQuestion(type, 12345);
        expect(q.type).toBe(type);
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.correctIndex).toBeGreaterThanOrEqual(0);
        expect(q.correctIndex).toBeLessThan(q.options.length);
        expect(q.prompt).toBeTruthy();
        expect(q.explanation).toBeTruthy();
      }
    });

    it('never throws ScopeExhaustionError across 250 seeds for every question type', () => {
      for (let seed = 1; seed <= 250; seed += 1) {
        for (const type of QUESTION_TYPES) {
          const q = generateQuestion(type, seed * 37);
          expect(q.options).toHaveLength(4);
          expect(new Set(q.options).size).toBe(4);
          expect(q.correctIndex).toBeGreaterThanOrEqual(0);
          expect(q.correctIndex).toBeLessThan(4);
          // Never claim a /31 provides 0 usable addresses (RFC 3021).
          expect(q.explanation).not.toContain('2^1 - 2 = 0');
        }
      }
    });

    it('uses identical full-CIDR formatting for every VLSM option (no format leak)', () => {
      const q = generateVlsmAllocationQuestion(500);
      for (const option of q.options) {
        expect(option).toMatch(/Subnet \d+: \d+\.\d+\.\d+\.\d+\/\d+/);
      }
    });

    it('exposes direct generators cleanly', () => {
      expect(generateSubnetFromIpQuestion(200).type).toBe('subnet-from-ip');
      expect(generateClassifySpaceQuestion(300).type).toBe('classify-space');
      expect(generateComputeMaskQuestion(400).type).toBe('compute-mask');
    });
  });
});
