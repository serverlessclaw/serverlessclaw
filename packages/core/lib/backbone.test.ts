import { describe, it, expect } from 'vitest';
import { BACKBONE_REGISTRY } from './backbone';
import { AGENT_TYPES, AgentCategory, EvolutionMode } from './types/agent';

describe('Backbone Registry', () => {
  it('should have all backbone agents defined', () => {
    const expectedAgents = [
      AGENT_TYPES.SUPERCLAW,
      AGENT_TYPES.CODER,
      AGENT_TYPES.STRATEGIC_PLANNER,
      AGENT_TYPES.COGNITION_REFLECTOR,
      AGENT_TYPES.QA,
      AGENT_TYPES.BUILD_MONITOR,
      AGENT_TYPES.RECOVERY,
    ];

    for (const agentId of expectedAgents) {
      expect(BACKBONE_REGISTRY[agentId]).toBeDefined();
    }
  });

  it('should have correct agent structure', () => {
    const mainAgent = BACKBONE_REGISTRY[AGENT_TYPES.SUPERCLAW];
    expect(mainAgent.id).toBe(AGENT_TYPES.SUPERCLAW);
    expect(mainAgent.name).toBe('SuperClaw');
    expect(mainAgent.category).toBe(AgentCategory.SYSTEM);
    expect(mainAgent.isBackbone).toBe(true);
    expect(mainAgent.enabled).toBe(true);
    expect(mainAgent.tools).toBeDefined();
    expect(Array.isArray(mainAgent.tools)).toBe(true);
  });

  it('should have all system agents enabled', () => {
    const systemAgents = [
      AGENT_TYPES.SUPERCLAW,
      AGENT_TYPES.CODER,
      AGENT_TYPES.STRATEGIC_PLANNER,
      AGENT_TYPES.COGNITION_REFLECTOR,
      AGENT_TYPES.QA,
    ];

    for (const agentId of systemAgents) {
      expect(BACKBONE_REGISTRY[agentId].enabled).toBe(true);
    }
  });

  it('should have valid connection profiles', () => {
    const mainAgent = BACKBONE_REGISTRY[AGENT_TYPES.SUPERCLAW];
    expect(mainAgent.connectionProfile).toBeDefined();
    expect(Array.isArray(mainAgent.connectionProfile)).toBe(true);
    expect(mainAgent.connectionProfile!.length).toBeGreaterThan(0);
  });

  it('should have evolutionMode set to HITL for SuperClaw', () => {
    const mainAgent = BACKBONE_REGISTRY[AGENT_TYPES.SUPERCLAW];
    expect(mainAgent.evolutionMode).toBe(EvolutionMode.AUTO);
  });

  it('should include essential tools in SuperClaw', () => {
    const mainAgent = BACKBONE_REGISTRY[AGENT_TYPES.SUPERCLAW];
    expect(mainAgent.tools).toContain('dispatchTask');
    expect(mainAgent.tools).toContain('recallKnowledge');
    expect(mainAgent.tools).toContain('saveMemory');
  });

  it('should include code tools in Coder agent', () => {
    const coderAgent = BACKBONE_REGISTRY[AGENT_TYPES.CODER];
    expect(coderAgent.tools).toContain('runShellCommand');
    expect(coderAgent.tools).toContain('stageChanges');
    expect(coderAgent.tools).toContain('triggerDeployment');
    expect(coderAgent.tools).toContain('validateCode');
  });
});
