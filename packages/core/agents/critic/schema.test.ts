import { describe, it, expect } from 'vitest';
import { CriticVerdictSchema } from './schema';

/**
 * Tests for core/agents/critic/schema.ts
 * Covers: CriticVerdictSchema structure, verdict enum, findings, required fields
 */

describe('CriticVerdictSchema', () => {
  it('is an object schema', () => {
    expect(CriticVerdictSchema.type).toBe('object');
  });

  it('has all required top-level fields', () => {
    expect(CriticVerdictSchema.required).toEqual([
      'verdict',
      'reviewMode',
      'confidence',
      'findings',
      'summary',
    ]);
  });

  it('disallows additional properties', () => {
    expect(CriticVerdictSchema.additionalProperties).toBe(false);
  });

  describe('verdict field', () => {
    it('is a string', () => {
      expect(CriticVerdictSchema.properties.verdict.type).toBe('string');
    });

    it('has correct enum values', () => {
      expect(CriticVerdictSchema.properties.verdict.enum).toEqual([
        'APPROVED',
        'REJECTED',
        'CONDITIONAL',
      ]);
    });
  });

  describe('reviewMode field', () => {
    it('is a string', () => {
      expect(CriticVerdictSchema.properties.reviewMode.type).toBe('string');
    });

    it('has correct enum values', () => {
      expect(CriticVerdictSchema.properties.reviewMode.enum).toEqual([
        'security',
        'performance',
        'architect',
      ]);
    });
  });

  describe('confidence field', () => {
    it('is a number with bounds 1-10', () => {
      const confidence = CriticVerdictSchema.properties.confidence;
      expect(confidence.type).toBe('number');
      expect(confidence.minimum).toBe(1);
      expect(confidence.maximum).toBe(10);
    });
  });

  describe('findings field', () => {
    it('is an array', () => {
      expect(CriticVerdictSchema.properties.findings.type).toBe('array');
    });

    it('has items with required severity, category, description', () => {
      const items = CriticVerdictSchema.properties.findings.items;
      expect(items.type).toBe('object');
      expect(items.required).toEqual(['severity', 'category', 'description']);
    });

    it('severity is a string with correct enum values', () => {
      const severity = CriticVerdictSchema.properties.findings.items.properties.severity;
      expect(severity.type).toBe('string');
      expect(severity.enum).toEqual(['critical', 'high', 'medium', 'low']);
    });

    it('category is a string', () => {
      expect(CriticVerdictSchema.properties.findings.items.properties.category.type).toBe('string');
    });

    it('description is a string', () => {
      expect(CriticVerdictSchema.properties.findings.items.properties.description.type).toBe(
        'string'
      );
    });

    it('location is a string', () => {
      expect(CriticVerdictSchema.properties.findings.items.properties.location.type).toBe('string');
    });

    it('suggestion is a string', () => {
      expect(CriticVerdictSchema.properties.findings.items.properties.suggestion.type).toBe(
        'string'
      );
    });

    it('disallows additional properties on finding items', () => {
      expect(CriticVerdictSchema.properties.findings.items.additionalProperties).toBe(false);
    });
  });

  describe('summary field', () => {
    it('is a string', () => {
      expect(CriticVerdictSchema.properties.summary.type).toBe('string');
    });
  });
});
