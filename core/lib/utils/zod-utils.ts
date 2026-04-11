/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { JsonSchema } from '../types/tool';

/**
 * Converts a subset of JSON Schema to a Zod schema.
 * Primarily used for MCP tool argument validation.
 */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodSchema {
  if (!schema) return z.any();

  // Handle anyOf, oneOf, allOf first
  if (schema.anyOf && schema.anyOf.length > 0) {
    return z.union(
      schema.anyOf.map((s) => jsonSchemaToZod(s)) as [z.ZodSchema, z.ZodSchema, ...z.ZodSchema[]]
    );
  }
  if (schema.oneOf && schema.oneOf.length > 0) {
    return z.union(
      schema.oneOf.map((s) => jsonSchemaToZod(s)) as [z.ZodSchema, z.ZodSchema, ...z.ZodSchema[]]
    );
  }
  if (schema.allOf && schema.allOf.length > 0) {
    // Zod intersection only takes two types; for allOf we might need to reduce
    return schema.allOf.reduce((acc, s) => acc.and(jsonSchemaToZod(s)), z.any() as any);
  }

  let zodSchema: z.ZodTypeAny;

  switch (schema.type) {
    case 'string': {
      if (schema.enum) {
        zodSchema = z.enum(schema.enum as [string, ...string[]]);
      } else {
        let strSchema = z.string();
        if (schema.pattern) strSchema = strSchema.regex(new RegExp(schema.pattern));
        if (schema.minLength !== undefined) strSchema = strSchema.min(schema.minLength);
        if (schema.maxLength !== undefined) strSchema = strSchema.max(schema.maxLength);
        zodSchema = strSchema;
      }
      break;
    }
    case 'number':
    case 'integer': {
      let numSchema = schema.type === 'integer' ? z.number().int() : z.number();
      if (schema.minimum !== undefined) numSchema = numSchema.min(schema.minimum);
      if (schema.maximum !== undefined) numSchema = numSchema.max(schema.maximum);
      zodSchema = numSchema;
      break;
    }
    case 'boolean': {
      zodSchema = z.boolean();
      break;
    }
    case 'array': {
      if (!schema.items) {
        zodSchema = z.array(z.any());
      } else {
        const itemsSchema = jsonSchemaToZod(schema.items);
        let arrSchema = z.array(itemsSchema);
        if (schema.minItems !== undefined) arrSchema = (arrSchema as any).min(schema.minItems);
        if (schema.maxItems !== undefined) arrSchema = (arrSchema as any).max(schema.maxItems);
        zodSchema = arrSchema;
      }
      break;
    }
    case 'object': {
      const shape: Record<string, z.ZodSchema> = {};
      const properties = schema.properties || {};
      const required = schema.required || [];

      for (const [key, propSchema] of Object.entries(properties)) {
        let zodProp = jsonSchemaToZod(propSchema);
        if (!required.includes(key)) {
          zodProp = zodProp.optional();
        }
        shape[key] = zodProp;
      }

      const objSchema = z.object(shape);
      if (schema.additionalProperties === false) {
        zodSchema = objSchema.strict();
      } else {
        zodSchema = objSchema.passthrough();
      }
      break;
    }
    case 'null': {
      zodSchema = z.null();
      break;
    }
    default:
      zodSchema = z.any();
  }

  if (schema.default !== undefined) {
    zodSchema = (zodSchema as any).default(schema.default);
  }

  return schema.description ? zodSchema.describe(schema.description) : zodSchema;
}
