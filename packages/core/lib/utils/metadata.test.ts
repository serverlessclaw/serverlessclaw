import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Mock the schema imports
vi.mock('../schema/events', () => {
  const makeSchema = <T extends Record<string, unknown>>(defaults: T) =>
    z
      .object(
        Object.fromEntries(
          Object.entries(defaults).map(([k, v]) => {
            if (typeof v === 'string') return [k, z.string().default(v)];
            if (typeof v === 'number') return [k, z.number().default(v)];
            if (Array.isArray(v)) return [k, z.array(z.any()).default(v)];
            return [k, z.any().default(v)];
          })
        ) as z.ZodRawShape
      )
      .default({} as T);

  return {
    CODER_TASK_METADATA: makeSchema({ gapIds: [] as string[], branch: '' }),
    QA_AUDIT_METADATA: makeSchema({ gapIds: [] as string[] }),
    PLANNER_TASK_METADATA: makeSchema({ goal: '', priority: 'medium' }),
    BUILD_TASK_METADATA: makeSchema({ gapIds: [] as string[] }),
    CLARIFICATION_TASK_METADATA: makeSchema({ question: '', context: '' }),
  };
});

import {
  extractMetadata,
  extractCoderMetadata,
  extractQaMetadata,
  extractPlannerMetadata,
  extractBuildMetadata,
  extractClarificationMetadata,
} from './metadata';

describe('extractMetadata', () => {
  const testSchema = z
    .object({
      name: z.string().default('default'),
      count: z.number().default(0),
    })
    .default({ name: 'default', count: 0 });

  it('should parse valid metadata', () => {
    const result = extractMetadata(testSchema, { name: 'test', count: 5 });
    expect(result.name).toBe('test');
    expect(result.count).toBe(5);
  });

  it('should return defaults for missing fields', () => {
    const result = extractMetadata(testSchema, {});
    expect(result.name).toBe('default');
    expect(result.count).toBe(0);
  });

  it('should return defaults when metadata is null', () => {
    const result = extractMetadata(testSchema, null);
    expect(result.name).toBe('default');
    expect(result.count).toBe(0);
  });

  it('should return defaults when metadata is undefined', () => {
    const result = extractMetadata(testSchema, undefined);
    expect(result.name).toBe('default');
    expect(result.count).toBe(0);
  });

  it('should return defaults for invalid metadata', () => {
    const strictSchema = z
      .object({
        count: z.number().default(0),
      })
      .default({ count: 0 });
    const result = extractMetadata(strictSchema, { count: 'not-a-number' });
    expect(result).toBeDefined();
    expect(result.count).toBe(0);
  });
});

describe('extractCoderMetadata', () => {
  it('should extract coder metadata with defaults', () => {
    const result = extractCoderMetadata({});
    expect(result).toBeDefined();
    expect(result).toHaveProperty('branch');
    expect(result).toHaveProperty('gapIds');
  });

  it('should extract provided values', () => {
    const result = extractCoderMetadata({ branch: 'feature/test', gapIds: ['gap-1'] });
    expect(result.branch).toBe('feature/test');
    expect(result.gapIds).toEqual(['gap-1']);
  });
});

describe('extractQaMetadata', () => {
  it('should extract QA metadata with defaults', () => {
    const result = extractQaMetadata({});
    expect(result).toBeDefined();
    expect(result).toHaveProperty('gapIds');
  });
});

describe('extractPlannerMetadata', () => {
  it('should extract planner metadata with defaults', () => {
    const result = extractPlannerMetadata({});
    expect(result).toBeDefined();
    expect(result).toHaveProperty('goal');
    expect(result).toHaveProperty('priority');
  });
});

describe('extractBuildMetadata', () => {
  it('should extract build metadata with defaults', () => {
    const result = extractBuildMetadata({});
    expect(result).toBeDefined();
    expect(result).toHaveProperty('gapIds');
  });
});

describe('extractClarificationMetadata', () => {
  it('should extract clarification metadata with defaults', () => {
    const result = extractClarificationMetadata({});
    expect(result).toBeDefined();
    expect(result).toHaveProperty('question');
    expect(result).toHaveProperty('context');
  });
});
