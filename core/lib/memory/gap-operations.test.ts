import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { setGap, updateGapStatus } from './gap-operations';
import { GapStatus } from '../types/agent';
import { BaseMemoryProvider } from './base';

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Gap Operations — Prefix Handling', () => {
  let base: BaseMemoryProvider;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    base = new BaseMemoryProvider();
  });

  describe('setGap', () => {
    it('should NOT double-prefix if gapId already has GAP#', async () => {
      ddbMock.on(PutCommand).resolves({});

      await setGap(base, 'GAP#12345', 'some details');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls[0].args[0].input.Item!.userId).toBe('GAP#12345');
    });

    it('should add GAP# prefix if gapId is raw numeric', async () => {
      ddbMock.on(PutCommand).resolves({});

      await setGap(base, '12345', 'some details');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls[0].args[0].input.Item!.userId).toBe('GAP#12345');
    });

    it('should handle triple prefixing by normalizing to single GAP#', async () => {
      ddbMock.on(PutCommand).resolves({});

      await setGap(base, 'GAP#GAP#GAP#12345', 'some details');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls[0].args[0].input.Item!.userId).toBe('GAP#12345');
    });
  });

  describe('updateGapStatus', () => {
    it('should normalize ID in update expression', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateGapStatus(base, 'GAP#GAP#12345', GapStatus.PLANNED);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls[0].args[0].input.Key!.userId).toBe('GAP#12345');
    });

    it('should find gap via search if timestamp is unknown even with messy prefix', async () => {
      // Mock search results (GSI query)
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'GAP#MY_GAP', timestamp: 123456, content: 'test gap' }],
      });
      ddbMock.on(UpdateCommand).resolves({});

      // Pass ID without timestamp (parsedNumericId will be 0 or NaN)
      await updateGapStatus(base, 'GAP#GAP#PROC#MY_GAP', GapStatus.PROGRESS);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls[0].args[0].input.Key).toMatchObject({
        userId: 'GAP#MY_GAP',
        timestamp: 123456,
      });
    });
  });
});
