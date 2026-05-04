import { describe, it, expect } from 'vitest';
import { getContextStrategy, PROVIDER_STRATEGIES } from './context-strategies';

describe('context-strategies', () => {
  describe('PROVIDER_STRATEGIES', () => {
    it('should have a default strategy', () => {
      expect(PROVIDER_STRATEGIES.default).toBeDefined();
    });

    it('should have strategies for common models', () => {
      expect(PROVIDER_STRATEGIES['gpt-4o']).toBeDefined();
      expect(PROVIDER_STRATEGIES['gpt-4o-mini']).toBeDefined();
      expect(PROVIDER_STRATEGIES['claude-3-5-sonnet-20240620']).toBeDefined();
      expect(PROVIDER_STRATEGIES['claude-3-haiku-20240307']).toBeDefined();
    });

    it('should have valid context token limits', () => {
      for (const [_, strategy] of Object.entries(PROVIDER_STRATEGIES)) {
        expect(strategy.maxContextTokens).toBeGreaterThan(0);
        expect(strategy.reservedResponseTokens).toBeGreaterThan(0);
        expect(strategy.compressionTriggerPercent).toBeGreaterThan(0);
        expect(strategy.compressionTriggerPercent).toBeLessThanOrEqual(100);
      }
    });

    it('should have valid tool result priority values', () => {
      for (const strategy of Object.values(PROVIDER_STRATEGIES)) {
        expect(['high', 'normal']).toContain(strategy.toolResultPriority);
      }
    });
  });

  describe('getContextStrategy', () => {
    it('should return strategy for known model', () => {
      const strategy = getContextStrategy('gpt-4o');
      expect(strategy).toBe(PROVIDER_STRATEGIES['gpt-4o']);
    });

    it('should return strategy for known provider', () => {
      const strategy = getContextStrategy(undefined, 'gpt-4o');
      expect(strategy).toBe(PROVIDER_STRATEGIES['gpt-4o']);
    });

    it('should return default strategy when no match', () => {
      const strategy = getContextStrategy('unknown-model');
      expect(strategy).toBe(PROVIDER_STRATEGIES.default);
    });

    it('should prioritize model over provider', () => {
      const strategy = getContextStrategy('gpt-4o-mini', 'gpt-4o');
      expect(strategy).toBe(PROVIDER_STRATEGIES['gpt-4o-mini']);
    });

    it('should return default when no args provided', () => {
      const strategy = getContextStrategy();
      expect(strategy).toBe(PROVIDER_STRATEGIES.default);
    });
  });
});
