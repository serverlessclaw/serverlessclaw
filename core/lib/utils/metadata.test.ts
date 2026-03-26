import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Mock the schema imports
vi.mock('../schema/events', () => {
  const makeSchema = (defaults: Record<string, unknown>) =>
    z
      .object(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, z.any().default(v)])))
      .default({});

  return {
    CODER_TASK_METADATA: makeSchema({ branch: '', repo: '', filePatterns: [] }),
    QA_AUDIT_METADATA: makeSchema({ branch: '', repo: '', auditType: 'full' }),
    PLANNER_TASK_METADATA: makeSchema({ goal: '', priority: 'medium' }),
    BUILD_TASK_METADATA: makeSchema({ branch: '', repo: '', buildType: 'standard' }),
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
    .default({});

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
      .default({});
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
    expect(result).toHaveProperty('repo');
  });

  it('should extract provided values', () => {
    const result = extractCoderMetadata({ branch: 'feature/test', repo: 'myrepo' });
    expect(result.branch).toBe('feature/test');
    expect(result.repo).toBe('myrepo');
  });
});

describe('extractQaMetadata', () => {
  it('should extract QA metadata with defaults', () => {
    const result = extractQaMetadata({});
    expect(result).toBeDefined();
    expect(result).toHaveProperty('auditType');
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
    expect(result).toHaveProperty('buildType');
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
