import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './webhook';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

// Create a mock instance to control behavior
const mockSessionStateManagerInstance = {
  acquireProcessing: vi.fn().mockResolvedValue(true),
  releaseProcessing: vi.fn().mockResolvedValue(undefined),
  addPendingMessage: vi.fn().mockResolvedValue(undefined),
  getPendingMessages: vi.fn().mockResolvedValue([]),
  clearPendingMessages: vi.fn().mockResolvedValue(undefined),
  renewProcessing: vi.fn().mockResolvedValue(true),
};

// Mock dependencies
vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'test-token' },
    StagingBucket: { name: 'test-bucket' },
    MemoryTable: { name: 'test-table' },
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
  },
}));

vi.mock('../lib/providers/index', () => ({
  ProviderManager: class {
    getCapabilities = vi.fn().mockResolvedValue({
      supportedReasoningProfiles: ['standard'],
    });
  },
}));

vi.mock('../lib/session-state', () => ({
  SessionStateManager: class {
    acquireProcessing = mockSessionStateManagerInstance.acquireProcessing;
    releaseProcessing = mockSessionStateManagerInstance.releaseProcessing;
    addPendingMessage = mockSessionStateManagerInstance.addPendingMessage;
    getPendingMessages = mockSessionStateManagerInstance.getPendingMessages;
    clearPendingMessages = mockSessionStateManagerInstance.clearPendingMessages;
    renewProcessing = mockSessionStateManagerInstance.renewProcessing;
  },
}));

vi.mock('../lib/registry', () => ({
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

describe('Webhook Handler', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
  } as Context;

  const createEvent = (body: any): APIGatewayProxyEventV2 =>
    ({
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStateManagerInstance.acquireProcessing.mockResolvedValue(true);
  });

  it('should acknowledge non-message updates', async () => {
    const event = createEvent({ update_id: 123 });
    const result = await handler(event, mockContext);
    expect(result).toEqual({ statusCode: 200, body: 'OK' });
  });

  it('should process user messages and call SuperClaw', async () => {
    const event = createEvent({
      update_id: 123,
      message: {
        message_id: 456,
        chat: { id: 789 },
        text: 'hello',
        date: Date.now(),
      },
    });

    const result = await handler(event, mockContext);
    expect(result).toEqual({ statusCode: 200, body: 'OK' });
    expect(mockSessionStateManagerInstance.acquireProcessing).toHaveBeenCalled();
  });

  it('should queue message if session is busy', async () => {
    mockSessionStateManagerInstance.acquireProcessing.mockResolvedValueOnce(false);

    const event = createEvent({
      update_id: 123,
      message: {
        message_id: 456,
        chat: { id: 789 },
        text: 'hello busy',
        date: Date.now(),
      },
    });

    const result = await handler(event, mockContext);
    expect(result).toEqual({ statusCode: 200, body: 'Message queued for processing' });
    expect(mockSessionStateManagerInstance.addPendingMessage).toHaveBeenCalled();
  });
});
