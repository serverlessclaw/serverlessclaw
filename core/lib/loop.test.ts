import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler as eventHandler } from '../handlers/events';
import { EventType } from './types/agent';

const ebMock = mockClient(EventBridgeClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory' },
    ConfigTable: { name: 'test-config' },
    TraceTable: { name: 'test-trace' },
  },
}));

// Mock Notifier
vi.mock('./outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock Registry
vi.mock('./registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({ systemPrompt: 'test', name: 'Test' }),
    getRawConfig: vi.fn().mockResolvedValue(undefined),
    getRetentionDays: vi.fn().mockResolvedValue(30),
  },
}));

// Mock Memory to avoid real DDB calls in history retrieval
vi.mock('./memory', () => ({
  DynamoMemory: class {
    getHistory = vi.fn().mockResolvedValue([]);
    getDistilledMemory = vi.fn().mockResolvedValue('');
    getLessons = vi.fn().mockResolvedValue([]);
    addMessage = vi.fn().mockResolvedValue(undefined);
    updateDistilledMemory = vi.fn().mockResolvedValue(undefined);
    searchInsights = vi.fn().mockResolvedValue([]);
    setGap = vi.fn().mockResolvedValue(undefined);
    updateGapStatus = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock ProviderManager to avoid real LLM calls
vi.mock('./providers/index', () => ({
  ProviderManager: class {
    call = vi.fn().mockResolvedValue({
      content: 'Mocked response',
      role: 'assistant',
    });
    getCapabilities = vi.fn().mockResolvedValue({
      supportedReasoningProfiles: ['standard'],
      maxReasoningEffort: 'medium',
    });
  },
}));

describe('Autonomous Loop Closure', () => {
  beforeEach(() => {
    ebMock.reset();
    ddbMock.reset();
    vi.clearAllMocks();
  });

  it('should wake up the initiator agent after a successful build', async () => {
    const mockEvent = {
      'detail-type': EventType.SYSTEM_BUILD_SUCCESS,
      detail: {
        userId: 'user-1',
        buildId: 'build-123',
        initiatorId: 'strategic-planner.agent',
        task: 'Add AWS Security Agent',
        traceId: 'trace-456',
      },
    };

    await eventHandler(mockEvent as any, { getRemainingTimeInMillis: () => 300000 } as any);

    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    const continuationCall = ebCalls.find(
      (c) => JSON.parse(c.args[0].input.Entries![0].Detail!).agentId === 'strategic-planner'
    );

    expect(continuationCall).toBeDefined();
    const payload = JSON.parse(continuationCall!.args[0].input.Entries![0].Detail!);
    expect(payload.task).toContain('BUILD_SUCCESS_NOTIFICATION');
    expect(payload.agentId).toBe('strategic-planner');
  });

  it('should wake up the initiator agent after a failed build', async () => {
    const mockEvent = {
      'detail-type': EventType.SYSTEM_BUILD_FAILED,
      detail: {
        userId: 'user-1',
        buildId: 'build-failed',
        errorLogs: 'TypeScript Error: type mismatch',
        initiatorId: 'strategic-planner.agent',
        task: 'Add AWS Security Agent',
        traceId: 'trace-456',
      },
    };

    // Mock the tracer start call
    ddbMock.on(PutCommand).resolves({});

    await eventHandler(mockEvent as any, { getRemainingTimeInMillis: () => 300000 } as any);

    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    const continuationCall = ebCalls.find(
      (c) => JSON.parse(c.args[0].input.Entries![0].Detail!).agentId === 'strategic-planner'
    );

    expect(continuationCall).toBeDefined();
    const payload = JSON.parse(continuationCall!.args[0].input.Entries![0].Detail!);
    expect(payload.task).toContain('BUILD_FAILURE_NOTIFICATION');
    expect(payload.agentId).toBe('strategic-planner');
  });
});
