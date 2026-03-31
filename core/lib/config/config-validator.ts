/**
 * Configuration Schema Validator
 *
 * Validates ConfigTable entries against expected types and ranges.
 * Ensures runtime configuration matches expected schemas.
 */

import { CONFIG_DEFAULTS } from './config-defaults';
import { EvolutionMode } from '../types/agent';

const CONFIG_SCHEMAS = {
  recursion_limit: {
    type: 'number',
    min: 1,
    max: 100,
    description: 'Maximum recursion depth for agent delegation',
  },
  deploy_limit: {
    type: 'number',
    min: 1,
    max: CONFIG_DEFAULTS.MAX_DEPLOY_LIMIT.code,
    description: 'Daily deployment limit',
  },
  circuit_breaker_threshold: {
    type: 'number',
    min: 1,
    max: 10,
    description: 'Consecutive failures before circuit breaker triggers',
  },
  max_tool_iterations: {
    type: 'number',
    min: 1,
    max: 200,
    description: 'Maximum tool calls per agent process',
  },
  stale_gap_days: {
    type: 'number',
    min: 1,
    max: 365,
    description: 'Days before gap considered stale',
  },
  backoff_base_ms: {
    type: 'number',
    min: 60000,
    max: 3600000,
    description: 'Base backoff time in milliseconds',
  },
  mcp_hub_timeout_ms: {
    type: 'number',
    min: 1000,
    max: 30000,
    description: 'MCP hub connection timeout',
  },
  auto_prune_enabled: {
    type: 'boolean',
    description: 'Enable automatic tool pruning',
  },
  tool_prune_threshold_days: {
    type: 'number',
    min: 1,
    max: 90,
    description: 'Days without usage before tool eligible for pruning',
  },
  optimization_policy: {
    type: 'string',
    enum: ['aggressive', 'conservative', 'balanced'],
    description: 'Global optimization policy',
  },
  evolution_mode: {
    type: 'string',
    enum: [EvolutionMode.AUTO, EvolutionMode.HITL] as readonly string[],
    description: 'Evolution mode: auto or human-in-the-loop',
  },
  selective_discovery_mode: {
    type: 'boolean',
    description: 'Enable selective MCP server discovery',
  },
} as const;

export type ConfigSchemaKey = keyof typeof CONFIG_SCHEMAS;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfigValue(key: string, value: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const schema = CONFIG_SCHEMAS[key as ConfigSchemaKey];
  if (!schema) {
    warnings.push(`Unknown config key: ${key}`);
    return { valid: true, errors, warnings };
  }

  if (value === undefined || value === null) {
    return { valid: true, errors, warnings };
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number') {
      errors.push(`Config '${key}' must be a number, got ${typeof value}`);
      return { valid: false, errors, warnings };
    }
    if (schema.min !== undefined && value < schema.min) {
      errors.push(`Config '${key}' must be >= ${schema.min}, got ${value}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      errors.push(`Config '${key}' must be <= ${schema.max}, got ${value}`);
    }
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`Config '${key}' must be a boolean, got ${typeof value}`);
      return { valid: false, errors, warnings };
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`Config '${key}' must be a string, got ${typeof value}`);
      return { valid: false, errors, warnings };
    }
    if (schema.enum && !schema.enum.includes(value as never)) {
      errors.push(`Config '${key}' must be one of: ${schema.enum.join(', ')}, got '${value}'`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateAllConfigs(configs: Record<string, unknown>): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  for (const [key, value] of Object.entries(configs)) {
    const result = validateConfigValue(key, value);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

export function getConfigSchema(
  key: ConfigSchemaKey
): (typeof CONFIG_SCHEMAS)[ConfigSchemaKey] | undefined {
  return CONFIG_SCHEMAS[key];
}

export function getAllConfigSchemas(): Record<
  string,
  { type: string; description: string; enum?: string[] }
> {
  return Object.fromEntries(
    Object.entries(CONFIG_SCHEMAS).map(([key, schema]) => {
      const entry: { type: string; description: string; enum?: string[] } = {
        type: schema.type,
        description: schema.description,
      };
      if ('enum' in schema) {
        entry.enum = [...(schema as { enum: readonly string[] }).enum];
      }
      return [key, entry];
    })
  );
}
