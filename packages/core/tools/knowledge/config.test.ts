import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
    StagingBucket: { name: 'test-bucket' },
  },
}));

vi.mock('../../lib/types/system', () => ({
  SSTResource: {},
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/types/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/types/index')>()),
  EventType: { CONTINUATION_TASK: 'continuation_task' },
}));

vi.mock('../../lib/types/constants', () => ({
  TraceType: { COLLABORATION_STARTED: 'collaboration_started' },
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: vi.fn(),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn(),
}));

vi.mock('../../lib/types/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/types/llm')>()),
  MessageRole: { USER: 'user', ASSISTANT: 'assistant' },
  AttachmentType: {},
}));

vi.mock('../../lib/types/agent', () => ({
  AgentRole: { FACILITATOR: 'facilitator' },
  Attachment: {},
}));

vi.mock('../../lib/types/tool', () => ({
  ITool: {},
  ToolType: { FUNCTION: 'function' },
}));

const mockGetRawConfig = vi.fn();
const mockSaveRawConfig = vi.fn();
const mockSend = vi.fn();

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: (...args: unknown[]) => mockGetRawConfig(...args),
    saveRawConfig: (...args: unknown[]) => mockSaveRawConfig(...args),
  },
  defaultDocClient: {
    send: (...args: unknown[]) => mockSend(...args),
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class MockScanCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return { ScanCommand: MockScanCommand };
});

import { checkConfig, listSystemConfigs, setSystemConfig } from './config';

describe('checkConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(checkConfig.name).toBe('checkConfig');
    expect(checkConfig.description).toBeDefined();
    expect(checkConfig.parameters).toBeDefined();
  });

  it('returns config with injected values', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);

    const result = await checkConfig.execute({
      agentName: 'coder',
      initiatorId: 'user-1',
      traceId: 'trace-1',
      activeModel: 'gpt-5.4-mini',
      activeProvider: 'openai',
    });

    expect(result).toContain('AGENT_NAME: coder');
    expect(result).toContain('INITIATOR: user-1');
    expect(result).toContain('TRACE_ID: trace-1');
    expect(result).toContain('ACTIVE_PROVIDER: openai');
    expect(result).toContain('ACTIVE_MODEL: gpt-5.4-mini');
  });

  it('falls back to DDB values when injected values are not provided', async () => {
    mockGetRawConfig.mockImplementation((key: string) => {
      if (key === 'active_provider') return Promise.resolve('bedrock');
      if (key === 'active_model') return Promise.resolve('claude-4.6');
      return Promise.resolve(undefined);
    });

    const result = await checkConfig.execute({
      agentName: 'planner',
      initiatorId: 'user-1',
      traceId: 'trace-2',
    });

    expect(result).toContain('ACTIVE_PROVIDER: bedrock');
    expect(result).toContain('ACTIVE_MODEL: claude-4.6');
  });

  it('uses default values when neither injected nor DDB values exist', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);

    const result = await checkConfig.execute({
      agentName: 'qa',
      initiatorId: 'user-1',
      traceId: 'trace-3',
    });

    expect(result).toContain('ACTIVE_PROVIDER: minimax (default)');
    expect(result).toContain('ACTIVE_MODEL: MiniMax-M2.7 (default)');
  });

  it('includes staging bucket name', async () => {
    mockGetRawConfig.mockResolvedValue(undefined);

    const result = await checkConfig.execute({
      agentName: 'test',
      initiatorId: 'u1',
      traceId: 't1',
    });

    expect(result).toContain('STAGING_BUCKET: test-bucket');
  });

  it('prefers injected values over DDB values', async () => {
    mockGetRawConfig.mockImplementation((key: string) => {
      if (key === 'active_provider') return Promise.resolve('bedrock');
      if (key === 'active_model') return Promise.resolve('claude-4.6');
      return Promise.resolve(undefined);
    });

    const result = await checkConfig.execute({
      agentName: 'test',
      initiatorId: 'u1',
      traceId: 't1',
      activeModel: 'gpt-4o',
      activeProvider: 'openai',
    });

    expect(result).toContain('ACTIVE_PROVIDER: openai');
    expect(result).toContain('ACTIVE_MODEL: gpt-4o');
  });
});

describe('listSystemConfigs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(listSystemConfigs.name).toBe('listSystemConfigs');
    expect(listSystemConfigs.description).toBeDefined();
    expect(listSystemConfigs.parameters).toBeDefined();
  });

  it('lists all system configurations', async () => {
    mockSend.mockResolvedValue({
      Items: [
        { key: 'active_provider', value: 'openai' },
        { key: 'active_model', value: 'gpt-5.4-mini' },
      ],
    });

    const result = await listSystemConfigs.execute();

    expect(result).toContain('SYSTEM_CONFIGURATIONS');
    expect(result).toContain('active_provider');
    expect(result).toContain('active_model');
  });

  it('returns message when no configurations found', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const result = await listSystemConfigs.execute();

    expect(result).toContain('No system configurations found');
  });

  it('returns message when Items is null', async () => {
    mockSend.mockResolvedValue({ Items: null });

    const result = await listSystemConfigs.execute();

    expect(result).toContain('No system configurations found');
  });

  it('handles scan failure gracefully', async () => {
    mockSend.mockRejectedValue(new Error('DynamoDB scan failed'));

    const result = await listSystemConfigs.execute();

    expect(result).toContain('Failed to list configurations');
    expect(result).toContain('DynamoDB scan failed');
  });

  it('handles ConfigTable not being linked', async () => {
    const sst = await import('sst');
    const r = sst.Resource as unknown as Record<string, unknown>;
    const orig = r.ConfigTable;
    (r as any).ConfigTable = undefined;

    const result = await listSystemConfigs.execute();

    expect(result).toContain('ConfigTable not linked');

    (r as any).ConfigTable = orig;
  });
});

describe('setSystemConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(setSystemConfig.name).toBe('setSystemConfig');
    expect(setSystemConfig.description).toBeDefined();
    expect(setSystemConfig.parameters).toBeDefined();
  });

  it('sets a system config successfully', async () => {
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await setSystemConfig.execute({
      key: 'recursion_limit',
      value: '25',
    });

    expect(result).toContain('Successfully updated system configuration: recursion_limit');
    expect(mockSaveRawConfig).toHaveBeenCalledWith('recursion_limit', '25', expect.anything());
  });

  it('returns failure message when save fails', async () => {
    mockSaveRawConfig.mockRejectedValue(new Error('Permission denied'));

    const result = await setSystemConfig.execute({
      key: 'deploy_limit',
      value: '10',
    });

    expect(result).toContain('Failed to update configuration');
    expect(result).toContain('Permission denied');
  });

  it('handles non-Error exceptions', async () => {
    mockSaveRawConfig.mockRejectedValue('timeout');

    const result = await setSystemConfig.execute({
      key: 'active_provider',
      value: 'openai',
    });

    expect(result).toContain('Failed to update configuration');
  });

  it('passes key and value correctly', async () => {
    mockSaveRawConfig.mockResolvedValue(undefined);

    await setSystemConfig.execute({ key: 'test_key', value: 'test_value' });

    expect(mockSaveRawConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveRawConfig).toHaveBeenCalledWith('test_key', 'test_value', expect.anything());
  });
});
