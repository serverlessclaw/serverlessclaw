import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET_SYSTEM_CONFIG_METADATA } from './metadata';

vi.mock('../lib/metadata', () => ({
  SYSTEM_CONFIG_METADATA: {
    deploy_limit: {
      description: 'Maximum deployments per day',
      risk: 'high',
      technicalDetails: 'Controls circuit breaker',
    },
    recursion_limit: {
      description: 'Maximum recursion depth',
      risk: 'medium',
      technicalDetails: 'Prevents infinite loops',
    },
  },
}));

describe('Metadata Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET_SYSTEM_CONFIG_METADATA', () => {
    it('has correct tool definition', () => {
      expect(GET_SYSTEM_CONFIG_METADATA.name).toBe('getSystemConfigMetadata');
      expect(GET_SYSTEM_CONFIG_METADATA.description).toBeDefined();
      expect(GET_SYSTEM_CONFIG_METADATA.parameters).toBeDefined();
    });

    it('returns system config metadata as JSON', async () => {
      const result = await GET_SYSTEM_CONFIG_METADATA.execute();
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty('deploy_limit');
      expect(parsed).toHaveProperty('recursion_limit');
      expect(parsed.deploy_limit.description).toBe('Maximum deployments per day');
      expect(parsed.deploy_limit.risk).toBe('high');
      expect(parsed.recursion_limit.description).toBe('Maximum recursion depth');
    });

    it('returns formatted JSON with proper indentation', async () => {
      const result = await GET_SYSTEM_CONFIG_METADATA.execute();

      // Verify it's valid JSON
      expect(() => JSON.parse(result)).not.toThrow();

      // Verify it has formatting (newlines and spaces)
      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('includes technical details for each config', async () => {
      const result = await GET_SYSTEM_CONFIG_METADATA.execute();
      const parsed = JSON.parse(result);

      expect(parsed.deploy_limit.technicalDetails).toBe('Controls circuit breaker');
      expect(parsed.recursion_limit.technicalDetails).toBe('Prevents infinite loops');
    });
  });
});
