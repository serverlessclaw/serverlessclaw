import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAgentConfig } from './config-resolver';
import { SYSTEM, CONFIG_KEYS } from '../constants';
import { ConfigManager } from '../registry/config';
import { ReasoningProfile } from '../types/index';

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

// Mock AgentRouter as it's dynamically imported
vi.mock('../agent-router', () => ({
  AgentRouter: {
    selectModel: vi.fn().mockImplementation((config, _options) => {
      return {
        provider: config?.provider ?? 'routed-provider',
        model: config?.model ?? 'routed-model',
      };
    }),
  },
}));

describe('resolveAgentConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses default values when no agent config and no global config', async () => {
    (ConfigManager.getRawConfig as any).mockResolvedValue(undefined);

    const result = await resolveAgentConfig(undefined);

    expect(result).toEqual({
      activeModel: SYSTEM.DEFAULT_MODEL,
      activeProvider: SYSTEM.DEFAULT_PROVIDER,
      activeProfile: ReasoningProfile.STANDARD,
    });
  });

  it('uses agent config values when provided', async () => {
    (ConfigManager.getRawConfig as any).mockResolvedValue(undefined);

    const agentConfig = {
      id: 'test-agent',
      name: 'Test Agent',
      model: 'agent-model',
      provider: 'agent-provider',
      reasoningProfile: ReasoningProfile.DEEP,
    } as any;

    const result = await resolveAgentConfig(agentConfig);

    expect(result).toEqual({
      activeModel: 'agent-model',
      activeProvider: 'agent-provider',
      activeProfile: ReasoningProfile.DEEP,
    });
  });

  it('overrides with global config when available', async () => {
    (ConfigManager.getRawConfig as any).mockImplementation((key: string) => {
      if (key === CONFIG_KEYS.ACTIVE_PROVIDER) return Promise.resolve('global-provider');
      if (key === CONFIG_KEYS.ACTIVE_MODEL) return Promise.resolve('global-model');
      return Promise.resolve(undefined);
    });

    const agentConfig = {
      model: 'agent-model',
      provider: 'agent-provider',
    } as any;

    const result = await resolveAgentConfig(agentConfig);

    expect(result).toEqual({
      activeModel: 'global-model',
      activeProvider: 'global-provider',
      activeProfile: ReasoningProfile.STANDARD,
    });
  });

  it('uses requested profile when provided', async () => {
    (ConfigManager.getRawConfig as any).mockResolvedValue(undefined);

    const result = await resolveAgentConfig(undefined, ReasoningProfile.FAST);

    expect(result).toEqual({
      activeModel: SYSTEM.DEFAULT_MODEL,
      activeProvider: SYSTEM.DEFAULT_PROVIDER,
      activeProfile: ReasoningProfile.FAST,
    });
  });

  it('uses AgentRouter when no global config but agent config is provided', async () => {
    (ConfigManager.getRawConfig as any).mockResolvedValue(undefined);
    const { AgentRouter } = await import('../agent-router');

    const agentConfig = { id: 'test' } as any;
    const result = await resolveAgentConfig(agentConfig);

    expect(AgentRouter.selectModel).toHaveBeenCalled();
    expect(result.activeProvider).toBe('routed-provider');
    expect(result.activeModel).toBe('routed-model');
  });

  it('handles errors gracefully by using defaults', async () => {
    (ConfigManager.getRawConfig as any).mockRejectedValue(new Error('DDB Error'));

    const result = await resolveAgentConfig(undefined);

    expect(result).toEqual({
      activeModel: SYSTEM.DEFAULT_MODEL,
      activeProvider: SYSTEM.DEFAULT_PROVIDER,
      activeProfile: ReasoningProfile.STANDARD,
    });
  });
});
