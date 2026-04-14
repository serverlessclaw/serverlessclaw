import { describe, it, expect } from 'vitest';
import { estimateCost, estimateCostForTotal, PRICING_REGISTRY } from './pricing';

describe('Pricing Module', () => {
  describe('estimateCost', () => {
    it('calculates exact cost for registered models', () => {
      const openai = PRICING_REGISTRY.openai['gpt-4o'];
      const input = 1000000;
      const output = 1000000;

      const cost = estimateCost(input, output, 'openai', 'gpt-4o');
      expect(cost).toBe(openai.input * input + openai.output * output);
      // gpt-4o: 2.5 + 10 = 12.5
      expect(cost).toBe(12.5);
    });

    it('uses default rates for unknown models', () => {
      const input = 1000000;
      const output = 1000000;
      const cost = estimateCost(input, output, 'unknown', 'unknown');

      // Defaults are 3 and 15 per million
      expect(cost).toBe(18);
    });

    it('handles missing provider or model', () => {
      expect(estimateCost(1000000, 1000000)).toBe(18);
      expect(estimateCost(1000000, 1000000, 'openai')).toBe(18);
    });
  });

  describe('estimateCostForTotal', () => {
    it('assumes 50/50 split for total tokens', () => {
      const total = 2000000;
      const cost = estimateCostForTotal(total, 'openai', 'gpt-4o');

      // 1M input + 1M output for gpt-4o = 12.5
      expect(cost).toBe(12.5);
    });
  });
});
