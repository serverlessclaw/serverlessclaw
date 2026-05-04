import { describe, it, expect } from 'vitest';
import { DEFAULT_SIGNAL_SCHEMA } from './schema';

/**
 * Tests for core/lib/agent/schema.ts
 * Covers: DEFAULT_SIGNAL_SCHEMA structure, signal status enum, required fields
 */

describe('DEFAULT_SIGNAL_SCHEMA', () => {
  const signalSchema = DEFAULT_SIGNAL_SCHEMA as Extract<
    typeof DEFAULT_SIGNAL_SCHEMA,
    { type: 'json_schema' }
  >;
  const schema = signalSchema.json_schema.schema as Record<string, any>;

  it('defines a valid agent_signal schema', () => {
    expect(DEFAULT_SIGNAL_SCHEMA.type).toBe('json_schema');
    expect(signalSchema.json_schema.name).toBe('agent_signal');
    expect(signalSchema.json_schema.strict).toBe(true);
  });

  it('is an object schema', () => {
    expect(schema.type).toBe('object');
  });

  it('has required fields: status, message', () => {
    expect(schema.required).toEqual(['status', 'message']);
  });

  it('disallows additional properties', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  describe('status field', () => {
    it('is a string', () => {
      expect(schema.properties.status.type).toBe('string');
    });

    it('has correct enum values', () => {
      expect(schema.properties.status.enum).toEqual(['SUCCESS', 'FAILED', 'CONTINUE', 'REOPEN']);
    });
  });

  describe('message field', () => {
    it('is a string', () => {
      expect(schema.properties.message.type).toBe('string');
    });
  });

  describe('data field', () => {
    it('is an object', () => {
      expect(schema.properties.data.type).toBe('object');
    });

    it('allows additional properties', () => {
      expect(schema.properties.data.additionalProperties).toBe(true);
    });
  });

  describe('coveredGapIds field', () => {
    it('is an array of strings', () => {
      expect(schema.properties.coveredGapIds.type).toBe('array');
      expect(schema.properties.coveredGapIds.items.type).toBe('string');
    });
  });
});
