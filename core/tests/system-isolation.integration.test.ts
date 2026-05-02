import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SafetyEngine } from '../lib/safety/safety-engine';
import { SafetyTier, AgentCategory } from '../lib/types/agent';

// Mock Dependencies
vi.mock('../lib/utils/ddb-client', () => ({
  getDocClient: vi.fn(),
  getMemoryTableName: vi.fn(() => 'MemoryTable'),
}));

vi.mock('../lib/safety/blast-radius-store', () => ({
  getBlastRadiusStore: vi.fn(() => ({
    incrementBlastRadius: vi
      .fn()
      .mockResolvedValue({ count: 1, resourceCount: 1, lastAction: Date.now() }),
    canExecute: vi.fn().mockResolvedValue({ allowed: true }),
    getLocalStats: vi.fn(() => ({})),
  })),
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'backbone-agent',
      safetyTier: 'LOCAL',
      enabled: true,
    }),
    isBackboneAgent: vi.fn((id) => id === 'backbone-agent'),
  },
}));

vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(),
    atomicUpdateMapEntity: vi.fn(),
  },
}));

const { mockPolicies } = vi.hoisted(() => ({
  mockPolicies: {
    LOCAL: {
      tier: 'LOCAL',
      blockedFilePaths: ['.env', '.git/**'],
    },
    PROD: {
      tier: 'PROD',
      blockedFilePaths: ['.env'],
      requireDeployApproval: true,
    },
  },
}));

vi.mock('../lib/safety/safety-config-manager', () => ({
  SafetyConfigManager: {
    getPolicies: vi.fn().mockResolvedValue(mockPolicies),
  },
}));

describe('SYSTEM Identity Isolation Integration [Perspective G]', () => {
  let engine: SafetyEngine;
  const config = {
    id: 'backbone-agent',
    name: 'Backbone',
    safetyTier: SafetyTier.LOCAL,
    category: AgentCategory.SYSTEM,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new SafetyEngine();
    engine.updatePolicy(SafetyTier.LOCAL, {
      tier: SafetyTier.LOCAL,
      blockedFilePaths: ['.env', '.git/**'],
    });
    engine.updatePolicy(SafetyTier.PROD, {
      tier: SafetyTier.PROD,
      blockedFilePaths: ['.env'],
      requireDeployApproval: true,
    });
  });

  it('rejects SYSTEM action when workspaceId is missing (Fail-Closed)', async () => {
    const result = await engine.evaluateAction(config, 'deployment', {
      userId: 'SYSTEM',
      // workspaceId missing
    });

    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('system_rbac_unscoped');
    expect(result.reason).toContain('Missing mandatory workspaceId');
  });

  it('allows SYSTEM action when workspaceId is present', async () => {
    const result = await engine.evaluateAction(config, 'deployment', {
      userId: 'SYSTEM',
      workspaceId: 'ws-123',
    });

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('enforces standard resource protection (blocked_resource)', async () => {
    const result = await engine.evaluateAction(config, 'file_operation', {
      userId: 'SYSTEM',
      workspaceId: 'ws-123',
      resource: '.env', // Standard blocked resource in default policy
    });

    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('blocked_resource');
  });

  it('enforces critical system protection escalation (system_protection) even if policy is permissive', async () => {
    // Custom engine with permissive policy that doesn't block 'core/**'
    const permissiveEngine = new SafetyEngine({
      [SafetyTier.LOCAL]: {
        blockedFilePaths: [], // No paths blocked at policy level
      },
    });

    const result = await permissiveEngine.evaluateAction(config, 'file_operation', {
      userId: 'SYSTEM',
      workspaceId: 'ws-123',
      resource: 'core/lib/safety/safety-engine.ts', // Still protected by hard-coded system rules
    });

    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('system_protection');
  });

  it('allows non-protected resource for scoped SYSTEM tasks', async () => {
    const result = await engine.evaluateAction(config, 'file_operation', {
      userId: 'SYSTEM',
      workspaceId: 'ws-123',
      resource: 'src/app.ts',
    });

    expect(result.allowed).toBe(true);
  });
});
