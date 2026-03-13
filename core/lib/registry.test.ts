import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from './registry';
import { RETENTION } from './constants';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

// Mock dependencies
vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: mockSend,
    }),
  },
  GetCommand: class {
    constructor(public input: any) {}
  },
  PutCommand: class {
    constructor(public input: any) {}
  },
  UpdateCommand: class {
    constructor(public input: any) {}
  },
}));

describe('AgentRegistry Retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default retention when no override exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // No config in DDB

    const days = await AgentRegistry.getRetentionDays('MESSAGES_DAYS');
    expect(days).toBe(RETENTION.MESSAGES_DAYS);
  });

  it('should return override retention when it exists in DDB', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        value: { MESSAGES_DAYS: 7 },
      },
    });

    const days = await AgentRegistry.getRetentionDays('MESSAGES_DAYS');
    expect(days).toBe(7);
  });

  it('should fallback to default for specific items if not in override map', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        value: { SOME_OTHER_KEY: 7 },
      },
    });

    const days = await AgentRegistry.getRetentionDays('LESSONS_DAYS');
    expect(days).toBe(RETENTION.LESSONS_DAYS);
  });
});
