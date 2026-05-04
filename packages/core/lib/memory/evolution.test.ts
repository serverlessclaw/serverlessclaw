import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from './dynamo-memory';

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

// Mock AgentRegistry
vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn().mockResolvedValue(30),
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoMemory Evolution — Hit Tracking & Registry', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(QueryCommand).resolves({ Items: [] }); // Default for similarity checks
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('addRecord (via addMemory)', () => {
    it('should register the memory type in SYSTEM#REGISTRY', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      await memory.addMemory('USER#1', 'research_log', 'some content');

      // Check UpdateCommand for registry
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0].input).toMatchObject({
        Key: { userId: 'SYSTEM#REGISTRY', timestamp: 0 },
        UpdateExpression: 'ADD activeTypes :type',
      });
      // The Set is handled by the marshaller, but we can check the value
      const values = updateCalls[0].args[0].input.ExpressionAttributeValues;
      expect(values?.[':type']).toBeDefined();
    });

    it('should initialize hitCount and lastAccessed in metadata', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      const now = 1710240000000;
      vi.setSystemTime(now);

      await memory.addMemory('USER#1', 'research_log', 'some content');

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);
      const item = putCalls[0].args[0].input.Item;
      expect(item?.metadata).toMatchObject({
        hitCount: 0,
        lastAccessed: now,
      });

      vi.useRealTimers();
    });
  });

  describe('recordMemoryHit', () => {
    it('should increment hitCount and update lastAccessed', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      const now = 1710240000000;
      vi.setSystemTime(now);

      await memory.recordMemoryHit('USER#1', 12345);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0].input).toMatchObject({
        Key: { userId: 'USER#1', timestamp: 12345 },
        UpdateExpression:
          'SET metadata.hitCount = if_not_exists(metadata.hitCount, :zero) + :inc, metadata.lastAccessed = :now',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
          ':now': now,
        },
      });

      vi.useRealTimers();
    });
  });

  describe('getRegisteredMemoryTypes', () => {
    it('should return unique types from SYSTEM#REGISTRY', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ activeTypes: ['MEMORY:RESEARCH', 'MEMORY:GOAL'] }],
      });

      const types = await memory.getRegisteredMemoryTypes();
      expect(types).toEqual(['MEMORY:RESEARCH', 'MEMORY:GOAL']);
    });
  });

  describe('getLowUtilizationMemory', () => {
    it('should filter items by stale threshold and low hit count', async () => {
      const now = Date.now();
      const fourteenDaysAgo = now - 15 * 24 * 60 * 60 * 1000;

      // Mock registry
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [{ activeTypes: ['MEMORY:STALE'] }] }) // Registry call
        .resolvesOnce({
          // getMemoryByType call for MEMORY:STALE
          Items: [
            {
              userId: 'USER#1',
              timestamp: fourteenDaysAgo,
              metadata: { hitCount: 0, lastAccessed: fourteenDaysAgo },
            },
            {
              userId: 'USER#2',
              timestamp: now,
              metadata: { hitCount: 5, lastAccessed: now },
            },
          ],
        });

      const stale = await memory.getLowUtilizationMemory(10);
      expect(stale).toHaveLength(1);
      expect(stale[0].userId).toBe('USER#1');
    });
  });
});
