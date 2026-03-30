/**
 * @module SafetyEngine Tests
 * @description Comprehensive tests for the granular safety tier engine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyEngine } from './safety-engine';
import { SafetyTier } from './types/agent';
import { DEFAULT_POLICIES } from './safety-config';

// Mock logger
vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock SafetyConfigManager to return local policies when set
vi.mock('./safety-config-manager', () => {
  let mockPolicies = null;

  return {
    SafetyConfigManager: {
      getPolicies: vi.fn().mockImplementation(() => {
        // Return mock policies if set, otherwise return DEFAULT_POLICIES
        return Promise.resolve(mockPolicies || DEFAULT_POLICIES);
      }),
      // Helper to set mock policies for tests
      __setMockPolicies: (policies) => {
        mockPolicies = policies;
      },
      __resetMockPolicies: () => {
        mockPolicies = null;
      },
    },
  };
});

// Mock SafetyRateLimiter to use in-memory counters
vi.mock('./safety-limiter', () => {
  const rateLimitCounters = new Map<string, { count: number; resetTime: number }>();

  const MockSafetyRateLimiter = function (this: any, _base?: any) {
    rateLimitCounters.clear();

    this.checkRateLimits = (policy: any, action: string) => {
      const now = Date.now();
      console.log('checkRateLimits called', {
        action,
        maxDeploymentsPerDay: policy.maxDeploymentsPerDay,
        maxShellCommandsPerHour: policy.maxShellCommandsPerHour,
        maxFileWritesPerHour: policy.maxFileWritesPerHour,
      });

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

        rateLimitCounters.set(hourKey, { count: count + 1, resetTime: now + 3600000 });
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

        rateLimitCounters.set(hourKey, { count: count + 1, resetTime: now + 3600000 });
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

        rateLimitCounters.set(hourKey, { count: count + 1, resetTime: now + 3600000 });
      }
      return Promise.resolve({ allowed: true, requiresApproval: false });
    };
  };

  return {
    SafetyRateLimiter: MockSafetyRateLimiter,
    ToolSafetyOverride: class {},
  };
});

describe('SafetyEngine', () => {
  let engine: SafetyEngine;

  beforeEach(() => {
    engine = new SafetyEngine();
    engine.clearViolations();
  });

  describe('Tier-based approval', () => {
    it('should require all approvals in SANDBOX tier', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };

      const codeResult = await engine.evaluateAction(config, 'code_change');
      expect(codeResult.requiresApproval).toBe(true);

      const deployResult = await engine.evaluateAction(config, 'deployment');
      expect(deployResult.requiresApproval).toBe(true);

      const fileResult = await engine.evaluateAction(config, 'file_operation');
      expect(fileResult.requiresApproval).toBe(true);

      const shellResult = await engine.evaluateAction(config, 'shell_command');
      expect(shellResult.requiresApproval).toBe(true);

      const mcpResult = await engine.evaluateAction(config, 'mcp_tool');
      expect(mcpResult.requiresApproval).toBe(true);
    });

    it('should require no approvals in AUTONOMOUS tier', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const codeResult = await engine.evaluateAction(config, 'code_change');
      expect(codeResult.requiresApproval).toBe(false);
      expect(codeResult.allowed).toBe(true);

      const deployResult = await engine.evaluateAction(config, 'deployment');
      expect(deployResult.requiresApproval).toBe(false);

      const fileResult = await engine.evaluateAction(config, 'file_operation');
      expect(fileResult.requiresApproval).toBe(false);

      const shellResult = await engine.evaluateAction(config, 'shell_command');
      expect(shellResult.requiresApproval).toBe(false);
    });

    it('should default to SANDBOX when no tier is specified', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
      };

      const deployResult = await engine.evaluateAction(config, 'deployment');
      expect(deployResult.requiresApproval).toBe(true);

      const codeResult = await engine.evaluateAction(config, 'code_change');
      expect(codeResult.requiresApproval).toBe(true);
    });
  });

  describe('Resource-level controls', () => {
    it('should block access to .git files', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result = await engine.evaluateAction(config, 'file_operation', {
        resource: '.git/config',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block access to .env files', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result = await engine.evaluateAction(config, 'file_operation', {
        resource: '.env.local',
      });

      expect(result.allowed).toBe(false);
    });

    it('should block access to lock files', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const lockResult = await engine.evaluateAction(config, 'file_operation', {
        resource: 'package-lock.json',
      });
      expect(lockResult.allowed).toBe(false);

      const pnpmResult = await engine.evaluateAction(config, 'file_operation', {
        resource: 'pnpm-lock.yaml',
      });
      expect(pnpmResult.allowed).toBe(false);
    });

    it('should block access to node_modules', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result = await engine.evaluateAction(config, 'file_operation', {
        resource: 'node_modules/some-package/index.js',
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow access to regular source files', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result = await engine.evaluateAction(config, 'file_operation', {
        resource: 'src/app.ts',
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('Tool-specific overrides', () => {
    it('should enforce tool-level approval requirement', async () => {
      engine.setToolOverride({
        toolName: 'dangerousTool',
        requireApproval: true,
      });

      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result = await engine.evaluateAction(config, 'some_action', {
        toolName: 'dangerousTool',
      });

      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('dangerousTool');
    });

    it('should enforce tool-specific hourly rate limits', async () => {
      engine.setToolOverride({
        toolName: 'limitedTool',
        maxUsesPerHour: 2,
      });

      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result1 = await engine.evaluateAction(config, 'action', { toolName: 'limitedTool' });
      expect(result1.allowed).toBe(true);

      const result2 = await engine.evaluateAction(config, 'action', { toolName: 'limitedTool' });
      expect(result2.allowed).toBe(true);

      const result3 = await engine.evaluateAction(config, 'action', { toolName: 'limitedTool' });
      expect(result3.allowed).toBe(false);
      expect(result3.reason).toContain('rate limit');
    });

    it('should remove tool override', async () => {
      engine.setToolOverride({
        toolName: 'tempTool',
        requireApproval: true,
      });

      engine.removeToolOverride('tempTool');

      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };
      const result = await engine.evaluateAction(config, 'code_change', { toolName: 'tempTool' });

      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('Rate limiting', () => {
    it('should enforce deployment daily limits', async () => {
      // Create a new engine with custom policies for this test
      const { SafetyConfigManager } = await import('./safety-config-manager');
      const testPolicies = {
        [SafetyTier.SANDBOX]: DEFAULT_POLICIES[SafetyTier.SANDBOX],
        [SafetyTier.AUTONOMOUS]: {
          ...DEFAULT_POLICIES[SafetyTier.AUTONOMOUS],
          maxDeploymentsPerDay: 2,
        },
      };

      // Mock the getPolicies to return our test policies
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

    it('should enforce file write hourly limits', async () => {
      const { SafetyConfigManager } = await import('./safety-config-manager');
      const testPolicies = {
        [SafetyTier.SANDBOX]: DEFAULT_POLICIES[SafetyTier.SANDBOX],
        [SafetyTier.AUTONOMOUS]: {
          ...DEFAULT_POLICIES[SafetyTier.AUTONOMOUS],
          maxFileWritesPerHour: 1,
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

      await testEngine.evaluateAction(config, 'file_operation');
      const result = await testEngine.evaluateAction(config, 'file_operation');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('File write rate limit');
    });
  });

  describe('Custom policies', () => {
    it('should apply custom policy overrides', async () => {
      const { SafetyConfigManager } = await import('./safety-config-manager');
      const testPolicies = {
        [SafetyTier.SANDBOX]: DEFAULT_POLICIES[SafetyTier.SANDBOX],
        [SafetyTier.AUTONOMOUS]: {
          ...DEFAULT_POLICIES[SafetyTier.AUTONOMOUS],
          requireDeployApproval: true,
        },
      };

      (SafetyConfigManager.getPolicies as any).mockResolvedValue(testPolicies);

      const customEngine = new SafetyEngine(testPolicies);
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };
      const result = await customEngine.evaluateAction(config, 'deployment');

      expect(result.requiresApproval).toBe(true);
    });
  });

  describe('Violation logging', () => {
    it('should log blocked actions', async () => {
      const config = {
        id: 'agent1',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      await engine.evaluateAction(config, 'file_operation', {
        resource: '.env',
        traceId: 'trace123',
        userId: 'user1',
      });

      const violations = engine.getViolations();
      expect(violations.length).toBe(1);
      expect(violations[0].agentId).toBe('agent1');
      expect(violations[0].outcome).toBe('blocked');
      expect(violations[0].traceId).toBe('trace123');
      expect(violations[0].userId).toBe('user1');
    });

    it('should log approval-required actions', async () => {
      const config = {
        id: 'agent1',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };

      await engine.evaluateAction(config, 'code_change');

      const violations = engine.getViolations();
      expect(violations.length).toBe(1);
      expect(violations[0].outcome).toBe('approval_required');
    });

    it('should filter violations by agent', async () => {
      const config1 = {
        id: 'agent1',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };
      const config2 = {
        id: 'agent2',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };

      await engine.evaluateAction(config1, 'code_change');
      await engine.evaluateAction(config2, 'file_operation', { resource: '.env' });
      await engine.evaluateAction(config1, 'file_operation');

      const agent1Violations = engine.getViolationsByAgent('agent1');
      expect(agent1Violations.length).toBe(2);

      const agent2Violations = engine.getViolationsByAgent('agent2');
      expect(agent2Violations.length).toBe(1);
    });

    it('should filter violations by action type', async () => {
      const config = {
        id: 'agent1',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };

      await engine.evaluateAction(config, 'code_change');
      await engine.evaluateAction(config, 'deployment');
      await engine.evaluateAction(config, 'code_change');

      const codeViolations = engine.getViolationsByAction('code_change');
      expect(codeViolations.length).toBe(2);

      const deployViolations = engine.getViolationsByAction('deployment');
      expect(deployViolations.length).toBe(1);
    });

    it('should generate violation statistics', async () => {
      const config1 = {
        id: 'agent1',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };
      const config2 = {
        id: 'agent2',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      await engine.evaluateAction(config1, 'code_change');
      await engine.evaluateAction(config1, 'deployment');
      await engine.evaluateAction(config2, 'file_operation', { resource: '.env' });

      const stats = engine.getStats();

      expect(stats.totalViolations).toBe(3);
      expect(stats.approvalRequired).toBe(2);
      expect(stats.blockedActions).toBe(1);
      expect(stats.byTier[SafetyTier.SANDBOX]).toBe(2);
      expect(stats.byTier[SafetyTier.AUTONOMOUS]).toBe(1);
    });

    it('should clear violations', async () => {
      const config = {
        id: 'agent1',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.SANDBOX,
      };
      await engine.evaluateAction(config, 'code_change');

      expect(engine.getViolations().length).toBe(1);

      engine.clearViolations();

      expect(engine.getViolations().length).toBe(0);
    });
  });

  describe('Glob pattern matching', () => {
    it('should match ** wildcards', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result1 = await engine.evaluateAction(config, 'file_operation', {
        resource: 'node_modules/pkg/sub/file.js',
      });
      expect(result1.allowed).toBe(false);

      const result2 = await engine.evaluateAction(config, 'file_operation', {
        resource: '.git/objects/abc',
      });
      expect(result2.allowed).toBe(false);
    });

    it('should match * wildcards', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.AUTONOMOUS,
      };

      const result = await engine.evaluateAction(config, 'file_operation', {
        resource: '.env.production',
      });
      expect(result.allowed).toBe(false);
    });
  });
});
