import { vi, type Mock } from 'vitest';

/**
 * Shared mock utilities for agent executor tests
 */

interface ToolCall {
  id: string;
  function: {
    name: string;
  };
}

interface MockProvider {
  call: Mock;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
}

export function createMockRunLoop(
  provider: MockProvider,
  tools: Record<string, unknown>,
  agentId: string,
  agentName: string
) {
  return async function mockRunLoop(messages: unknown[], options?: { responseFormat?: string }) {
    const hasToolCalls =
      Array.isArray(messages) &&
      messages.some(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant' &&
          'tool_calls' in m &&
          Array.isArray(m.tool_calls) &&
          m.tool_calls.length > 0
      );

    if (hasToolCalls) {
      const toolCallResponse = await provider.call(
        messages,
        tools,
        undefined,
        agentId,
        agentName,
        options?.responseFormat
      );
      messages.push(toolCallResponse);

      const toolResults = (toolCallResponse.tool_calls as ToolCall[]).map((tc) => ({
        role: 'tool' as const,
        content: `Mock result for ${tc.function.name}`,
        tool_call_id: tc.id,
        traceId: (toolCallResponse as any).traceId ?? 'mock-trace',
        messageId: `msg-mock-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      }));
      messages.push(...toolResults);

      const finalResponse = await provider.call(
        messages,
        tools,
        undefined,
        agentId,
        agentName,
        options?.responseFormat
      );
      return finalResponse;
    }

    const response = await provider.call(
      messages,
      tools,
      undefined,
      agentId,
      agentName,
      options?.responseFormat
    );
    return response;
  };
}

export function createMockAgentExecutorFactory(
  provider: MockProvider,
  tools: Record<string, unknown>,
  agentId: string,
  agentName: string,
  customRunLoop?: (messages: unknown[], options?: Record<string, unknown>) => Promise<unknown>
) {
  return {
    provider,
    tools,
    agentId,
    agentName,
    runLoop: customRunLoop ?? createMockRunLoop(provider, tools, agentId, agentName),
  };
}

export interface MockClawTracerOptions {
  getTraceId?: () => string | undefined;
  startTrace?: ReturnType<typeof vi.fn>;
  endTrace?: ReturnType<typeof vi.fn>;
  emitStep?: ReturnType<typeof vi.fn>;
  emitChunk?: ReturnType<typeof vi.fn>;
  emitStart?: ReturnType<typeof vi.fn>;
  emitError?: ReturnType<typeof vi.fn>;
}

export function createMockClawTracer(options: MockClawTracerOptions = {}) {
  return {
    getTraceId: options.getTraceId ?? (() => undefined),
    startTrace: options.startTrace ?? vi.fn(),
    endTrace: options.endTrace ?? vi.fn(),
    emitStep: options.emitStep ?? vi.fn(),
    emitChunk: options.emitChunk ?? vi.fn(),
    emitStart: options.emitStart ?? vi.fn(),
    emitError: options.emitError ?? vi.fn(),
  };
}
