import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentHookRegistry, AgentHookContext } from './agent-hook';

describe('AgentHookRegistry', () => {
  beforeEach(() => {
    AgentHookRegistry.clear();
  });

  const mockContext: AgentHookContext = {
    agentId: 'test-agent',
    traceId: 'trace-123',
  };

  it('triggers onStart hooks', async () => {
    const onStart = vi.fn();
    AgentHookRegistry.register({ onStart });

    await AgentHookRegistry.triggerStart(mockContext);

    expect(onStart).toHaveBeenCalledWith(mockContext);
  });

  it('triggers onMessage hooks', async () => {
    const onMessage = vi.fn();
    AgentHookRegistry.register({ onMessage });

    const chunk = { message: 'hello' };
    await AgentHookRegistry.triggerMessage(chunk, mockContext);

    expect(onMessage).toHaveBeenCalledWith(chunk, mockContext);
  });

  it('triggers onToolCall hooks', async () => {
    const onToolCall = vi.fn();
    AgentHookRegistry.register({ onToolCall });

    const toolCall = { toolName: 'test-tool' };
    await AgentHookRegistry.triggerToolCall(toolCall, mockContext);

    expect(onToolCall).toHaveBeenCalledWith(toolCall, mockContext);
  });

  it('triggers onComplete hooks', async () => {
    const onComplete = vi.fn();
    AgentHookRegistry.register({ onComplete });

    const result = { success: true };
    await AgentHookRegistry.triggerComplete(result, mockContext);

    expect(onComplete).toHaveBeenCalledWith(result, mockContext);
  });

  it('triggers onError hooks', async () => {
    const onError = vi.fn();
    AgentHookRegistry.register({ onError });

    const error = new Error('test-error');
    await AgentHookRegistry.triggerError(error, mockContext);

    expect(onError).toHaveBeenCalledWith(error, mockContext);
  });

  it('handles multiple hook registrations', async () => {
    const onStart1 = vi.fn();
    const onStart2 = vi.fn();

    AgentHookRegistry.register({ onStart: onStart1 });
    AgentHookRegistry.register({ onStart: onStart2 });

    await AgentHookRegistry.triggerStart(mockContext);

    expect(onStart1).toHaveBeenCalled();
    expect(onStart2).toHaveBeenCalled();
  });

  it('survives hook execution errors', async () => {
    const onStart1 = vi.fn().mockImplementation(() => {
      throw new Error('Boom');
    });
    const onStart2 = vi.fn();

    AgentHookRegistry.register({ onStart: onStart1 });
    AgentHookRegistry.register({ onStart: onStart2 });

    await AgentHookRegistry.triggerStart(mockContext);

    expect(onStart1).toHaveBeenCalled();
    expect(onStart2).toHaveBeenCalled();
  });
});
