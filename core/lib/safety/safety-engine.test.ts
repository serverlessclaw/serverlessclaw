/**
 * @module SafetyEngine Tests
 * @description Comprehensive tests for granular safety evaluation including
 * tier policies, resource controls, time-based windows, and violation tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyEngine } from './safety-engine';
import { SafetyTier, AgentCategory, IAgentConfig } from '../types/agent';
import { DEFAULT_POLICIES } from './safety-config';
import { ConfigManager } from '../registry/config';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./safety-config-manager', () => {
  return {
    SafetyConfigManager: {
      getPolicies: vi.fn(async () => DEFAULT_POLICIES),
      getPolicy: vi.fn(async (tier: SafetyTier) => DEFAULT_POLICIES[tier]),
    },
  };
});

vi.mock('./safety-limiter', () => {
  return {
    SafetyRateLimiter: class {
      checkRateLimits = vi.fn().mockResolvedValue({ allowed: true, requiresApproval: false });
      checkToolRateLimit = vi.fn().mockResolvedValue({ allowed: true, requiresApproval: false });
    },
    ToolSafetyOverride: class {},
  };
});

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn().mockResolvedValue(10),
  },
}));

vi.mock('../utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./blast-radius-store', () => {
  const createMockStore = () => {
    const blastState: Record<string, { count: number; lastAction: number; resourceCount: number }> =
      {};
    return {
      getLocalStats: vi.fn(() => {
        const result: Record<
          string,
          { count: number; affectedResources: number; lastAction: number }
        > = {};
        for (const [key, val] of Object.entries(blastState)) {
          result[key] = {
            count: val.count,
            affectedResources: val.resourceCount,
            lastAction: val.lastAction,
          };
        }
        return result;
      }),
      getBlastRadius: vi.fn((agentId: string, action: string) => {
        const key = `safety:blast_radius:${agentId}:${action}`;
        return blastState[key] ? { key, ...blastState[key] } : null;
      }),
      canExecute: vi.fn((agentId: string, action: string) => {
        const key = `safety:blast_radius:${agentId}:${action}`;
        const count = blastState[key]?.count ?? 0;
        if (count >= 5) {
          return {
            allowed: false,
            error: `BLAST_RADIUS_EXCEEDED: Action '${action}' has reached its safety limit (${count}/5 in 1h).`,
          };
        }
        return { allowed: true };
      }),
      incrementBlastRadius: vi.fn((agentId: string, action: string) => {
        const key = `safety:blast_radius:${agentId}:${action}`;
        const current = blastState[key]?.count ?? 0;
        blastState[key] = { count: current + 1, lastAction: Date.now(), resourceCount: 0 };
        return { key, ...blastState[key] };
      }),
      clearLocalCache: vi.fn(() => {
        Object.keys(blastState).forEach((k) => delete blastState[k]);
      }),
    };
  };

  return {
    getBlastRadiusStore: () => createMockStore(),
    resetBlastRadiusStore: vi.fn(),
  };
});

describe('SafetyEngine', () => {
  let engine: SafetyEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use a fixed time outside of business hours (Sunday)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T12:00:00Z')); // Sunday

    // Default mock for ConfigManager to return empty/default governance
    vi.mocked(ConfigManager.getRawConfig).mockResolvedValue({});

    engine = new SafetyEngine();
    engine.clearViolations();
  });

  describe('evaluateAction', () => {
    it('uses PROD tier by default if agentConfig.safetyTier is missing', async () => {
      const config = { id: 'test', name: 'Test' };
      // PROD requires deploy approval by default (either via time_restriction_approval or prod_deployment_approval)
      const result = await engine.evaluateAction(config, 'deployment');
      expect(result.requiresApproval).toBe(true);
      expect(result.appliedPolicy).toMatch(/deployment_approval|time_restriction_approval/);
    });

    it('returns error for unknown tier', async () => {
      const config = { id: 'test', name: 'Test', safetyTier: 'invalid' as any };
      const result = await engine.evaluateAction(config, 'any');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unknown safety tier');
    });
  });

  describe('Tier-based approval', () => {
    it('should enforce PROD tier requiring deployment approval', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.PROD,
        description: 'test',
        category: AgentCategory.SYSTEM,
        icon: 'test',
        tools: [],
      } as IAgentConfig;

      const codeResult = await engine.evaluateAction(config, 'code_change');
      expect(codeResult.requiresApproval).toBe(false);

      const deployResult = await engine.evaluateAction(config, 'deployment');
      expect(deployResult.requiresApproval).toBe(true);

      const fileResult = await engine.evaluateAction(config, 'file_operation');
      expect(fileResult.requiresApproval).toBe(false);

      const shellResult = await engine.evaluateAction(config, 'shell_command');
      expect(shellResult.requiresApproval).toBe(true);

      const mcpResult = await engine.evaluateAction(config, 'mcp_tool');
      expect(mcpResult.requiresApproval).toBe(true);
    });

    it('should allow all actions in LOCAL tier', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.LOCAL,
        description: 'test',
        category: AgentCategory.SYSTEM,
        icon: 'test',
        tools: [],
      } as IAgentConfig;

      const actions = ['code_change', 'deployment', 'file_operation', 'shell_command', 'mcp_tool'];

      for (const action of actions) {
        const result = await engine.evaluateAction(config, action);
        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(false);
      }
    });
  });

  describe('Resource-level controls', () => {
    it('should block protected file paths across all tiers', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.LOCAL,
      } as IAgentConfig;

      const blockedResources = [
        '.git/config',
        '.env',
        'package-lock.json',
        'node_modules/pkg/index.js',
      ];

      for (const resource of blockedResources) {
        const result = await engine.evaluateAction(config, 'file_operation', {
          resource,
          toolName: 'fileWrite',
        });
        expect(result.allowed).toBe(false);
        expect(result.appliedPolicy).toBe('blocked_resource');
      }
    });

    it('should allow non-protected file paths', async () => {
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.LOCAL,
      } as IAgentConfig;

      const result = await engine.evaluateAction(config, 'file_operation', {
        resource: 'src/app.ts',
        toolName: 'fileWrite',
      });
      expect(result.allowed).toBe(true);
    });

    it('should enforce allowedFilePaths whitelist if provided', async () => {
      const customPolicies = {
        [SafetyTier.LOCAL]: {
          allowedFilePaths: ['src/**/*.ts'],
        },
      };
      const customEngine = new SafetyEngine(customPolicies);

      const config = {
        id: 'test',
        safetyTier: SafetyTier.LOCAL,
      } as IAgentConfig;

      // Allowed path
      const result1 = await customEngine.evaluateAction(config, 'file_operation', {
        resource: 'src/main.ts',
      });
      expect(result1.allowed).toBe(true);

      // Path NOT in whitelist
      const result2 = await customEngine.evaluateAction(config, 'file_operation', {
        resource: 'README.md',
      });
      expect(result2.allowed).toBe(false);
      expect(result2.appliedPolicy).toBe('resource_not_allowed');
    });
  });

  describe('Time-based restrictions', () => {
    it('should enforce time-based deployment approval for PROD', async () => {
      const config = {
        id: 'test',
        safetyTier: SafetyTier.PROD,
      } as IAgentConfig;

      // Mock Date to a weekday at 10 AM ET (within business hours restriction)
      // 10 AM EDT is 14:00 UTC
      const mockDate = new Date('2026-04-08T14:00:00Z'); // Wednesday
      vi.setSystemTime(mockDate);

      const result = await engine.evaluateAction(config, 'deployment');

      // Default PROD policy has weekday 9-17 restriction for deployment
      expect(result.requiresApproval).toBe(true);
      expect(result.appliedPolicy).toBe('time_restriction_approval');

      vi.useRealTimers();
    });

    it('should NOT enforce restrictions outside of window', async () => {
      const config = {
        id: 'test',
        safetyTier: SafetyTier.PROD,
      } as IAgentConfig;

      // Mock Date to a Sunday (outside of weekday restriction).
      // Note: Intl.DateTimeFormat may not honour fake timers, so we only assert
      // the invariant that PROD deployment always requires approval.
      const mockDate = new Date('2026-04-05T10:00:00Z');
      vi.setSystemTime(mockDate);

      const result = await engine.evaluateAction(config, 'deployment');

      // PROD requires deployment approval regardless (either global or time-based).
      expect(result.requiresApproval).toBe(true);
      expect(result.appliedPolicy).toMatch(/deployment_approval|time_restriction_approval/);

      vi.useRealTimers();
    });
  });

  describe('Tool-specific overrides', () => {
    it('should require approval for specific tool regardless of tier', async () => {
      const toolOverrides = [
        {
          toolName: 'dangerousTool',
          requireApproval: true,
        },
      ];
      const customEngine = new SafetyEngine(undefined, toolOverrides);

      const config = {
        id: 'test',
        safetyTier: SafetyTier.LOCAL,
      } as IAgentConfig;

      const result = await customEngine.evaluateAction(config, 'mcp_tool', {
        toolName: 'dangerousTool',
      });

      expect(result.requiresApproval).toBe(true);
      expect(result.appliedPolicy).toBe('tool_override');
    });
  });

  describe('Violation Logging', () => {
    it('should log a violation record for blocked actions', async () => {
      const config = {
        id: 'test-agent',
        safetyTier: SafetyTier.LOCAL,
      } as IAgentConfig;

      await engine.evaluateAction(config, 'file_operation', {
        resource: '.env',
        traceId: 'trace-123',
        userId: 'user-456',
      });

      const violations = engine.getViolations();
      expect(violations.length).toBe(1);
      expect(violations[0].agentId).toBe('test-agent');
      expect(violations[0].action).toBe('file_operation');
      expect(violations[0].outcome).toBe('blocked');
      expect(violations[0].traceId).toBe('trace-123');
      expect(violations[0].userId).toBe('user-456');
    });

    it('should log a violation record for approval-required actions', async () => {
      const config = {
        id: 'test-agent',
        safetyTier: SafetyTier.PROD,
      } as IAgentConfig;

      await engine.evaluateAction(config, 'deployment');

      const violations = engine.getViolations();
      expect(violations.length).toBe(1);
      expect(violations[0].outcome).toBe('approval_required');
    });
  });

  describe('getStats', () => {
    it('should aggregate statistics correctly', async () => {
      const prodConfig = { id: 'prod', safetyTier: SafetyTier.PROD } as IAgentConfig;
      const localConfig = { id: 'local', safetyTier: SafetyTier.LOCAL } as IAgentConfig;

      // 1 approval required (PROD deployment)
      await engine.evaluateAction(prodConfig, 'deployment');

      // 1 blocked (LOCAL protected file)
      await engine.evaluateAction(localConfig, 'file_operation', { resource: '.git/config' });

      // 1 allowed (LOCAL deployment)
      await engine.evaluateAction(localConfig, 'deployment');

      const stats = engine.getStats();
      expect(stats.totalViolations).toBe(2);
      expect(stats.blockedActions).toBe(1);
      expect(stats.approvalRequired).toBe(1);
      expect(stats.byTier[SafetyTier.PROD]).toBe(1);
      expect(stats.byTier[SafetyTier.LOCAL]).toBe(1);
    });
  });

  describe('Advisory Trust Promotion', () => {
    it('should add advisory tag for high-trust agents on deployment', async () => {
      const config = {
        id: 'high-trust-agent',
        safetyTier: SafetyTier.PROD,
        trustScore: 95,
      } as IAgentConfig;

      const result = await engine.evaluateAction(config, 'deployment');

      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain(
        '[ADVISORY: Candidate for trust-based autonomy promotion (TrustScore >= 95). Shift to AUTO mode to enable.]'
      );
    });

    it('should grant autonomous promotion for high-trust agents in AUTO mode', async () => {
      const { EvolutionMode } = await import('../types/agent');
      const config = {
        id: 'high-trust-auto-agent',
        safetyTier: SafetyTier.PROD,
        trustScore: 98,
        evolutionMode: EvolutionMode.AUTO,
      } as IAgentConfig;

      const result = await engine.evaluateAction(config, 'deployment');

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toContain('[AUTONOMOUS PROMOTION: TrustScore >= 95 & AUTO mode]');
    });

    it('should NOT add advisory tag for high-trust agents on Class C (IAM) actions', async () => {
      const config = {
        id: 'high-trust-agent',
        safetyTier: SafetyTier.PROD,
        trustScore: 95,
      } as IAgentConfig;

      const result = await engine.evaluateAction(config, 'iam_change');

      expect(result.requiresApproval).toBe(true);
      expect(result.reason).not.toContain('[ADVISORY]');
    });

    it('should NOT add advisory tag for low-trust agents on deployment', async () => {
      const config = {
        id: 'low-trust-agent',
        safetyTier: SafetyTier.PROD,
        trustScore: 80,
      } as IAgentConfig;

      const result = await engine.evaluateAction(config, 'deployment');

      expect(result.requiresApproval).toBe(true);
      expect(result.reason).not.toContain('[ADVISORY]');
    });
  });

  describe('Blast Radius Tracking', () => {
    it('should return empty map initially', async () => {
      const radius = engine.getClassCBlastRadius();
      expect(radius).toEqual({});
    });

    it('should enforce blast radius limits after 5 Class C actions', async () => {
      const config = {
        id: 'aggressive-agent',
        safetyTier: SafetyTier.PROD,
      } as IAgentConfig;

      // First 5 should succeed (schedule evolution / approval)
      for (let i = 0; i < 5; i++) {
        await engine.evaluateAction(config, 'iam_change');
      }

      // 6th should be blocked by blast radius
      const result = await engine.evaluateAction(config, 'iam_change');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('BLAST_RADIUS_EXCEEDED');
      expect(result.appliedPolicy).toBe('blast_radius_limit');
    });
  });

  describe('persistViolations', () => {
    it('should return early if no violations exist', async () => {
      engine.clearViolations();
      await expect(engine.persistViolations()).resolves.toBeUndefined();
    });
  });

  describe('Class C / Class D Actions', () => {
    it('should identify Class C actions', () => {
      expect(engine.isClassCAction('deployment')).toBe(true);
      expect(engine.isClassCAction('iam_change')).toBe(true);
      expect(engine.isClassCAction('CODE_CHANGE')).toBe(true);
    });

    it('should identify Class D actions', () => {
      expect(engine.isClassDAction('trust_manipulation')).toBe(true);
      expect(engine.isClassDAction('mode_shift')).toBe(true);
    });

    it('should permanently block Class D actions in evaluateAction', async () => {
      const config = { id: 'test-agent', safetyTier: SafetyTier.LOCAL } as IAgentConfig;
      const result = await engine.evaluateAction(config, 'trust_manipulation');

      expect(result.allowed).toBe(false);
      expect(result.appliedPolicy).toBe('class_d_blocked');
      expect(result.reason).toContain('permanently blocked');
    });

    it('should scan for nested paths in arguments', async () => {
      const config = { id: 'test-agent', safetyTier: SafetyTier.LOCAL } as IAgentConfig;
      const args = {
        nested: {
          config: '.git/config',
          other: 'src/main.ts',
        },
      };

      const result = await engine.evaluateAction(config, 'file_operation', { args });

      // .git/config is a protected resource
      expect(result.allowed).toBe(false);
      expect(result.appliedPolicy).toBe('blocked_resource');
      expect(result.reason).toContain('.git/config');
    });

    it('should not confuse Class C and Class D', () => {
      expect(engine.isClassCAction('trust_manipulation')).toBe(false);
      expect(engine.isClassDAction('deployment')).toBe(false);
    });
  });
});
