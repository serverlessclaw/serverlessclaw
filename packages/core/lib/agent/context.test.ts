import { describe, it, expect } from 'vitest';
import { AgentContext } from './context';
import { ReasoningProfile } from '../types/index';

describe('AgentContext', () => {
  describe('getIdentityBlock', () => {
    it('should generate identity block with provided config', () => {
      const config = {
        id: 'test-agent',
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        enabled: true,
        description: 'test-agent',
        category: ReasoningProfile.STANDARD as any,
        icon: 'test',
        tools: [],
      };
      const result = AgentContext.getIdentityBlock(
        config,
        'gpt-4',
        'openai',
        ReasoningProfile.STANDARD,
        1
      );

      expect(result).toContain('AGENT_NAME: Test Agent');
      expect(result).toContain('AGENT_ID: test-agent');
      expect(result).toContain('ACTIVE_PROVIDER: openai');
      expect(result).toContain('ACTIVE_MODEL: gpt-4');
      expect(result).toContain('REASONING_PROFILE: standard');
      expect(result).toContain('RECURSION_DEPTH: 1');
    });

    it('should use defaults when config is undefined', () => {
      const result = AgentContext.getIdentityBlock(
        undefined,
        'default-model',
        'default-provider',
        ReasoningProfile.FAST,
        0
      );

      expect(result).toContain('AGENT_NAME: SuperClaw');
      expect(result).toContain('AGENT_ID: superclaw');
    });

    it('should use system defaults when model or provider is empty', () => {
      const result = AgentContext.getIdentityBlock(undefined, '', '', ReasoningProfile.DEEP, 5);

      expect(result).toContain('ACTIVE_PROVIDER:');
      expect(result).toContain('ACTIVE_MODEL:');
      expect(result).toContain('RECURSION_DEPTH: 5');
    });

    it('should include communication style guidelines', () => {
      const result = AgentContext.getIdentityBlock(
        undefined,
        'model',
        'provider',
        ReasoningProfile.STANDARD,
        0
      );

      expect(result).toContain('[COMMUNICATION_STYLE]');
      expect(result).toContain('respond directly and personably');
      expect(result).toContain('Avoid internal monologue');
    });
  });

  describe('getMemoryIndexBlock', () => {
    it('should show available facts when distilled is provided', () => {
      const result = AgentContext.getMemoryIndexBlock('Some facts', 5);

      expect(result).toContain('DISTILLED FACTS: Available');
      expect(result).toContain('TACTICAL LESSONS: 5 recent available');
    });

    it('should show no facts when distilled is empty and no preferences', () => {
      const result = AgentContext.getMemoryIndexBlock('', 0, 0);

      expect(result).toContain('DISTILLED FACTS: None');
      expect(result).toContain('TACTICAL LESSONS: 0 recent available');
    });

    it('should show available facts when preferences exist', () => {
      const result = AgentContext.getMemoryIndexBlock('', 3, 2);

      expect(result).toContain('DISTILLED FACTS: Available');
    });

    it('should include recallKnowledge instruction', () => {
      const result = AgentContext.getMemoryIndexBlock('facts', 1);

      expect(result).toContain("USE 'recallKnowledge'");
    });
  });
});
