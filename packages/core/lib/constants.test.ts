import { describe, it, expect } from 'vitest';
import { LIMITS, TIME, DYNAMO_KEYS, SYSTEM, HTTP_STATUS, TRACE_TYPES } from './constants';

describe('LIMITS', () => {
  it('should have valid numeric limits', () => {
    expect(LIMITS.TRACE_TRUNCATE_LENGTH).toBeGreaterThan(0);
    expect(LIMITS.MAX_CONTEXT_LENGTH).toBeGreaterThan(0);
    expect(LIMITS.STALE_GAP_DAYS).toBeGreaterThan(0);
    expect(LIMITS.TWO_YEARS_DAYS).toBeGreaterThan(0);
  });
});

describe('TIME', () => {
  it('should have valid time constants', () => {
    expect(TIME.MS_PER_SECOND).toBe(1000);
    expect(TIME.SECONDS_IN_MINUTE).toBe(60);
    expect(TIME.SECONDS_IN_DAY).toBe(86400);
  });

  it('should have consistent time calculations', () => {
    expect(TIME.SECONDS_IN_HOUR).toBe(TIME.SECONDS_IN_MINUTE * 60);
    expect(TIME.MS_PER_MINUTE).toBe(TIME.MS_PER_SECOND * 60);
  });
});

describe('DYNAMO_KEYS', () => {
  it('should have valid key strings', () => {
    expect(DYNAMO_KEYS.DEPLOY_LIMIT).toBe('deploy_limit');
    expect(DYNAMO_KEYS.RECURSION_LIMIT).toBe('recursion_limit');
    expect(DYNAMO_KEYS.AGENTS_CONFIG).toBe('agents_config');
  });
});

describe('SYSTEM', () => {
  it('should have valid system defaults', () => {
    expect(SYSTEM.DEFAULT_RECURSION_LIMIT).toBeGreaterThan(0);
    expect(SYSTEM.DEFAULT_DEPLOY_LIMIT).toBeGreaterThan(0);
    expect(SYSTEM.MAX_DEPLOY_LIMIT).toBeGreaterThanOrEqual(SYSTEM.DEFAULT_DEPLOY_LIMIT);
    expect(SYSTEM.USER_ID).toBe('SYSTEM');
  });
});

describe('HTTP_STATUS', () => {
  it('should have valid HTTP status codes', () => {
    expect(HTTP_STATUS.OK).toBe(200);
    expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
  });
});

describe('TRACE_TYPES', () => {
  it('should have valid trace type strings', () => {
    expect(TRACE_TYPES.LLM_CALL).toBe('llm_call');
    expect(TRACE_TYPES.LLM_RESPONSE).toBe('llm_response');
    expect(TRACE_TYPES.TOOL_CALL).toBe('tool_call');
    expect(TRACE_TYPES.TOOL_RESULT).toBe('tool_result');
    expect(TRACE_TYPES.ERROR).toBe('error');
  });
});
