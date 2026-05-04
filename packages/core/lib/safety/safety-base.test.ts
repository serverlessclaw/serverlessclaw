import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SafetyBase } from './safety-base';
import { SafetyTier } from '../types/agent';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: {
      name: 'TestMemoryTable',
    },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({
        send: mockSend,
      }),
    },
  };
});

describe('SafetyBase', () => {
  let safetyBase: SafetyBase;

  beforeEach(() => {
    vi.clearAllMocks();
    safetyBase = new SafetyBase();
  });

  describe('Class C / Class D Action Classification', () => {
    describe('isClassCAction', () => {
      it('should identify Class C actions (approvable)', () => {
        expect(safetyBase.isClassCAction('iam_change')).toBe(true);
        expect(safetyBase.isClassCAction('infra_topology')).toBe(true);
        expect(safetyBase.isClassCAction('deployment')).toBe(true);
        expect(safetyBase.isClassCAction('security_guardrail')).toBe(true);
        expect(safetyBase.isClassCAction('memory_retention')).toBe(true);
        expect(safetyBase.isClassCAction('tool_permission')).toBe(true);
        expect(safetyBase.isClassCAction('code_change')).toBe(true);
        expect(safetyBase.isClassCAction('audit_override')).toBe(true);
      });

      it('should be case insensitive', () => {
        expect(safetyBase.isClassCAction('IAM_CHANGE')).toBe(true);
        expect(safetyBase.isClassCAction('Deployment')).toBe(true);
      });
    });

    describe('isClassDAction', () => {
      it('should identify Class D actions (blocked)', () => {
        expect(safetyBase.isClassDAction('trust_manipulation')).toBe(true);
        expect(safetyBase.isClassDAction('mode_shift')).toBe(true);
        expect(safetyBase.isClassDAction('policy_core_override')).toBe(true);
      });
    });
  });

  describe('persistViolation', () => {
    it('should persist violation to MemoryTable with proper TTL and prefix', async () => {
      const violation = safetyBase.createViolation(
        'test-agent',
        SafetyTier.PROD,
        'code_change',
        'fs-write',
        'src/file.ts',
        'Policy violation',
        'blocked',
        'trace-123'
      );

      const success = await safetyBase.persistViolation(violation);
      expect(success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const callParams = mockSend.mock.calls[0][0].input;
      expect(callParams.TableName).toBe('TestMemoryTable');
      expect(callParams.Item.userId).toBe(`SAFETY#VIOLATION#test-agent`);
      expect(callParams.Item.type).toBe('SAFETY_VIOLATION');
      expect(callParams.Item.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(callParams.Item.value).toEqual(violation);
    });
  });

  describe('matchesGlob', () => {
    it('should match exact paths', () => {
      expect(safetyBase.matchesGlob('package.json', 'package.json')).toBe(true);
    });

    it('should match wildcards', () => {
      expect(safetyBase.matchesGlob('core/lib/foo.ts', 'core/**')).toBe(true);
    });
  });
});
