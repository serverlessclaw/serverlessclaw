import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from './agent';
import { IAgentConfig } from './types/index';

describe('Agent Hardening (Selection Integrity)', () => {
  it('should throw an error if the agent is disabled', () => {
    const disabledConfig: IAgentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: false,
      systemPrompt: 'You are a test agent',
    };

    expect(() => validateAgentConfig(disabledConfig, 'test-agent')).toThrow(/DISABLED/);
    expect(() => validateAgentConfig(disabledConfig, 'test-agent')).toThrow(/Principle 14/);
  });

  it('should pass if the agent is enabled', () => {
    const enabledConfig: IAgentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test agent',
    };

    expect(() => validateAgentConfig(enabledConfig, 'test-agent')).not.toThrow();
  });
});
