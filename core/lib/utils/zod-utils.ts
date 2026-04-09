/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { JsonSchema } from '../types/tool';

/**
 * Converts a subset of JSON Schema to a Zod schema.
 * Primarily used for MCP tool argument validation.
 */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodSchema {
  if (!schema) return z.any();

  switch (schema.type) {
    case 'string': {
      let zodSchema: z.ZodType<any> = z.string();
      if (schema.enum) {
        zodSchema = z.enum(schema.enum as [string, ...string[]]);
      }
      return schema.description ? zodSchema.describe(schema.description) : zodSchema;
    }
    case 'number':
    case 'integer': {
      const zodSchema = schema.type === 'integer' ? z.number().int() : z.number();
      return schema.description ? zodSchema.describe(schema.description) : zodSchema;
    }
    case 'boolean': {
      const zodSchema = z.boolean();
      return schema.description ? zodSchema.describe(schema.description) : zodSchema;
    }
    case 'array': {
      if (!schema.items) return z.array(z.any());
      const itemsSchema = jsonSchemaToZod(schema.items);
      const zodSchema = z.array(itemsSchema);
      return schema.description ? zodSchema.describe(schema.description) : zodSchema;
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

      let zodSchema = z.object(shape);
      if (schema.additionalProperties === false) {
        zodSchema = zodSchema.strict();
      } else {
        zodSchema = zodSchema.passthrough();
      }

      return schema.description ? zodSchema.describe(schema.description) : zodSchema;
    }
    default:
      return z.any();
  }
}
