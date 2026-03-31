/**
 * Tiering / RetentionManager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetentionManager, RetentionTiers } from './tiering';
import { MEMORY_KEYS } from '../constants';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn().mockResolvedValue(30),
  },
}));

vi.mock('../safety/circuit-breaker', () => ({
  getCircuitBreaker: vi.fn().mockReturnValue({
    reset: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('RetentionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getExpiresAt', () => {
    it('should return STANDARD tier for MESSAGES', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(7);

      const result = await RetentionManager.getExpiresAt('MESSAGES', 'user123');

      expect(result.type).toBe('msg');
      expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('MESSAGES_DAYS');
    });

    it('should return CRITICAL tier for LESSONS and LESSON# prefix', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(90);

      const result1 = await RetentionManager.getExpiresAt('LESSONS', 'user123');
      expect(result1.type).toBe('LESSON');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('LESSONS_DAYS');

      const result2 = await RetentionManager.getExpiresAt('ANY', `${MEMORY_KEYS.LESSON_PREFIX}123`);
      expect(result2.type).toBe('LESSON');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('LESSONS_DAYS');
    });

    it('should return KNOWLEDGE tier for FACTS and FACT# prefix', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(365);

      const result1 = await RetentionManager.getExpiresAt('FACTS', 'user123');
      expect(result1.type).toBe('FACT');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('FACTS_DAYS');

      const result2 = await RetentionManager.getExpiresAt('ANY', `${MEMORY_KEYS.FACT_PREFIX}123`);
      expect(result2.type).toBe('FACT');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('FACTS_DAYS');
    });

    it('should return TRAILS tier for TRACES', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(30);

      const result = await RetentionManager.getExpiresAt('TRACES', 'user123');

      expect(result.type).toBe('trace');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('TRACES_DAYS');
    });

    it('should return EVOLUTION tier for GAPS', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(730);

      const result = await RetentionManager.getExpiresAt('GAPS', 'user123');

      expect(result.type).toBe('GAP');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('GAPS_DAYS');
    });

    it('should return SWARM tier for REPUTATION and REPUTATION# prefix', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(365);

      const result1 = await RetentionManager.getExpiresAt('REPUTATION', 'user123');
      expect(result1.type).toBe('REPUTATION');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('REPUTATION_DAYS');

      const result2 = await RetentionManager.getExpiresAt(
        'ANY',
        `${MEMORY_KEYS.REPUTATION_PREFIX}123`
      );
      expect(result2.type).toBe('REPUTATION');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('REPUTATION_DAYS');
    });

    it('should return SESSIONS tier for SESSIONS', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(90);

      const result = await RetentionManager.getExpiresAt('SESSIONS', 'user123');

      expect(result.type).toBe('SESSION');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('SESSION_METADATA_DAYS');
    });

    it('should return SUMMARIES tier for SUMMARIES and SUMMARY# prefix', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(30);

      const result1 = await RetentionManager.getExpiresAt('SUMMARIES', 'user123');
      expect(result1.type).toBe('SUMMARY');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('SUMMARY_DAYS');

      const result2 = await RetentionManager.getExpiresAt(
        'ANY',
        `${MEMORY_KEYS.SUMMARY_PREFIX}123`
      );
      expect(result2.type).toBe('SUMMARY');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('SUMMARY_DAYS');
    });

    it('should return EPHEMERAL tier for TEMP# userId and EPHEMERAL category', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const result1 = await RetentionManager.getExpiresAt('ANY', 'TEMP#session123');
      expect(result1.type).toBe('temp');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('EPHEMERAL_DAYS');

      const result2 = await RetentionManager.getExpiresAt('EPHEMERAL', 'user123');
      expect(result2.type).toBe('temp');
      expect(AgentRegistry.getRetentionDays).toHaveBeenCalledWith('EPHEMERAL_DAYS');
    });

    it('should calculate expiresAt correctly', async () => {
      const { AgentRegistry } = await import('../registry');
      (AgentRegistry.getRetentionDays as ReturnType<typeof vi.fn>).mockResolvedValue(30);

      const before = Date.now();
      const result = await RetentionManager.getExpiresAt('MESSAGES', 'user123');
      const after = Date.now();

      const expectedMin = Math.floor(before / 1000) + 30 * 86400;
      const expectedMax = Math.floor(after / 1000) + 30 * 86400;

      expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(result.expiresAt).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('performSystemCleanup', () => {
    it('should reset circuit breaker', async () => {
      const { getCircuitBreaker } = await import('../safety/circuit-breaker');
      const mockReset = vi.fn().mockResolvedValue(undefined);
      (getCircuitBreaker as ReturnType<typeof vi.fn>).mockReturnValue({ reset: mockReset });

      await RetentionManager.performSystemCleanup();

      expect(mockReset).toHaveBeenCalled();
    });
  });

  describe('RetentionTiers enum', () => {
    it('should have correct values', () => {
      expect(RetentionTiers.STANDARD).toBe('MESSAGES_DAYS');
      expect(RetentionTiers.CRITICAL).toBe('LESSONS_DAYS');
      expect(RetentionTiers.EPHEMERAL).toBe('EPHEMERAL_DAYS');
      expect(RetentionTiers.TRAILS).toBe('TRACES_DAYS');
      expect(RetentionTiers.KNOWLEDGE).toBe('FACTS_DAYS');
      expect(RetentionTiers.EVOLUTION).toBe('GAPS_DAYS');
      expect(RetentionTiers.SWARM).toBe('REPUTATION_DAYS');
      expect(RetentionTiers.SESSIONS).toBe('SESSION_METADATA_DAYS');
      expect(RetentionTiers.SUMMARIES).toBe('SUMMARY_DAYS');
    });
  });
});
