import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from './plugin-manager';
import { EvolutionMode } from './types';

describe('PluginManager', () => {
  it('should register a plugin and aggregate agents', async () => {
    const plugin = {
      id: 'test-plugin',
      agents: {
        'test-agent': {
          id: 'test-agent',
          name: 'Test Agent',
          systemPrompt: 'Test',
          tools: [],
          evolutionMode: EvolutionMode.HITL,
          enabled: true,
        },
      },
    };

    await PluginManager.register(plugin);
    const agents = PluginManager.getRegisteredAgents();

    expect(agents['test-agent']).toBeDefined();
    expect(agents['test-agent'].name).toBe('Test Agent');
  });

  it('should aggregate tools from multiple plugins', async () => {
    const plugin1 = {
      id: 'p1',
      tools: {
        tool1: {
          name: 'tool1',
          description: 'd1',
          type: 'function' as any,
          parameters: {},
          requiresApproval: false,
          connectionProfile: [],
          requiredPermissions: [],
          execute: async () => 'r1',
        },
      },
    };
    const plugin2 = {
      id: 'p2',
      tools: {
        tool2: {
          name: 'tool2',
          description: 'd2',
          type: 'function' as any,
          parameters: {},
          requiresApproval: false,
          connectionProfile: [],
          requiredPermissions: [],
          execute: async () => 'r2',
        },
      },
    };

    await PluginManager.register(plugin1);
    await PluginManager.register(plugin2);

    const tools = PluginManager.getRegisteredTools();
    expect(tools['tool1']).toBeDefined();
    expect(tools['tool2']).toBeDefined();
  });

  it('should call onInit when registering', async () => {
    const onInit = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      id: 'init-plugin',
      onInit,
    };

    await PluginManager.register(plugin);
    expect(onInit).toHaveBeenCalled();
  });
});
