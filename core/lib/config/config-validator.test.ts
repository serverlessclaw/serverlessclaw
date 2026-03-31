import { describe, it, expect } from 'vitest';
import {
  validateConfigValue,
  validateAllConfigs,
  getConfigSchema,
  getAllConfigSchemas,
} from './config-validator';

describe('config-validator', () => {
  describe('validateConfigValue', () => {
    it('should return valid for unknown keys with warning', () => {
      const result = validateConfigValue('unknown_key', 'some_value');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Unknown config key: unknown_key');
    });

    it('should return valid for null/undefined values', () => {
      const result = validateConfigValue('recursion_limit', undefined);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    describe('number validation', () => {
      it('should validate a valid number within range', () => {
        const result = validateConfigValue('recursion_limit', 10);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject a value below minimum', () => {
        const result = validateConfigValue('recursion_limit', 0);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be >=');
      });

      it('should reject a value above maximum', () => {
        const result = validateConfigValue('recursion_limit', 101);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be <=');
      });

      it('should reject non-number types', () => {
        const result = validateConfigValue('recursion_limit', '10');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be a number');
      });
    });

    describe('boolean validation', () => {
      it('should validate a valid boolean', () => {
        const result = validateConfigValue('auto_prune_enabled', true);
        expect(result.valid).toBe(true);
      });

      it('should reject non-boolean types', () => {
        const result = validateConfigValue('auto_prune_enabled', 'true');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be a boolean');
      });
    });

    describe('string validation', () => {
      it('should validate a valid enum value', () => {
        const result = validateConfigValue('optimization_policy', 'balanced');
        expect(result.valid).toBe(true);
      });

      it('should reject an invalid enum value', () => {
        const result = validateConfigValue('optimization_policy', 'invalid');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be one of');
      });

      it('should reject non-string types', () => {
        const result = validateConfigValue('optimization_policy', 123);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must be a string');
      });
    });
  });

  describe('validateAllConfigs', () => {
    it('should validate multiple configs at once', () => {
      const result = validateAllConfigs({
        recursion_limit: 10,
        auto_prune_enabled: true,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect errors from multiple invalid configs', () => {
      const result = validateAllConfigs({
        recursion_limit: 0,
        auto_prune_enabled: 'yes',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle unknown keys with warnings', () => {
      const result = validateAllConfigs({
        unknown_key: 'value',
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('getConfigSchema', () => {
    it('should return schema for known keys', () => {
      const schema = getConfigSchema('recursion_limit');
      expect(schema).toBeDefined();
      expect(schema?.type).toBe('number');
    });

    it('should return undefined for unknown keys', () => {
      const schema = getConfigSchema('nonexistent' as never);
      expect(schema).toBeUndefined();
    });
  });

  describe('getAllConfigSchemas', () => {
    it('should return all config schemas', () => {
      const schemas = getAllConfigSchemas();
      expect(Object.keys(schemas).length).toBeGreaterThan(0);
      expect(schemas.recursion_limit).toBeDefined();
      expect(schemas.optimization_policy).toBeDefined();
    });

    it('should include type and description for each schema', () => {
      const schemas = getAllConfigSchemas();
      for (const schema of Object.values(schemas)) {
        expect(schema.type).toBeDefined();
        expect(schema.description).toBeDefined();
      }
    });
  });
});
