import { describe, it, expect } from 'vitest';
import { SLOTracker, SLODefinition, SLOWindow, SLOMetric } from './slo';
import { TokenRollup } from './token-usage';

describe('SLOTracker', () => {
  const mockRollup = (overrides: Partial<TokenRollup> = {}): TokenRollup => ({
    userId: 'test',
    timestamp: Date.now(),
    totalInputTokens: 100,
    totalOutputTokens: 50,
    invocationCount: 10,
    toolCalls: 5,
    avgTokensPerInvocation: 15,
    successCount: 9,
    totalDurationMs: 1000,
    avgDurationMs: 100,
    p50DurationMs: 90,
    p95DurationMs: 150,
    p99DurationMs: 200,
    expiresAt: Date.now() + 86400000,
    ...overrides,
  });

  describe('checkSLO', () => {
    it('should return burnRate 0 and withinBudget true for empty rollups', async () => {
      const slo: SLODefinition = {
        name: 'test',
        target: 0.95,
        window: SLOWindow.DAILY,
        metric: SLOMetric.SUCCESS_RATE,
      };
      const result = await SLOTracker.checkSLO(slo, []);
      expect(result.burnRate).toBe(0);
      expect(result.withinBudget).toBe(true);
    });

    it('should calculate availability burn rate correctly', async () => {
      const slo: SLODefinition = {
        name: 'api_availability',
        target: 0.99,
        window: SLOWindow.MONTHLY,
        metric: SLOMetric.AVAILABILITY,
      };
      const rollups = [mockRollup({ invocationCount: 100, successCount: 98 })];
      const result = await SLOTracker.checkSLO(slo, rollups);
      expect(result.burnRate).toBeGreaterThan(0);
      expect(result.withinBudget).toBe(false);
    });

    it('should return withinBudget true when success rate exceeds target', async () => {
      const slo: SLODefinition = {
        name: 'task_success_rate',
        target: 0.9,
        window: SLOWindow.WEEKLY,
        metric: SLOMetric.SUCCESS_RATE,
      };
      const rollups = [mockRollup({ invocationCount: 100, successCount: 95 })];
      const result = await SLOTracker.checkSLO(slo, rollups);
      expect(result.withinBudget).toBe(true);
    });

    it('should calculate p95_latency burn rate', async () => {
      const slo: SLODefinition = {
        name: 'response_latency',
        target: 1000,
        window: SLOWindow.DAILY,
        metric: SLOMetric.LATENCY,
      };
      const rollups = [mockRollup({ totalInputTokens: 500, totalOutputTokens: 500 })];
      const result = await SLOTracker.checkSLO(slo, rollups);
      expect(result.burnRate).toBeGreaterThan(0);
    });

    it('should aggregate multiple rollups', async () => {
      const slo: SLODefinition = {
        name: 'task_success_rate',
        target: 0.95,
        window: SLOWindow.WEEKLY,
        metric: SLOMetric.SUCCESS_RATE,
      };
      const rollups = [
        mockRollup({ invocationCount: 50, successCount: 48 }),
        mockRollup({ invocationCount: 50, successCount: 50 }),
      ];
      const result = await SLOTracker.checkSLO(slo, rollups);
      expect(result.withinBudget).toBe(true);
    });
  });

  describe('getSLODefinitions', () => {
    it('should return all default SLO definitions', () => {
      const defs = SLOTracker.getSLODefinitions();
      expect(defs.length).toBeGreaterThan(0);
      for (const def of defs) {
        expect(def).toHaveProperty('name');
        expect(def).toHaveProperty('target');
        expect(def).toHaveProperty('window');
        expect(def).toHaveProperty('metric');
      }
    });

    it('should include api_availability SLO', () => {
      const defs = SLOTracker.getSLODefinitions();
      expect(defs.some((d) => d.name === 'api_availability')).toBe(true);
    });
  });

  describe('getSLOStatus', () => {
    it('should return status for all SLOs', async () => {
      const result = await SLOTracker.getSLOStatus({});
      expect(Object.keys(result).length).toBeGreaterThan(0);
      for (const [, status] of Object.entries(result)) {
        expect(status).toHaveProperty('current');
        expect(status).toHaveProperty('target');
        expect(status).toHaveProperty('withinBudget');
      }
    });

    it('should handle missing rollups gracefully', async () => {
      const result = await SLOTracker.getSLOStatus({ api_availability: [] });
      expect(result.api_availability.withinBudget).toBe(true);
    });
  });
});
