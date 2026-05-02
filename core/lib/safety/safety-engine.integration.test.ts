/**
 * @module SafetyEngine Integration Tests
 * Tests cross-component safety evaluation with real state transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyEngine } from './safety-engine';
import { SafetyTier, AgentCategory } from '../types/agent';

const { mockDefaults } = vi.hoisted(() => {
  return {
    mockDefaults: {
      local: {
        tier: 'local' as unknown as SafetyTier,
        requireCodeApproval: false,
        requireDeployApproval: false,
        requireFileApproval: false,
        requireShellApproval: false,
        requireMcpApproval: false,
        blockedFilePaths: ['.git/**', '.env', 'package-lock.json', 'node_modules/**'],
        maxDeploymentsPerDay: 50,
        maxShellCommandsPerHour: 200,
        maxFileWritesPerHour: 500,
      },
      prod: {
        tier: 'prod' as unknown as SafetyTier,
        requireCodeApproval: false,
        requireDeployApproval: true,
        requireFileApproval: false,
        requireShellApproval: true,
        requireMcpApproval: true,
        blockedFilePaths: ['.git/**', '.env', 'package-lock.json', 'node_modules/**'],
        maxDeploymentsPerDay: 10,
        maxShellCommandsPerHour: 50,
        maxFileWritesPerHour: 100,
      },
    },
  };
});

// Mock Logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock SafetyConfigManager
vi.mock('./safety-config-manager', () => {
  const defaults = {
    local: mockDefaults.local,
    prod: mockDefaults.prod,
  };
  return {
    DEFAULT_POLICIES: defaults,
    SafetyConfigManager: {
      getPolicies: vi.fn(async () => defaults),
      getPolicy: vi.fn(async (tier: string) => (defaults as any)[tier]),
    },
  };
});

// Mock AgentRegistry
vi.mock('../registry/AgentRegistry', () => ({
  AgentRegistry: {
    atomicAddAgentField: vi.fn().mockResolvedValue(100),
    getAgentConfig: vi.fn(),
  },
}));

// Mock BlastRadiusStore
vi.mock('./blast-radius-store', () => {
  const mockStore = {
    canExecute: vi.fn().mockResolvedValue({ allowed: true }),
    incrementBlastRadius: vi.fn().mockResolvedValue({ count: 1 }),
  };
  return {
    BlastRadiusStore: vi.fn(() => mockStore),
    getBlastRadiusStore: vi.fn(() => mockStore),
  };
});

describe('Safety Engine Integration', () => {
  let engine: SafetyEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use a fixed time outside of business hours (Sunday)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T12:00:00Z')); // Sunday
    engine = new SafetyEngine();
  });

  describe('Cross-tier safety evaluation', () => {
    it('should enforce PROD tier requiring deployment approval', async () => {
      const config = {
        id: 'prod-agent',
        name: 'ProdAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.PROD,
        description: 'test',
        category: AgentCategory.SYSTEM,
        icon: 'test',
        tools: [],
      };

      // deployment should require approval in PROD
      const result = await engine.evaluateAction(config, 'deployment', {
        userId: 'SYSTEM',
        workspaceId: 'ws1',
      });
      expect(result.requiresApproval).toBe(true);
      expect(result.appliedPolicy).toBe('class_c_approval_required');
    });

    it('should allow LOCAL tier with no approvals for standard actions', async () => {
      const config = {
        id: 'local-agent',
        name: 'LocalAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.LOCAL,
        description: 'test',
        category: AgentCategory.SYSTEM,
        icon: 'test',
        tools: [],
      };

      const actions = ['code_change', 'deployment', 'file_operation', 'shell_command', 'mcp_tool'];

      for (const action of actions) {
        const result = await engine.evaluateAction(config, action, {
          userId: 'SYSTEM',
          workspaceId: 'ws1',
        });
        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(false);
      }
    });
  });

  describe('Resource protection integration', () => {
    it('should block protected files even for LOCAL agents', async () => {
      const config = {
        id: 'local-agent',
        name: 'LocalAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.LOCAL,
      };

      const result = await engine.evaluateAction(config, 'file_operation', {
        userId: 'SYSTEM',
        workspaceId: 'ws1',
        resource: '.env.production',
        toolName: 'fileWrite',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
      expect(result.appliedPolicy).toBe('system_protection');
    });

    it('should allow non-protected files for LOCAL agents', async () => {
      const config = {
        id: 'local-agent',
        name: 'LocalAgent',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.LOCAL,
      };

      const result = await engine.evaluateAction(config, 'file_operation', {
        userId: 'SYSTEM',
        workspaceId: 'ws1',
        resource: 'src/components/Button.tsx',
        toolName: 'fileWrite',
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Rate limiting enforcement', () => {
    it('should enforce daily deployment limits', async () => {
      const { SafetyConfigManager } = await import('./safety-config-manager');
      const testPolicies = {
        [SafetyTier.PROD]: mockDefaults.prod,
        [SafetyTier.LOCAL]: {
          ...mockDefaults.local,
          maxDeploymentsPerDay: 2,
        },
      };

      (
        SafetyConfigManager.getPolicies as unknown as { mockResolvedValue: (val: unknown) => void }
      ).mockResolvedValue(testPolicies);

      const testEngine = new SafetyEngine(testPolicies);
      const config = {
        id: 'test',
        name: 'Test',
        systemPrompt: '',
        enabled: true,
        safetyTier: SafetyTier.LOCAL,
      };

      const result1 = await testEngine.evaluateAction(config, 'deployment', {
        userId: 'SYSTEM',
        workspaceId: 'ws1',
      });
      expect(result1.allowed).toBe(true);

      const result2 = await testEngine.evaluateAction(config, 'deployment', {
        userId: 'SYSTEM',
        workspaceId: 'ws1',
      });
      expect(result2.allowed).toBe(true);

      const result3 = await testEngine.evaluateAction(config, 'deployment', {
        userId: 'SYSTEM',
        workspaceId: 'ws1',
      });
      expect(result3.allowed).toBe(false);
      expect(result3.reason).toContain('rate limit');
    });
  });
});
