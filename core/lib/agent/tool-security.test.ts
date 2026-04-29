import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolSecurityValidator } from './tool-security';
import { SafetyTier, EvolutionMode } from '../types/agent';

// Mock SafetyEngine
const mockEvaluateAction = vi.fn().mockResolvedValue({ allowed: true, reason: 'Allowed' });

const { MockSafetyEngine } = vi.hoisted(() => {
  return {
    MockSafetyEngine: class {
      evaluateAction = mockEvaluateAction;
    },
  };
});

vi.mock('../safety', () => ({
  SafetyEngine: MockSafetyEngine,
  getSafetyEngine: () => new MockSafetyEngine(),
  getCircuitBreaker: () => ({
    canProceed: vi.fn().mockResolvedValue({ allowed: true }),
  }),
}));

// Mock IdentityManager
const mockHasPermission = vi.fn().mockResolvedValue(true);
vi.mock('../session/identity', () => ({
  IdentityManager: class {
    hasPermission = mockHasPermission;
  },
}));

vi.mock('../memory/base', () => ({
  BaseMemoryProvider: class {},
}));

describe('ToolSecurityValidator', () => {
  const mockTool = {
    name: 'test_tool',
    description: 'test',
    requiredPermissions: [],
  } as any;

  const mockToolCall = {
    id: 'call-1',
    function: { name: 'test_tool', arguments: '{}' },
  } as any;

  const mockExecContext = {
    agentId: 'agent-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    traceId: 'trace-1',
    agentConfig: { safetyTier: SafetyTier.PROD, evolutionMode: EvolutionMode.HITL },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows safe actions in HITL mode', async () => {
    const result = await ToolSecurityValidator.validate(
      mockTool,
      mockToolCall,
      {},
      mockExecContext
    );
    expect(result.allowed).toBe(true);
  });

  it('blocks unsafe actions in HITL mode', async () => {
    mockEvaluateAction.mockResolvedValueOnce({ allowed: false, reason: 'Unsafe' });
    const result = await ToolSecurityValidator.validate(
      mockTool,
      mockToolCall,
      {},
      mockExecContext
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('PERMISSION_DENIED');
  });

  it('requires approval when safety engine flags it', async () => {
    mockEvaluateAction.mockResolvedValueOnce({
      allowed: true,
      requiresApproval: true,
      reason: 'Sensitive',
    });
    const result = await ToolSecurityValidator.validate(
      mockTool,
      mockToolCall,
      {},
      mockExecContext
    );
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('allows sensitive actions in AUTO mode IF safety engine promotes them', async () => {
    const autoContext = {
      ...mockExecContext,
      agentConfig: { ...mockExecContext.agentConfig, evolutionMode: EvolutionMode.AUTO },
    };
    // If SafetyEngine cleared requiresApproval (Principle 9 promotion), it should be allowed
    mockEvaluateAction.mockResolvedValueOnce({ allowed: true, requiresApproval: false });

    const result = await ToolSecurityValidator.validate(mockTool, mockToolCall, {}, autoContext);
    expect(result.allowed).toBe(true);
    expect(result.modifiedArgs?.manuallyApproved).toBe(true);
  });

  it('still requires approval in AUTO mode if safety engine explicitly mandates it', async () => {
    const autoContext = {
      ...mockExecContext,
      agentConfig: { ...mockExecContext.agentConfig, evolutionMode: EvolutionMode.AUTO },
    };
    // If SafetyEngine STAYS requiresApproval: true, we must respect it even in AUTO mode
    mockEvaluateAction.mockResolvedValueOnce({ allowed: true, requiresApproval: true });

    const result = await ToolSecurityValidator.validate(mockTool, mockToolCall, {}, autoContext);
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('enforces RBAC permissions', async () => {
    const permTool = { ...mockTool, requiredPermissions: ['admin'] };
    mockHasPermission.mockResolvedValueOnce(false);

    const result = await ToolSecurityValidator.validate(
      permTool,
      mockToolCall,
      {},
      mockExecContext
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unauthorized');
  });
});
