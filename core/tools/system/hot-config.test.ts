import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/constants', () => ({
  CONFIG_KEYS: {
    ACTIVE_PROVIDER: 'active_provider',
    ACTIVE_MODEL: 'active_model',
  },
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock('../../lib/types/index', () => ({
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

const mockSaveRawConfig = vi.fn();
vi.mock('../../lib/registry', () => ({
  AgentRegistry: {
    saveRawConfig: (...args: unknown[]) => mockSaveRawConfig(...args),
  },
}));

import { switchModel } from './hot-config';

describe('switchModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(switchModel.name).toBe('switchModel');
    expect(switchModel.description).toBeDefined();
    expect(switchModel.parameters).toBeDefined();
  });

  it('requires provider and model parameters', () => {
    expect(switchModel.parameters.required).toContain('provider');
    expect(switchModel.parameters.required).toContain('model');
  });

  it('switches model successfully', async () => {
    mockSaveRawConfig.mockResolvedValue(undefined);

    const result = await switchModel.execute({
      provider: 'openai',
      model: 'gpt-5.4-mini',
    });

    expect(result).toContain('Successfully switched to openai with model gpt-5.4-mini');
    expect(mockSaveRawConfig).toHaveBeenCalledWith('active_provider', 'openai');
    expect(mockSaveRawConfig).toHaveBeenCalledWith('active_model', 'gpt-5.4-mini');
  });

  it('saves provider and model to correct config keys', async () => {
    mockSaveRawConfig.mockResolvedValue(undefined);

    await switchModel.execute({ provider: 'bedrock', model: 'claude-4.6' });

    expect(mockSaveRawConfig).toHaveBeenCalledTimes(2);
    expect(mockSaveRawConfig).toHaveBeenNthCalledWith(1, 'active_provider', 'bedrock');
    expect(mockSaveRawConfig).toHaveBeenNthCalledWith(2, 'active_model', 'claude-4.6');
  });

  it('returns failure message when save fails', async () => {
    mockSaveRawConfig.mockRejectedValue(new Error('DynamoDB connection failed'));

    const result = await switchModel.execute({
      provider: 'openai',
      model: 'gpt-4o',
    });

    expect(result).toContain('Failed to switch model');
    expect(result).toContain('DynamoDB connection failed');
  });

  it('handles non-Error exceptions', async () => {
    mockSaveRawConfig.mockRejectedValue('unknown error');

    const result = await switchModel.execute({
      provider: 'openrouter',
      model: 'glm-5',
    });

    expect(result).toContain('Failed to switch model');
  });

  it('handles first save success but second save failure', async () => {
    mockSaveRawConfig
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second save failed'));

    const result = await switchModel.execute({
      provider: 'openai',
      model: 'bad-model',
    });

    expect(result).toContain('Failed to switch model');
    expect(result).toContain('second save failed');
  });

  it('dynamically imports AgentRegistry', async () => {
    mockSaveRawConfig.mockResolvedValue(undefined);

    await switchModel.execute({ provider: 'minimax', model: 'm2.7' });

    expect(mockSaveRawConfig).toHaveBeenCalled();
  });
});
