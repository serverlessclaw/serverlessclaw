import { describe, it, expect } from 'vitest';
import { jsonSchemaToZod } from './zod-utils';

describe('jsonSchemaToZod', () => {
  it('converts string schema', () => {
    const schema = { type: 'string' as const, description: 'a string' };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse('hello')).toBe('hello');
    expect(() => zod.parse(123)).toThrow();
  });

  it('converts string enum schema', () => {
    const schema = { type: 'string' as const, enum: ['a', 'b'] };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse('a')).toBe('a');
    expect(() => zod.parse('c')).toThrow();
  });

  it('converts number and integer schemas', () => {
    const numSchema = { type: 'number' as const };
    const intSchema = { type: 'integer' as const };

    const zodNum = jsonSchemaToZod(numSchema);
    const zodInt = jsonSchemaToZod(intSchema);

    expect(zodNum.parse(1.5)).toBe(1.5);
    expect(zodInt.parse(1)).toBe(1);
    expect(() => zodInt.parse(1.5)).toThrow();
  });

  it('converts boolean schema', () => {
    const schema = { type: 'boolean' as const };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse(true)).toBe(true);
    expect(() => zod.parse('true')).toThrow();
  });

  it('converts object schema with required and optional fields', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        req: { type: 'string' as const },
        opt: { type: 'number' as const },
      },
      required: ['req'],
    };
    const zod = jsonSchemaToZod(schema);

    expect(zod.parse({ req: 'hi' })).toEqual({ req: 'hi' });
    expect(zod.parse({ req: 'hi', opt: 1 })).toEqual({ req: 'hi', opt: 1 });
    expect(() => zod.parse({ opt: 1 })).toThrow();
  });

  it('handles nested arrays and objects', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        list: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
      },
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse({ list: ['a', 'b'] })).toEqual({ list: ['a', 'b'] });
    expect(() => zod.parse({ list: [1] })).toThrow();
  });

  it('supports strict objects', () => {
    const schema = {
      type: 'object' as const,
      properties: { a: { type: 'string' as const } },
      additionalProperties: false,
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse({ a: 'ok' })).toEqual({ a: 'ok' });
    expect(() => zod.parse({ a: 'ok', b: 1 })).toThrow();
  });

  it('defaults to passthrough for objects', () => {
    const schema = {
      type: 'object' as const,
      properties: { a: { type: 'string' as const } },
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse({ a: 'ok', b: 1 })).toEqual({ a: 'ok', b: 1 });
  });
});
