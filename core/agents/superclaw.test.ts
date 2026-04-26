import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuperClaw } from './superclaw';
import { SafetyTier, ReasoningProfile, AgentCategory } from '../lib/types/index';

// Mock the prompts to return actual strings
vi.mock('../lib/prompts/loader', () => ({
  loadPrompts: vi.fn(async () => ({
    en: 'You are SuperClaw.',
    cn: '你是 SuperClaw。',
  })),
}));

// Mock AgentRegistry
vi.mock('../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    atomicAddAgentField: vi.fn(),
  },
}));

// Mock BlastRadiusStore
vi.mock('../lib/safety/blast-radius-store', () => {
  const mockStore = {
    canExecute: vi.fn().mockResolvedValue({ allowed: true }),
    incrementBlastRadius: vi.fn().mockResolvedValue({ count: 1 }),
  };
  return {
    BlastRadiusStore: vi.fn(() => mockStore),
    getBlastRadiusStore: vi.fn(() => mockStore),
  };
});

// Mock SafetyConfigManager
vi.mock('../lib/safety/safety-config-manager', () => ({
  SafetyConfigManager: {
    getPolicies: vi.fn(async () => ({
      [SafetyTier.PROD]: {
        requireCodeApproval: false,
        requireDeployApproval: true,
        requireFileApproval: false,
        requireShellApproval: false,
        requireMcpApproval: false,
      },
      [SafetyTier.LOCAL]: {
        requireCodeApproval: false,
        requireDeployApproval: false,
        requireFileApproval: false,
        requireShellApproval: false,
        requireMcpApproval: false,
      },
    })),
  },
}));

describe('SuperClaw', () => {
  let superclaw: SuperClaw;
  let mockMemory: any;
  let mockProvider: any;
  let mockTools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getScopedUserId: vi.fn((uid) => uid),
      addMessage: vi.fn(),
      getHistory: vi.fn().mockResolvedValue([]),
    } as any;
    mockProvider = {
      getCapabilities: vi.fn().mockResolvedValue({}),
    } as any;
    mockTools = [];
    superclaw = new SuperClaw(mockMemory, mockProvider, mockTools, {
      id: 'superclaw',
      name: 'SuperClaw',
      systemPrompt: 'You are SuperClaw.',
      enabled: true,
      category: AgentCategory.SYSTEM,
      reasoningProfile: ReasoningProfile.STANDARD,
    });
  });

  describe('Core Identity', () => {
    it('should have correct type and category', () => {
      expect(superclaw.getConfig()?.id).toBe('superclaw');
      expect(superclaw.getConfig()?.category).toBe(AgentCategory.SYSTEM);
    });

    it('should use standard reasoning by default', () => {
      expect(superclaw.getConfig()?.reasoningProfile).toBe(ReasoningProfile.STANDARD);
    });
  });

  describe('Safety Tiers and Engine', () => {
    describe('requiresApproval', () => {
      it('prod requires approval for deployments', async () => {
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.PROD,
        } as any;
        expect(await superclaw.requiresApproval(config, 'deployment', { userId: 'SYSTEM' })).toBe(
          true
        );
      });

      it('local does NOT require approval for deployments', async () => {
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.LOCAL,
        } as any;
        expect(await superclaw.requiresApproval(config, 'deployment', { userId: 'SYSTEM' })).toBe(
          false
        );
      });
    });

    describe('evaluateAction', () => {
      it('returns detailed safety evaluation result', async () => {
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.PROD,
        } as any;
        const result = await superclaw.evaluateAction(config, 'deployment', { userId: 'SYSTEM' });
        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.appliedPolicy).toBe('class_c_approval_required');
      });
    });

    describe('Safety Configuration', () => {
      it('configures safety policy', async () => {
        superclaw.configureSafetyPolicy(SafetyTier.PROD, { requireDeployApproval: false });
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.PROD,
        } as any;
        expect(await superclaw.requiresApproval(config, 'deployment', { userId: 'SYSTEM' })).toBe(
          false
        );
      });

      it('sets tool safety override', async () => {
        superclaw.setToolSafetyOverride({
          toolName: 'sensitive_tool',
          requireApproval: true,
        });
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.LOCAL,
        } as any;
        const result = await superclaw.evaluateAction(config, 'mcp_tool', {
          toolName: 'sensitive_tool',
        });
        expect(result.requiresApproval).toBe(true);
        expect(result.appliedPolicy).toBe('tool_override');
      });
    });
  });
});
