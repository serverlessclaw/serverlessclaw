import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from './registry';
import { AgentType } from './types/agent';

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-table' },
  },
}));

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: mockSend,
    }),
  },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
  PutCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
}));

describe('AgentRegistry Tool Overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should include backbone tools by default', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // No overrides
    mockSend.mockResolvedValueOnce({ Item: undefined }); // No selective mode
    mockSend.mockResolvedValueOnce({ Item: undefined }); // No tools override

    const config = await AgentRegistry.getAgentConfig(AgentType.MAIN);
    expect(config?.tools).toContain('dispatchTask');
    expect(config?.tools).toContain('discoverSkills');
  });

  it('should apply dynamic tool overrides for backbone agents', async () => {
    // 1. Mock getRawConfig(AGENTS_CONFIG)
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // 2. Mock getRawConfig(selective_discovery_mode)
    mockSend.mockResolvedValueOnce({ Item: { value: false } });
    // 3. Mock getRawConfig(main_tools)
    mockSend.mockResolvedValueOnce({ Item: { value: ['myCustomTool'] } });

    const config = await AgentRegistry.getAgentConfig(AgentType.MAIN);

    expect(config?.tools).toContain('myCustomTool');
    expect(config?.tools).toContain('discoverSkills'); // Universal
    expect(config?.tools).toContain('installSkill'); // Universal
    // Smart Default: Backbone tools are now MERGED with overrides
    expect(config?.tools).toContain('dispatchTask');
    expect(config?.tools).toContain('registerMCPServer');
  });

  it('should ensure universal tools are always present', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({ Item: { value: false } });
    mockSend.mockResolvedValueOnce({ Item: { value: [] } }); // Empty override

    const config = await AgentRegistry.getAgentConfig(AgentType.MAIN);
    expect(config?.tools).toContain('discoverSkills');
    expect(config?.tools).toContain('installSkill');
  });
});
