import { describe, it, expect, vi } from 'vitest';
import { DynamoMemory } from '../memory';
import { ProviderManager } from './index';
import { Agent } from '../agent';
import { MessageRole, Message, ReasoningProfile } from '../types/index';

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

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue(undefined),
    getTypedConfig: vi.fn().mockImplementation((key, fallback) => Promise.resolve(fallback)),
  },
}));

vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn().mockResolvedValue(30),
  },
}));

// Mock constants
vi.mock('../constants', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    TOOLS: {
      ...actual.TOOLS,
      discoverSkills: 'discoverSkills',
      installSkill: 'installSkill',
      saveMemory: 'saveMemory',
      seekClarification: 'seekClarification',
      provideClarification: 'provideClarification',
      recallKnowledge: 'recallKnowledge',
      sendMessage: 'sendMessage',
      manageGap: 'manageGap',
      reportGap: 'reportGap',
      checkHealth: 'checkHealth',
      inspectTopology: 'inspectTopology',
    },
    MEMORY_KEYS: {
      ...actual.MEMORY_KEYS,
      CONVERSATION_PREFIX: 'CONV#',
    },
    DYNAMO_KEYS: {
      ...actual.DYNAMO_KEYS,
      RETENTION_CONFIG: 'retention_config',
    },
    RETENTION: {
      ...actual.RETENTION,
      TRACES_DAYS: 30,
    },
    TIME: {
      ...actual.TIME,
      MS_PER_SECOND: 1000,
      SECONDS_IN_DAY: 86400,
    },
    TRACE_STATUS: {
      ...actual.TRACE_STATUS,
      STARTED: 'started',
    },
    AGENT_ERRORS: {
      ...actual.AGENT_ERRORS,
      PROCESS_FAILURE: 'error',
    },
    LIMITS: {
      ...actual.LIMITS,
      MAX_CONTEXT_LENGTH: 10000,
    },
  };
});

const mockRunLoop = vi.fn().mockResolvedValue({
  responseText: 'Mocked Response',
  paused: false,
  attachments: [],
});

vi.mock('../agent/executor', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    AgentExecutor: vi.fn().mockImplementation(function () {
      return {
        runLoop: mockRunLoop,
      };
    }),
  };
});

describe('Backend API Integration', () => {
  it('should format a message with a file attachment for the provider', async () => {
    const memory = new DynamoMemory();
    const provider = new ProviderManager();
    new Agent(memory, provider, [], 'Test Prompt');

    vi.spyOn(provider, 'getCapabilities').mockResolvedValue({
      supportedReasoningProfiles: [ReasoningProfile.STANDARD],
      contextWindow: 10000,
    });

    const { ClawTracer } = await import('../tracer');
    vi.spyOn(ClawTracer.prototype, 'startTrace').mockResolvedValue('test-trace-id' as any);

    const { ContextManager } = await import('../agent/context-manager');
    vi.spyOn(ContextManager, 'getManagedContext').mockResolvedValue({
      messages: [
        {
          role: MessageRole.USER,
          content: 'See attached file',
          attachments: [
            {
              type: 'file',
              name: 'test.txt',
              base64: Buffer.from('Hello').toString('base64'),
              mimeType: 'text/plain',
            },
          ],
        },
      ],
    });

    // 3. Process
    const messages: Message[] = [
      {
        role: MessageRole.USER,
        content: 'See attached file',
        attachments: [
          {
            type: 'file',
            name: 'test.txt',
            base64: Buffer.from('Hello').toString('base64'),
            mimeType: 'text/plain',
          },
        ],
      },
    ];

    const { AgentExecutor } = await import('../agent/executor');
    const executor = new AgentExecutor(provider, [], 'test-agent', 'Test Agent');

    await executor.runLoop(messages, {
      activeModel: 'gpt-5.4-mini',
      activeProvider: 'openai',
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 25,
      tracer: { getTraceId: () => 'test-trace' } as any,
      traceId: 'test-trace',
      nodeId: 'test-node',
      parentId: undefined,
      currentInitiator: 'test',
      depth: 0,
      sessionId: 'test-session',
      userId: 'test-user',
      userText: 'See attached file',
      mainConversationId: 'test-user',
    });

    // 4. Verify the executor received the correct attachment format
    expect(mockRunLoop).toHaveBeenCalled();
    const calls = mockRunLoop.mock.calls[0];
    const receivedMessages = calls[0] as Message[];

    const userMessage = receivedMessages.find((m) => m.role === MessageRole.USER)!;
    expect(userMessage).toBeDefined();
    expect(userMessage.attachments).toBeDefined();
    expect(userMessage.attachments![0]).toMatchObject({
      type: 'file',
      name: 'test.txt',
    });
  });
});
