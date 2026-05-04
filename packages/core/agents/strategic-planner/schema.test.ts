import { describe, it, expect } from 'vitest';
import { StrategicPlanSchema } from './schema';

/**
 * Tests for core/agents/strategic-planner/schema.ts
 * Covers: StrategicPlanSchema structure, required fields, status enum, tool optimizations
 */

describe('StrategicPlanSchema', () => {
  it('is an object schema', () => {
    expect(StrategicPlanSchema.type).toBe('object');
  });

  it('has required fields: status, plan, coveredGapIds', () => {
    expect(StrategicPlanSchema.required).toEqual(['status', 'plan', 'coveredGapIds']);
  });

  it('disallows additional properties', () => {
    expect(StrategicPlanSchema.additionalProperties).toBe(false);
  });

  describe('status field', () => {
    it('is a string', () => {
      expect(StrategicPlanSchema.properties.status.type).toBe('string');
    });

    it('has correct enum values', () => {
      expect(StrategicPlanSchema.properties.status.enum).toEqual(['SUCCESS', 'FAILED']);
    });
  });

  describe('plan field', () => {
    it('is a string', () => {
      expect(StrategicPlanSchema.properties.plan.type).toBe('string');
    });
  });

  describe('coveredGapIds field', () => {
    it('is an array of strings', () => {
      expect(StrategicPlanSchema.properties.coveredGapIds.type).toBe('array');
      expect(StrategicPlanSchema.properties.coveredGapIds.items.type).toBe('string');
    });
  });

  describe('toolOptimizations field', () => {
    it('is an array', () => {
      expect(StrategicPlanSchema.properties.toolOptimizations.type).toBe('array');
    });

    it('has items with required action, toolName, reason', () => {
      const items = StrategicPlanSchema.properties.toolOptimizations.items;
      expect(items.type).toBe('object');
      expect(items.required).toEqual(['action', 'toolName', 'reason']);
    });

    it('action has correct enum values', () => {
      const action = StrategicPlanSchema.properties.toolOptimizations.items.properties.action;
      expect(action.type).toBe('string');
      expect(action.enum).toEqual(['PRUNE', 'CONSOLIDATE', 'REPLACE']);
    });

    it('toolName is a string', () => {
      expect(StrategicPlanSchema.properties.toolOptimizations.items.properties.toolName.type).toBe(
        'string'
      );
    });

    it('reason is a string', () => {
      expect(StrategicPlanSchema.properties.toolOptimizations.items.properties.reason.type).toBe(
        'string'
      );
    });

    it('disallows additional properties on tool optimization items', () => {
      expect(StrategicPlanSchema.properties.toolOptimizations.items.additionalProperties).toBe(
        false
      );
    });
  });
});
