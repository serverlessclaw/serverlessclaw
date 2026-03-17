import { describe, it, expect, vi } from 'vitest';
import { DynamoMemory } from '../memory';
import { ProviderManager } from './index';
import { Agent } from '../agent';
import { TraceSource, MessageRole, Message } from '../types/index';

// We skip actual LLM calls unless explicitly requested,
// but this shows how to setup the integration test.
// 1. Setup mocks to avoid real AWS/OpenAI calls in CI
vi.mock('sst', () => ({
  Resource: {
    OpenAIApiKey: { value: 'test' },
    TraceTable: { name: 'test-trace' },
    MemoryTable: { name: 'test-memory' },
  },
}));

// Mock DynamoDB client used by Memory and Tracer
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: vi.fn().mockResolvedValue({}) }) },
  PutCommand: class {},
  GetCommand: class {},
  QueryCommand: class {},
  UpdateCommand: class {},
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));

describe('Backend API Integration', () => {
  it('should format a message with a file attachment for the provider', async () => {
    const memory = new DynamoMemory();
    const provider = new ProviderManager();
    const agent = new Agent(memory, provider, [], 'Test Prompt');

    const sessionId = 'integration-test';
    const storageId = 'CONV#dashboard-user#' + sessionId;

    // 2. Wrap the provider call to inspect what is sent
    const providerSpy = vi.spyOn(provider, 'call').mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'Mocked Response',
    });

    // 3. Process
    await agent.process(storageId, 'See attached file', {
      sessionId,
      source: TraceSource.DASHBOARD,
      attachments: [
        {
          type: 'file',
          name: 'test.txt',
          base64: Buffer.from('Hello').toString('base64'),
          mimeType: 'text/plain',
        },
      ],
    });

    // 4. Verify the provider received the correct attachment format
    expect(providerSpy).toHaveBeenCalled();
    const calls = providerSpy.mock.calls[0];
    const messages = calls[0] as Message[];

    const userMessage = messages.find((m) => m.role === 'user')!;
    expect(userMessage).toBeDefined();
    expect(userMessage.attachments).toBeDefined();
    expect(userMessage.attachments![0]).toMatchObject({
      type: 'file',
      name: 'test.txt',
    });
  });
});
