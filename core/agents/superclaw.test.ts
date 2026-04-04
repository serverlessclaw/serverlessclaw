import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuperClaw } from './superclaw';
import { SafetyTier, ReasoningProfile } from '../lib/types/index';

// Mock the prompts to return actual strings instead of paths
vi.mock('./prompts/index', () => ({
  SUPERCLAW_SYSTEM_PROMPT: 'SUPERCLAW System Prompt Content',
  CODER_SYSTEM_PROMPT: 'CODER System Prompt Content',
  PLANNER_SYSTEM_PROMPT: 'PLANNER System Prompt Content',
  REFLECTOR_SYSTEM_PROMPT: 'REFLECTOR System Prompt Content',
  QA_SYSTEM_PROMPT: 'QA System Prompt Content',
  CRITIC_SYSTEM_PROMPT: 'CRITIC System Prompt Content',
  FACILITATOR_SYSTEM_PROMPT: 'FACILITATOR System Prompt Content',
  MERGER_SYSTEM_PROMPT: 'MERGER System Prompt Content',
  RESEARCHER_SYSTEM_PROMPT: 'RESEARCHER System Prompt Content',
}));

// Mock SafetyConfigManager as it's used in evaluateAction
vi.mock('../lib/safety/safety-config-manager', () => ({
  SafetyConfigManager: {
    getPolicies: vi.fn(async () => ({
      [SafetyTier.SANDBOX]: {
        requireCodeApproval: true,
        requireDeployApproval: true,
        requireFileApproval: true,
        requireShellApproval: true,
        requireMcpApproval: true,
      },
      [SafetyTier.AUTONOMOUS]: {
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
  describe('constructor', () => {
    it('initializes with custom system prompt if provided', () => {
      const memory = {} as any;
      const provider = {} as any;
      const tools = [] as any;
      const config = { id: 'test', name: 'Test', systemPrompt: 'Custom Prompt', enabled: true };
      const agent = new SuperClaw(memory, provider, tools, config);
      expect(agent.systemPrompt).toBe('Custom Prompt');
    });

    it('initializes with default system prompt if not provided', () => {
      const memory = {} as any;
      const provider = {} as any;
      const tools = [] as any;
      const agent = new SuperClaw(memory, provider, tools);
      expect(agent.systemPrompt).toContain('SUPERCLAW');
    });
  });

  describe('parseCommand', () => {
    it('parses /deep command', () => {
      const result = SuperClaw.parseCommand('/deep Hello world');
      expect(result.profile).toBe(ReasoningProfile.DEEP);
      expect(result.cleanText).toBe('Hello world');
    });

    it('parses /thinking command', () => {
      const result = SuperClaw.parseCommand('/thinking Hello world');
      expect(result.profile).toBe(ReasoningProfile.THINKING);
      expect(result.cleanText).toBe('Hello world');
    });

    it('parses /fast command', () => {
      const result = SuperClaw.parseCommand('/fast Hello world');
      expect(result.profile).toBe(ReasoningProfile.FAST);
      expect(result.cleanText).toBe('Hello world');
    });

    it('handles text without commands', () => {
      const result = SuperClaw.parseCommand('Hello world');
      expect(result.profile).toBeUndefined();
      expect(result.cleanText).toBe('Hello world');
    });
  });

  describe('Safety Tiers and Engine', () => {
    beforeEach(() => {
      // Clear violations for each test
      SuperClaw.getSafetyEngine().clearViolations();
    });

    describe('requiresApproval', () => {
      it('sandbox requires approval for code changes', async () => {
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.SANDBOX,
        };
        expect(await SuperClaw.requiresApproval(config, 'code_change')).toBe(true);
      });

      it('autonomous does NOT require approval for code changes', async () => {
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.AUTONOMOUS,
        };
        expect(await SuperClaw.requiresApproval(config, 'code_change')).toBe(false);
      });
    });

    describe('evaluateAction', () => {
      it('returns detailed safety evaluation result', async () => {
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.SANDBOX,
        };
        const result = await SuperClaw.evaluateAction(config, 'code_change');
        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.appliedPolicy).toBe('sandbox_code_change_approval');
      });
    });

    describe('Safety Configuration', () => {
      it('configures safety policy', async () => {
        SuperClaw.configureSafetyPolicy(SafetyTier.SANDBOX, { requireCodeApproval: false });
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.SANDBOX,
        };
        // We need to wait for the engine to pick up the updated policy
        // Since it's a static engine, this might affect other tests
        expect(await SuperClaw.requiresApproval(config, 'code_change')).toBe(false);

        // Reset policy
        SuperClaw.configureSafetyPolicy(SafetyTier.SANDBOX, { requireCodeApproval: true });
      });

      it('sets tool safety override', async () => {
        SuperClaw.setToolSafetyOverride({
          toolName: 'sensitive_tool',
          requireApproval: true,
        });

        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.AUTONOMOUS,
        };

        const result = await SuperClaw.evaluateAction(config, 'mcp_tool', {
          toolName: 'sensitive_tool',
        });
        expect(result.requiresApproval).toBe(true);
        expect(result.appliedPolicy).toBe('tool_override');
      });
    });

    describe('Safety Stats and Violations', () => {
      it('tracks violations and returns stats', async () => {
        const config = {
          id: 'test',
          name: 'Test',
          systemPrompt: '',
          enabled: true,
          safetyTier: SafetyTier.SANDBOX,
        };

        await SuperClaw.evaluateAction(config, 'unknown_action');

        const violations = SuperClaw.getSafetyViolations();
        expect(violations.length).toBeGreaterThan(0);
        expect(violations[0].action).toBe('unknown_action');

        const stats = SuperClaw.getSafetyStats();
        expect(stats.totalViolations).toBeGreaterThan(0);
        expect(stats.approvalRequired).toBeGreaterThan(0);
      });
    });
  });
});
