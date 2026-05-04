import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetSafetyEngine } from './safety-engine';
import { SafetyTier, UserRole, IAgentConfig, EvolutionMode } from '../types/agent';

// Mock dependencies
vi.mock('./safety-config-manager', () => ({
  SafetyConfigManager: {
    getPolicies: vi.fn().mockResolvedValue({
      prod: {
        tier: 'prod',
        requireCodeApproval: true,
        requireDeployApproval: true,
      },
      local: {
        tier: 'local',
        requireCodeApproval: false,
        requireDeployApproval: false,
      },
    }),
  },
}));

vi.mock('./blast-radius-store', () => ({
  BlastRadiusStore: {
    getBlastRadius: vi.fn().mockResolvedValue({ count: 0, resourceCount: 0 }),
    recordAction: vi.fn().mockResolvedValue(undefined),
    canExecute: vi.fn().mockResolvedValue({ allowed: true }),
    incrementBlastRadius: vi.fn().mockResolvedValue({ count: 1 }),
  },
  getBlastRadiusStore: vi.fn(() => ({
    getBlastRadius: vi.fn().mockResolvedValue({ count: 0, resourceCount: 0 }),
    recordAction: vi.fn().mockResolvedValue(undefined),
    canExecute: vi.fn().mockResolvedValue({ allowed: true }),
    incrementBlastRadius: vi.fn().mockResolvedValue({ count: 1 }),
  })),
}));

describe('SafetyEngine RBAC [Phase 15]', () => {
  let engine: any;
  const config = {
    id: 'test-agent',
    safetyTier: SafetyTier.LOCAL,
    trustScore: 90,
    evolutionMode: EvolutionMode.HITL,
  } as IAgentConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = resetSafetyEngine();
  });

  it('allows Class C actions for OWNER role', async () => {
    const result = await engine.evaluateAction(config, 'deployment', {
      userRole: UserRole.OWNER,
    });
    expect(result.allowed).toBe(true);
  });

  it('allows Class C actions for ADMIN role', async () => {
    const result = await engine.evaluateAction(config, 'iam_change', {
      userRole: UserRole.ADMIN,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks Class C actions for MEMBER role', async () => {
    const result = await engine.evaluateAction(config, 'infra_topology', {
      userRole: UserRole.MEMBER,
    });
    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('rbac_class_c_denied');
  });

  it('blocks Class B actions for VIEWER role', async () => {
    const result = await engine.evaluateAction(config, 'any_action', {
      userRole: UserRole.VIEWER,
    });
    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('rbac_viewer_denied');
  });

  it('blocks Class D actions for all roles including OWNER', async () => {
    const result = await engine.evaluateAction(config, 'trust_manipulation', {
      userRole: UserRole.OWNER,
    });
    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('class_d_blocked');
  });

  it('allows background SYSTEM tasks to skip RBAC when scoped to workspace', async () => {
    const result = await engine.evaluateAction(config, 'deployment', {
      userId: 'SYSTEM',
      workspaceId: 'ws1',
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects background SYSTEM tasks when missing workspaceId', async () => {
    const result = await engine.evaluateAction(config, 'deployment', {
      userId: 'SYSTEM',
    });
    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('system_rbac_unscoped');
  });

  it('requires RBAC even if agent has high trust (Non-Bypassable)', async () => {
    const trustedConfig = {
      ...config,
      trustScore: 98,
      evolutionMode: EvolutionMode.AUTO,
    };

    // Proactive task by a Member trying to do Class C
    const result = await engine.evaluateAction(trustedConfig, 'deployment', {
      userRole: UserRole.MEMBER,
      isProactive: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.appliedPolicy).toBe('rbac_class_c_denied');
  });
});
