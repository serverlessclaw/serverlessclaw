import { describe, it, expect } from 'vitest';
import { BACKBONE_REGISTRY } from './backbone';
import { AgentType, AgentCategory } from './types/agent';

describe('Backbone Registry', () => {
  it('should have all backbone agents defined', () => {
    const expectedAgents = [
      AgentType.SUPERCLAW,
      AgentType.CODER,
      AgentType.STRATEGIC_PLANNER,
      AgentType.COGNITION_REFLECTOR,
      AgentType.QA,
      AgentType.BUILD_MONITOR,
      AgentType.RECOVERY,
    ];

    for (const agentId of expectedAgents) {
      expect(BACKBONE_REGISTRY[agentId]).toBeDefined();
    }
  });

  it('should have correct agent structure', () => {
    const mainAgent = BACKBONE_REGISTRY[AgentType.SUPERCLAW];
    expect(mainAgent.id).toBe(AgentType.SUPERCLAW);
    expect(mainAgent.name).toBe('SuperClaw');
    expect(mainAgent.category).toBe(AgentCategory.SYSTEM);
    expect(mainAgent.isBackbone).toBe(true);
    expect(mainAgent.enabled).toBe(true);
    expect(mainAgent.tools).toBeDefined();
    expect(Array.isArray(mainAgent.tools)).toBe(true);
  });

  it('should have all system agents enabled', () => {
    const systemAgents = [
      AgentType.SUPERCLAW,
      AgentType.CODER,
      AgentType.STRATEGIC_PLANNER,
      AgentType.COGNITION_REFLECTOR,
      AgentType.QA,
    ];

    for (const agentId of systemAgents) {
      expect(BACKBONE_REGISTRY[agentId].enabled).toBe(true);
    }
  });

  it('should have valid connection profiles', () => {
    const mainAgent = BACKBONE_REGISTRY[AgentType.SUPERCLAW];
    expect(mainAgent.connectionProfile).toBeDefined();
    expect(Array.isArray(mainAgent.connectionProfile)).toBe(true);
    expect(mainAgent.connectionProfile!.length).toBeGreaterThan(0);
  });

  it('should include essential tools in SuperClaw', () => {
    const mainAgent = BACKBONE_REGISTRY[AgentType.SUPERCLAW];
    expect(mainAgent.tools).toContain('dispatchTask');
    expect(mainAgent.tools).toContain('recallKnowledge');
    expect(mainAgent.tools).toContain('saveMemory');
  });

  it('should include code tools in Coder agent', () => {
    const coderAgent = BACKBONE_REGISTRY[AgentType.CODER];
    expect(coderAgent.tools).toContain('runShellCommand');
    expect(coderAgent.tools).toContain('stageChanges');
    expect(coderAgent.tools).toContain('triggerDeployment');
    expect(coderAgent.tools).toContain('validateCode');
  });
});
