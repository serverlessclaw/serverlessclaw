import { describe, it, expect } from 'vitest';
import { ReflectionReportSchema } from './schema';

/**
 * Tests for core/agents/cognition-reflector/schema.ts
 * Covers: ReflectionReportSchema structure, required fields, types, enums
 */

describe('ReflectionReportSchema', () => {
  const root = ReflectionReportSchema.json_schema.schema;

  it('has correct top-level type and name', () => {
    expect(ReflectionReportSchema.type).toBe('json_schema');
    expect(ReflectionReportSchema.json_schema.name).toBe('reflection_report');
    expect(ReflectionReportSchema.json_schema.strict).toBe(true);
  });

  it('is an object schema', () => {
    expect(root.type).toBe('object');
  });

  it('has all required top-level fields', () => {
    expect(root.required).toEqual(['facts', 'lessons', 'gaps', 'updatedGaps', 'resolvedGapIds']);
  });

  it('disallows additional properties', () => {
    expect(root.additionalProperties).toBe(false);
  });

  describe('facts field', () => {
    it('is a string', () => {
      expect(root.properties.facts.type).toBe('string');
    });
  });

  describe('lessons field', () => {
    it('is an array', () => {
      expect(root.properties.lessons.type).toBe('array');
    });

    it('has items with required content, category, impact', () => {
      const items = root.properties.lessons.items;
      expect(items.type).toBe('object');
      expect(items.required).toEqual(['content', 'category', 'impact']);
    });

    it('content is a string', () => {
      expect(root.properties.lessons.items.properties.content.type).toBe('string');
    });

    it('category is a string', () => {
      expect(root.properties.lessons.items.properties.category.type).toBe('string');
    });

    it('impact is an integer with bounds 1-10', () => {
      const impact = root.properties.lessons.items.properties.impact;
      expect(impact.type).toBe('integer');
      expect(impact.minimum).toBe(1);
      expect(impact.maximum).toBe(10);
    });

    it('disallows additional properties on lesson items', () => {
      expect(root.properties.lessons.items.additionalProperties).toBe(false);
    });
  });

  describe('gaps field', () => {
    it('is an array', () => {
      expect(root.properties.gaps.type).toBe('array');
    });

    it('has items with required content, impact, urgency', () => {
      const items = root.properties.gaps.items;
      expect(items.type).toBe('object');
      expect(items.required).toEqual(['content', 'impact', 'urgency']);
    });

    it('impact is an integer with bounds 1-10', () => {
      const impact = root.properties.gaps.items.properties.impact;
      expect(impact.type).toBe('integer');
      expect(impact.minimum).toBe(1);
      expect(impact.maximum).toBe(10);
    });

    it('urgency is an integer with bounds 1-10', () => {
      const urgency = root.properties.gaps.items.properties.urgency;
      expect(urgency.type).toBe('integer');
      expect(urgency.minimum).toBe(1);
      expect(urgency.maximum).toBe(10);
    });

    it('disallows additional properties on gap items', () => {
      expect(root.properties.gaps.items.additionalProperties).toBe(false);
    });
  });

  describe('updatedGaps field', () => {
    it('is an array', () => {
      expect(root.properties.updatedGaps.type).toBe('array');
    });

    it('has items with required id, impact, urgency', () => {
      const items = root.properties.updatedGaps.items;
      expect(items.type).toBe('object');
      expect(items.required).toEqual(['id', 'impact', 'urgency']);
    });

    it('id is a string', () => {
      expect(root.properties.updatedGaps.items.properties.id.type).toBe('string');
    });

    it('impact is an integer with bounds 1-10', () => {
      const impact = root.properties.updatedGaps.items.properties.impact;
      expect(impact.type).toBe('integer');
      expect(impact.minimum).toBe(1);
      expect(impact.maximum).toBe(10);
    });

    it('urgency is an integer with bounds 1-10', () => {
      const urgency = root.properties.updatedGaps.items.properties.urgency;
      expect(urgency.type).toBe('integer');
      expect(urgency.minimum).toBe(1);
      expect(urgency.maximum).toBe(10);
    });

    it('disallows additional properties on updatedGaps items', () => {
      expect(root.properties.updatedGaps.items.additionalProperties).toBe(false);
    });
  });

  describe('resolvedGapIds field', () => {
    it('is an array of strings', () => {
      expect(root.properties.resolvedGapIds.type).toBe('array');
      expect(root.properties.resolvedGapIds.items.type).toBe('string');
    });
  });
});
