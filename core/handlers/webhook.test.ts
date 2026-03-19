import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Mock sst Resource BEFORE other imports
vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'mock-token' },
    StagingBucket: { name: 'mock-bucket' },
  },
}));

import { handler } from './webhook';
import { mockClient } from 'aws-sdk-client-mock';

// Mock dependencies
const mockSuperClawProcess = vi.fn().mockResolvedValue({
  responseText: 'Mocked response',
  attachments: [],
});

vi.mock('../agents/superclaw', () => ({
  SuperClaw: class {
    static parseCommand(input: string) {
      return { cleanText: input, profile: undefined };
    }

    process = mockSuperClawProcess;
  },
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {},
}));

vi.mock('../lib/providers/index', () => ({
  ProviderManager: class {},
}));

vi.mock('../lib/lock', () => ({
  DynamoLockManager: class {
    acquire = vi.fn().mockResolvedValue(true);
    release = vi.fn().mockResolvedValue(true);
  },
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'main',
      systemPrompt: 'Mocked prompt',
    }),
  },
}));

vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

const s3Mock = mockClient(S3Client);

// Mock global fetch
global.fetch = vi.fn();

describe('Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    s3Mock.reset();
  });

  it('should process simple text message', async () => {
    const event = {
      body: JSON.stringify({
        update_id: 12345,
        message: {
          message_id: 1,
          from: { id: 123456789, is_bot: false, first_name: 'TestUser' },
          chat: { id: 123456789, first_name: 'TestUser', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: 'Hello bot',
        },
      }),
    } as any;

    const result = (await handler(event, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    expect(mockSuperClawProcess).toHaveBeenCalledWith('123456789', 'Hello bot', expect.anything());
  });

  it('should return 400 for invalid Telegram update payload', async () => {
    // Test with missing body
    let event: any = { body: undefined };
    let result: any = await handler(event, {} as any);
    expect(result.statusCode).toBe(400);

    // Test with malformed JSON
    event = { body: 'this is not json' };
    result = await handler(event, {} as any);
    expect(result.statusCode).toBe(400);

    // Test with a valid non-message update: should be acknowledged
    event = {
      body: JSON.stringify({
        update_id: 67890,
      }),
    };
    result = await handler(event, {} as any);
    expect(result.statusCode).toBe(200);

    // Test with message missing required chat.id
    event = {
      body: JSON.stringify({
        update_id: 67891,
        message: {
          message_id: 2,
          from: { id: 987654321, is_bot: false, first_name: 'AnotherUser' },
          date: Math.floor(Date.now() / 1000),
          text: 'Missing chat ID',
        },
      }),
    };
    result = await handler(event, {} as any);
    expect(result.statusCode).toBe(400);
  });

  it('should process photo attachment', async () => {
    const event = {
      body: JSON.stringify({
        update_id: 12345,
        message: {
          message_id: 101,
          from: { id: 11223344, is_bot: false, first_name: 'TestSender' },
          chat: { id: 123456789, first_name: 'TestChat', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: 'Check this photo',
          photo: [
            { file_id: 'small_id', file_unique_id: 'unique_small', width: 100, height: 100 },
            { file_id: 'large_id', file_unique_id: 'unique_large', width: 500, height: 500 },
          ],
        },
      }),
    } as any;

    // Mock Telegram getFile

    (global.fetch as any)
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: { file_path: 'photos/file.jpg' } }),
      })
      // Mock File Download
      .mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

    s3Mock.on(PutObjectCommand).resolves({});

    const result = (await handler(event, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    expect(s3Mock.calls().length).toBe(1);

    expect(mockSuperClawProcess).toHaveBeenCalledWith(
      '123456789',
      'Check this photo',
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            type: 'image',
            url: expect.stringContaining('.s3.'),
          }),
        ],
      })
    );
  });
});
