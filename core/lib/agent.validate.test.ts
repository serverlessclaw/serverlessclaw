import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from './agent';

describe('validateAgentConfig', () => {
  it('throws when config is undefined', () => {
    expect(() => validateAgentConfig(undefined, 'test-agent')).toThrow(/Agent config is required/i);
  });

  it('throws when required fields are missing', () => {
    const partial: any = { id: 'agent-1' };
    expect(() => validateAgentConfig(partial, 'agent-1')).toThrow(/missing required fields/i);
  });

  it('does not throw for a valid config', () => {
    const valid: any = {
      id: 'agent-1',
      name: 'Agent One',
      systemPrompt: 'Be helpful',
      enabled: true,
    };
    expect(() => validateAgentConfig(valid, 'agent-1')).not.toThrow();
  });
});
