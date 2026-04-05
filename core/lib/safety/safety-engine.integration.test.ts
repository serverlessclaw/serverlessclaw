/**
 * @module SafetyEngine Integration Tests
 * Tests cross-component safety evaluation with real state transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyEngine } from './safety-engine';
import { SafetyTier } from '../types/agent';
import { DEFAULT_POLICIES } from './safety-config';
import { getCircuitBreaker, resetCircuitBreakerInstance } from './circuit-breaker';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
    MemoryTable: { name: 'test-memory-table' },
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

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(async (_key: string, fallback: unknown) => fallback),
  },
}));

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(async (_key: string, fallback: unknown) => fallback),
  },
}));

vi.mock('./safety-config-manager', () => {
  let mockPolicies: unknown = null;

  return {
    SafetyConfigManager: {
      getPolicies: vi.fn().mockImplementation(() => {
        return Promise.resolve(mockPolicies || DEFAULT_POLICIES);
      }),
      __setMockPolicies: (policies: unknown) => {
        mockPolicies = policies;
      },
      __resetMockPolicies: () => {
        mockPolicies = null;
      },
    },
  };
});

vi.mock('./safety-limiter', () => {
  const rateLimitCounters = new Map<string, { count: number; resetTime: number }>();

  const MockSafetyRateLimiter = function (this: any, _base?: any) {
    rateLimitCounters.clear();

    this.checkRateLimits = (policy: any, action: string) => {
      const now = Date.now();

      if (action === 'deployment' && policy.maxDeploymentsPerDay) {
        const dayKey = `deployment_day_${Math.floor(now / 86400000)}`;
        const counter = rateLimitCounters.get(dayKey);
        const count = counter ? counter.count : 0;

        if (count >= policy.maxDeploymentsPerDay) {
          return Promise.resolve({
            allowed: false,
            requiresApproval: false,
            reason: `Deployment rate limit exceeded (${policy.maxDeploymentsPerDay}/day)`,
            appliedPolicy: 'rate_limit_daily',
          });
        }

        rateLimitCounters.set(dayKey, { count: count + 1, resetTime: now + 86400000 });
      }

      if (action === 'shell_command' && policy.maxShellCommandsPerHour) {
        const hourKey = `shell_command_hour_${Math.floor(now / 3600000)}`;
        const counter = rateLimitCounters.get(hourKey);
        const count = counter ? counter.count : 0;

        if (count >= policy.maxShellCommandsPerHour) {
          return Promise.resolve({
            allowed: false,
            requiresApproval: false,
            reason: `Shell command rate limit exceeded (${policy.maxShellCommandsPerHour}/hour)`,
            appliedPolicy: 'rate_limit_hourly',
          });
        }

        rateLimitCounters.set(hourKey, { count: count + 1, resetTime: now + 360000 });
      }

      if (action === 'file_operation' && policy.maxFileWritesPerHour) {
        const hourKey = `file_operation_hour_${Math.floor(now / 3600000)}`;
        const counter = rateLimitCounters.get(hourKey);
        const count = counter ? counter.count : 0;

        if (count >= policy.maxFileWritesPerHour) {
          return Promise.resolve({
            allowed: false,
            requiresApproval: false,
            reason: `File write rate limit exceeded (${policy.maxFileWritesPerHour}/hour)`,
            appliedPolicy: 'rate_limit_hourly',
          });
        }

        rateLimitCounters.set(hourKey, { count: count + 1, resetTime: now + 360000 });
      }

      return Promise.resolve({ allowed: true, requiresApproval: false });
    };

    this.checkToolRateLimit = (override: any, toolName: string) => {
      if (!override) return Promise.resolve({ allowed: true, requiresApproval: false });

      const now = Date.now();
      if (override.maxUsesPerHour) {
        const hourKey = `tool_${toolName}_hour_${Math.floor(now / 3600000)}`;
        const counter = rateLimitCounters.get(hourKey);
        const count = counter ? counter.count : 0;

        if (count >= override.maxUsesPerHour) {
          return Promise.resolve({
            allowed: false,
            requiresApproval: false,
            reason: `Tool '${toolName}' rate limit exceeded (${override.maxUsesPerHour}/hour)`,
            appliedPolicy: 'tool_rate_limit_hourly',
          });
        }

        rateLimitCounters.set(hourKey, { count: count + 1, resetTime: now + 360000 });
      }
      return Promise.resolve({ allowed: true, requiresApproval: false });
    };
  };

  return {
    SafetyRateLimiter: MockSafetyRateLimiter,
    ToolSafetyOverride: class {},
  };
});

describe('Safety Engine Integration', () => {
  let engine: SafetyEngine;
  const ddbStore = new Map<string, Record<string, unknown>>();

  beforeEach(async () => {
    ddbMock.reset();
    ddbStore.clear();

    ddbMock.on(GetCommand).callsFake((input: { Key: { key: string } }) => {
      const item = ddbStore.get(input.Key.key);
      return { Item: item };
    });

    ddbMock.on(PutCommand).callsFake((input: { Item: Record<string, unknown> }) => {
      ddbStore.set(input.Item.key as string, input.Item);
      return {};
    });

    engine = new SafetyEngine();
    engine.clearViolations();
    resetCircuitBreakerInstance();
    const { SafetyConfigManager } = await import('./safety-config-manager');
    (SafetyConfigManager as any).__resetMockPolicies();
  });

  describe('Cross-tier safety evaluation', () => {
    it('should enforce SANDBOX tier requiring all approvals', async () => {
      const config = {
        id: 'sandbox-agent',
        name: 'SandboxAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };

      const actions = ['code_change', 'deployment', 'file_operation', 'shell_command', 'mcp_tool'];

      for (const action of actions) {
        const result = await engine.evaluateAction(config, action);
        expect(result.requiresApproval).toBe(true);
      }
    });

    it('should allow AUTONOMOUS tier with no approvals for standard actions', async () => {
      const config = {
        id: 'autonomous-agent',
        name: 'AutonomousAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const actions = ['code_change', 'deployment', 'file_operation', 'shell_command'];

      for (const action of actions) {
        const result = await engine.evaluateAction(config, action);
        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(false);
      }
    });

    it('should still block protected resources in AUTONOMOUS tier', async () => {
      const config = {
        id: 'autonomous-agent',
        name: 'AutonomousAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const blockedResources = ['.git/config', '.env.local', 'node_modules/pkg/index.js'];

      for (const resource of blockedResources) {
        const result = await engine.evaluateAction(config, 'file_operation', { resource });
        expect(result.allowed).toBe(false);
      }
    });
  });

  describe('Circuit breaker state transitions', () => {
    it('should transition from CLOSED to OPEN after threshold failures', async () => {
      const cb = getCircuitBreaker();

      const initialState = await cb.getState();
      expect(initialState.state).toBe('closed');

      for (let i = 0; i < 5; i++) {
        await cb.recordFailure('health');
      }

      const finalState = await cb.getState();
      expect(finalState.state).toBe('open');
    });

    it('should allow emergency deployment even when circuit is OPEN', async () => {
      const cb = getCircuitBreaker();

      for (let i = 0; i < 5; i++) {
        await cb.recordFailure('health');
      }

      const state = await cb.getState();
      expect(state.state).toBe('open');

      const canProceed = await cb.canProceed('emergency');
      expect(canProceed.allowed).toBe(true);
      expect(canProceed.reason).toBe('EMERGENCY_BYPASS');
    });

    it('should record success and transition from HALF_OPEN to CLOSED', async () => {
      const { ConfigManager } = await import('../registry/config');
      (ConfigManager.getTypedConfig as any).mockImplementation(
        async (key: string, fallback: unknown) => {
          if (key === 'circuit_breaker_cooldown_ms') return 0;
          if (key === 'circuit_breaker_half_open_max') return 3;
          return fallback;
        }
      );

      const cb = getCircuitBreaker();

      for (let i = 0; i < 5; i++) {
        await cb.recordFailure('health');
      }

      await cb.canProceed('autonomous');

      const halfOpenState = await cb.getState();
      expect(halfOpenState.state).toBe('half_open');

      await cb.recordSuccess();

      const closedState = await cb.getState();
      expect(closedState.state).toBe('closed');
    });
  });

  describe('Rate limiting enforcement', () => {
    it('should enforce daily deployment limits', async () => {
      const { SafetyConfigManager } = await import('./safety-config-manager');
      const testPolicies = {
        [SafetyTier.SANDBOX]: DEFAULT_POLICIES[SafetyTier.SANDBOX],
        [SafetyTier.AUTONOMOUS]: {
          ...DEFAULT_POLICIES[SafetyTier.AUTONOMOUS],
          maxDeploymentsPerDay: 2,
        },
      };

      (SafetyConfigManager.getPolicies as any).mockResolvedValue(testPolicies);

      const testEngine = new SafetyEngine(testPolicies);
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result1 = await testEngine.evaluateAction(config, 'deployment');
      expect(result1.allowed).toBe(true);

      const result2 = await testEngine.evaluateAction(config, 'deployment');
      expect(result2.allowed).toBe(true);

      const result3 = await testEngine.evaluateAction(config, 'deployment');
      expect(result3.allowed).toBe(false);
      expect(result3.reason).toContain('rate limit');
    });

    it('should enforce shell command hourly limits', async () => {
      const { SafetyConfigManager } = await import('./safety-config-manager');
      const testPolicies = {
        [SafetyTier.SANDBOX]: DEFAULT_POLICIES[SafetyTier.SANDBOX],
        [SafetyTier.AUTONOMOUS]: {
          ...DEFAULT_POLICIES[SafetyTier.AUTONOMOUS],
          maxShellCommandsPerHour: 2,
        },
      };

      (SafetyConfigManager.getPolicies as any).mockResolvedValue(testPolicies);

      const testEngine = new SafetyEngine(testPolicies);
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      await testEngine.evaluateAction(config, 'shell_command');
      await testEngine.evaluateAction(config, 'shell_command');

      const result = await testEngine.evaluateAction(config, 'shell_command');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Shell command rate limit');
    });
  });

  describe('Violation tracking across evaluations', () => {
    it('should accumulate violations from multiple evaluations', async () => {
      const config = {
        id: 'test-agent',
        name: 'TestAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };

      await engine.evaluateAction(config, 'code_change');
      await engine.evaluateAction(config, 'deployment');
      await engine.evaluateAction(config, 'shell_command');

      const violations = engine.getViolations();
      expect(violations.length).toBe(3);

      const stats = engine.getStats();
      expect(stats.totalViolations).toBe(3);
      expect(stats.approvalRequired).toBe(3);
    });

    it('should track blocked vs approval-required violations separately', async () => {
      const autonomousConfig = {
        id: 'autonomous-agent',
        name: 'AutonomousAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      await engine.evaluateAction(autonomousConfig, 'file_operation', {
        resource: '.env',
      });

      const sandboxConfig = {
        id: 'sandbox-agent',
        name: 'SandboxAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };

      await engine.evaluateAction(sandboxConfig, 'code_change');

      const stats = engine.getStats();
      expect(stats.blockedActions).toBe(1);
      expect(stats.approvalRequired).toBe(1);
    });
  });
});
