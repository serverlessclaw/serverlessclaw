import { describe, it, expect } from 'vitest';
import { SYSTEM_CONFIG_METADATA } from './metadata';

describe('metadata', () => {
  describe('SYSTEM_CONFIG_METADATA', () => {
    it('should export a non-empty metadata object', () => {
      expect(SYSTEM_CONFIG_METADATA).toBeDefined();
      expect(Object.keys(SYSTEM_CONFIG_METADATA).length).toBeGreaterThan(0);
    });

    it('should have required fields for each config option', () => {
      for (const [key, meta] of Object.entries(SYSTEM_CONFIG_METADATA)) {
        expect(meta.label, `${key} missing label`).toBeDefined();
        expect(meta.description, `${key} missing description`).toBeDefined();
        expect(meta.default, `${key} missing default`).toBeDefined();
        expect(typeof meta.label).toBe('string');
        expect(typeof meta.description).toBe('string');
        expect(typeof meta.default).toBe('string');
      }
    });

    it('should have implication field for each config option', () => {
      for (const [key, meta] of Object.entries(SYSTEM_CONFIG_METADATA)) {
        expect(meta.implication, `${key} missing implication`).toBeDefined();
      }
    });

    it('should include expected config keys', () => {
      expect(SYSTEM_CONFIG_METADATA.active_provider).toBeDefined();
      expect(SYSTEM_CONFIG_METADATA.active_model).toBeDefined();
      expect(SYSTEM_CONFIG_METADATA.deploy_limit).toBeDefined();
      expect(SYSTEM_CONFIG_METADATA.recursion_limit).toBeDefined();
      expect(SYSTEM_CONFIG_METADATA.evolution_mode).toBeDefined();
      expect(SYSTEM_CONFIG_METADATA.circuit_breaker_threshold).toBeDefined();
      expect(SYSTEM_CONFIG_METADATA.max_tool_iterations).toBeDefined();
    });

    it('should have valid risk fields when present', () => {
      for (const [_, meta] of Object.entries(SYSTEM_CONFIG_METADATA)) {
        if (meta.risk) {
          expect(typeof meta.risk).toBe('string');
          expect(meta.risk.length).toBeGreaterThan(0);
        }
      }
    });

    it('should have valid safeguard fields when present', () => {
      for (const [_, meta] of Object.entries(SYSTEM_CONFIG_METADATA)) {
        if (meta.safeguard) {
          expect(typeof meta.safeguard).toBe('string');
          expect(meta.safeguard.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
