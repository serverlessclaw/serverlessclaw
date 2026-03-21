import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOOLS, getToolDefinitions, getAgentTools } from './index';
import { IAgentConfig } from '../lib/types/agent';

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(),
  },
}));

vi.mock('../lib/mcp', () => ({
  MCPBridge: {
    getExternalTools: vi.fn().mockResolvedValue([]),
  },
}));

describe('tools', () => {
  it('should have switchModel tool defined', () => {
    expect(TOOLS.switchModel).toBeDefined();
    expect(TOOLS.switchModel.name).toBe('switchModel');
    expect(TOOLS.switchModel.description).toBeDefined();
    expect(TOOLS.switchModel.execute).toBeDefined();
  });
});

describe('getToolDefinitions', () => {
  it('should return an array of tool definitions', () => {
    const definitions = getToolDefinitions(TOOLS);
    expect(Array.isArray(definitions)).toBe(true);
    expect(definitions.length).toBeGreaterThan(0);
  });

  it('should include switchModel in definitions', () => {
    const definitions = getToolDefinitions(TOOLS);
    const switchModelDef = definitions.find((d) => d.function?.name === 'switchModel');
    expect(switchModelDef).toBeDefined();
    expect(switchModelDef!.function?.description).toBeDefined();
  });

  it('should have proper type and function structure', () => {
    const definitions = getToolDefinitions(TOOLS);
    definitions.forEach((def) => {
      expect(def.type).toBe('function');
      expect(def.function).toBeDefined();
    });
  });
});

describe('getAgentTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no config', async () => {
    const { AgentRegistry } = await import('../lib/registry');
    vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue(undefined);

    const result = await getAgentTools('test-agent');
    expect(result).toEqual([]);
  });

  it('should return empty array when no tools configured', async () => {
    const { AgentRegistry } = await import('../lib/registry');
    vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue({
      name: 'test',
    } as IAgentConfig);

    const result = await getAgentTools('test-agent');
    expect(result).toEqual([]);
  });
});
