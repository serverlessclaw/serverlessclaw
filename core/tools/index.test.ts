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

describe('tools registration logic', () => {
  it('should map UPPER_SNAKE_CASE to camelCase correctly', () => {
    // Example: DISPATCH_TASK -> dispatchTask
    expect(TOOLS.dispatchTask).toBeDefined();
    expect(TOOLS.triggerDeployment).toBeDefined();
  });

  it('should preserve existing camelCase exports', () => {
    // Example: stageChanges -> stageChanges
    expect(TOOLS.stageChanges).toBeDefined();
    expect(TOOLS.runTests).toBeDefined();
    expect(TOOLS.validateCode).toBeDefined();
  });

  it('should not lowercase existing camelCase keys', () => {
    expect(TOOLS.stagechanges).toBeUndefined();
    expect(TOOLS.runtests).toBeUndefined();
  });

  it('should handle tools with multiple underscores', () => {
    // If any exist, e.g. AWS_S3_READ_FILE -> awsS3ReadFile
    const s3Tool = Object.keys(TOOLS).find((k) => k.toLowerCase() === 'awss3readfile');
    if (s3Tool) {
      expect(s3Tool).toBe('awsS3ReadFile');
    }
  });
});

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
