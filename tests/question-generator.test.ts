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

    it('produces valid smallest CIDR questions with plausible options', () => {
      const q = generateSmallestCidrQuestion(100);
      expect(q.type).toBe('smallest-cidr');
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(q.options.length);
      expect(q.prompt).toContain('What is the smallest subnet');
      expect(q.explanation).toBeTruthy();
    });

    it('produces valid subnet-from-ip questions', () => {
      const q = generateSubnetFromIpQuestion(200);
      expect(q.type).toBe('subnet-from-ip');
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.options[q.correctIndex]).toBeTruthy();
      expect(q.prompt).toContain('What is the network address');
    });

    it('produces valid classify-space questions', () => {
      const q = generateClassifySpaceQuestion(300);
      expect(q.type).toBe('classify-space');
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.prompt).toContain('How is');
    });

    it('produces valid compute-mask questions', () => {
      const q = generateComputeMaskQuestion(400);
      expect(q.type).toBe('compute-mask');
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.prompt).toContain('What is the subnet mask');
    });

    it('produces valid vlsm-allocation questions', () => {
      const q = generateVlsmAllocationQuestion(500);
      expect(q.type).toBe('vlsm-allocation');
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.prompt).toContain('Allocate subnets for');
    });

    it('routes all question types correctly through generateQuestion dispatch', () => {
      for (const type of QUESTION_TYPES) {
        const q = generateQuestion(type, 12345);
        expect(q.type).toBe(type);
      }
    });
  });
});
