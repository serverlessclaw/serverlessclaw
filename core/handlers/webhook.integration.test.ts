import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'test-token' },
    StagingBucket: { name: 'test-bucket' },
    MemoryTable: { name: 'test-memory-table' },
    AgentBus: { name: 'test-agent-bus' },
  },
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../agents/superclaw', () => ({
  SuperClaw: class {
    static parseCommand = vi.fn().mockReturnValue({ profile: 'standard', cleanText: 'hello' });
    process = vi.fn().mockResolvedValue({ responseText: 'hi', attachments: [] });
  },
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    addMessage = vi.fn().mockResolvedValue(undefined);
    getHistory = vi.fn().mockResolvedValue([]);
    saveConversationMeta = vi.fn().mockResolvedValue(undefined);
    getSummary = vi.fn().mockResolvedValue(null);
    updateSummary = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../lib/providers/index', () => ({
  ProviderManager: class {
    getCapabilities = vi.fn().mockResolvedValue({
      supportedReasoningProfiles: ['standard'],
    });
  },
}));

const mockSessionStateManagerInstance = {
  acquireProcessing: vi.fn().mockResolvedValue(true),
  releaseProcessing: vi.fn().mockResolvedValue(undefined),
  addPendingMessage: vi.fn().mockResolvedValue(undefined),
  getPendingMessages: vi.fn().mockResolvedValue([]),
  clearPendingMessages: vi.fn().mockResolvedValue(undefined),
  renewProcessing: vi.fn().mockResolvedValue(true),
};

vi.mock('../lib/session/session-state', () => ({
  SessionStateManager: class {
    acquireProcessing = mockSessionStateManagerInstance.acquireProcessing;
    releaseProcessing = mockSessionStateManagerInstance.releaseProcessing;
    addPendingMessage = mockSessionStateManagerInstance.addPendingMessage;
    getPendingMessages = mockSessionStateManagerInstance.getPendingMessages;
    clearPendingMessages = mockSessionStateManagerInstance.clearPendingMessages;
    renewProcessing = mockSessionStateManagerInstance.renewProcessing;
  },
}));

vi.mock('../lib/registry/index', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'superclaw',
      name: 'SuperClaw',
      systemPrompt: 'You are SuperClaw',
    }),
  },
}));

vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/handoff', () => ({
  requestHandoff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/utils/agent-helpers')>();
  return {
    ...actual,
    isE2ETest: () => true,
  };
});

describe('Webhook Handler Integration', () => {
  const mockContext = { awsRequestId: 'test-request-id' } as Context;

  const createTelegramEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
    ({
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }) as unknown as APIGatewayProxyEventV2;

  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    vi.clearAllMocks();
    mockSessionStateManagerInstance.acquireProcessing.mockResolvedValue(true);
  });

  it('should parse Telegram message, acquire session lock, and process via agent', async () => {
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(UpdateCommand).resolves({ Attributes: {} });
    ebMock.on(PutEventsCommand).resolves({});

    const { handler } = await import('./webhook');

    const event = createTelegramEvent({
      update_id: 123,
      message: {
        message_id: 456,
        chat: { id: 789 },
        text: 'hello integration test',
        date: Date.now(),
      },
    });

    const result = await handler(event, mockContext);

    expect((result as any).statusCode).toBe(200);
    expect(mockSessionStateManagerInstance.acquireProcessing).toHaveBeenCalledWith(
      '789',
      'test-request-id'
    );
    expect(mockSessionStateManagerInstance.releaseProcessing).toHaveBeenCalledWith(
      '789',
      'test-request-id'
    );
  });

  it('should queue message when session is busy', async () => {
    mockSessionStateManagerInstance.acquireProcessing.mockResolvedValueOnce(false);

    const { handler } = await import('./webhook');

    const event = createTelegramEvent({
      update_id: 124,
      message: {
        message_id: 457,
        chat: { id: 789 },
        text: 'busy message',
        date: Date.now(),
      },
    });

    const result = await handler(event, mockContext);

    expect((result as any).statusCode).toBe(200);
    expect((result as any).body).toBe('Message queued for processing');
    expect(mockSessionStateManagerInstance.addPendingMessage).toHaveBeenCalled();
  });

  it('should return 200 OK for non-message updates (valid schema but no message)', async () => {
    const { handler } = await import('./webhook');

    const event = createTelegramEvent({ invalid: 'data' });

    const result = await handler(event, mockContext);

    expect((result as any).statusCode).toBe(200);
    expect((result as any).body).toBe('OK');
  });

  it('should return 200 OK for non-message updates', async () => {
    const { handler } = await import('./webhook');

    const event = createTelegramEvent({ update_id: 999 });

    const result = await handler(event, mockContext);

    expect((result as any).statusCode).toBe(200);
    expect((result as any).body).toBe('OK');
  });

  it('should return 400 for empty body', async () => {
    const { handler } = await import('./webhook');

    const event = { body: null } as unknown as APIGatewayProxyEventV2;

    const result = await handler(event, mockContext);

    expect((result as any).statusCode).toBe(400);
  });
});
