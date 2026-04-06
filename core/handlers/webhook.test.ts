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

  it('should process photo messages and upload to S3', async () => {
    // Mock fetch for getFile and file download
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('getFile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: { file_path: 'photos/file_1.jpg' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      });
    });
    global.fetch = mockFetch;

    // Mock S3 PutObject
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { mockClient } = await import('aws-sdk-client-mock');
    const s3Mock = mockClient(S3Client);
    s3Mock.on(PutObjectCommand).resolves({});

    const event = createEvent({
      update_id: 123,
      message: {
        message_id: 456,
        chat: { id: 789 },
        photo: [{ file_id: 'photo_123', width: 100, height: 100 }],
        caption: 'look at this',
        date: Date.now(),
      },
    });

    const result = await handler(event, mockContext);
    expect(result).toEqual({ statusCode: 200, body: 'OK' });
    expect(s3Mock.calls()).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('getFile?file_id=photo_123'),
      expect.anything()
    );
  });

  it('should handle document messages', async () => {
    // Mock fetch for getFile and file download
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('getFile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: { file_path: 'docs/resume.pdf' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)),
      });
    });
    global.fetch = mockFetch;

    // Mock S3 PutObject
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { mockClient } = await import('aws-sdk-client-mock');
    const s3Mock = mockClient(S3Client);
    s3Mock.on(PutObjectCommand).resolves({});

    const event = createEvent({
      update_id: 123,
      message: {
        message_id: 457,
        chat: { id: 789 },
        document: {
          file_id: 'doc_456',
          file_name: 'resume.pdf',
          mime_type: 'application/pdf',
        },
        date: Date.now(),
      },
    });

    const result = await handler(event, mockContext);
    expect(result).toEqual({ statusCode: 200, body: 'OK' });
    expect(s3Mock.calls()).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('getFile?file_id=doc_456'),
      expect.anything()
    );
  });
});
