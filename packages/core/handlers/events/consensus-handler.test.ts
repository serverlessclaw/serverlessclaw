import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('sst', () => ({
  Resource: { MemoryTable: { name: 'test-table' } },
}));

vi.mock('../../lib/utils/ddb-client', () => ({
  getDocClient: () => ddbMock,
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/memory/reputation-operations', () => ({
  computeReputationScore: vi.fn((rep: { successRate: number }) => rep.successRate),
  getReputation: vi.fn().mockResolvedValue(null),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

import { handleConsensus } from './consensus-handler';
import { EventType } from '../../lib/types/agent';
import { emitEvent } from '../../lib/utils/bus';

describe('Consensus Handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  describe('CONSENSUS_REQUEST', () => {
    it('should initialize consensus state in DynamoDB', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await handleConsensus(
        {
          detail: {
            requestId: 'req-1',
            proposal: 'Deploy feature X',
            initiatorId: 'planner',
            participants: ['coder', 'qa', 'security'],
            mode: 'majority',
          },
        },
        EventType.CONSENSUS_REQUEST
      );

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      const item = calls[0].args[0].input;
      expect(item.Key).toEqual({ userId: 'CONSENSUS#req-1', timestamp: 0 });
      expect(item.ExpressionAttributeValues?.[':status']).toBe('PENDING');
      expect(item.ExpressionAttributeValues?.[':mode']).toBe('majority');
    });

    it('should default to majority mode', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await handleConsensus(
        {
          detail: {
            requestId: 'req-2',
            proposal: 'Test proposal',
            initiatorId: 'planner',
            participants: ['a', 'b', 'c'],
          },
        },
        EventType.CONSENSUS_REQUEST
      );

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues?.[':mode']).toBe('majority');
    });
  });

  describe('CONSENSUS_VOTE — majority mode', () => {
    it('should approve when majority yes votes received', async () => {
      // Simulate 3 participants, 2 yes votes
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b', 'c'],
          mode: 'majority',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b', 'c'],
          mode: 'majority',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [
            { voterId: 'a', vote: true, timestamp: Date.now() },
            { voterId: 'b', vote: true, timestamp: Date.now() },
          ],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-3',
            voterId: 'b',
            vote: true,
            reasoning: 'Looks good',
          },
        },
        EventType.CONSENSUS_VOTE
      );

      // Should emit CONSENSUS_REACHED
      expect(emitEvent).toHaveBeenCalledWith(
        'consensus-handler',
        EventType.CONSENSUS_REACHED,
        expect.objectContaining({ requestId: 'req-3', result: true })
      );
    });

    it('should reject when majority no votes received', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b', 'c'],
          mode: 'majority',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b', 'c'],
          mode: 'majority',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [
            { voterId: 'a', vote: false, timestamp: Date.now() },
            { voterId: 'b', vote: false, timestamp: Date.now() },
            { voterId: 'c', vote: true, timestamp: Date.now() },
          ],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-4',
            voterId: 'c',
            vote: true,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      expect(emitEvent).toHaveBeenCalledWith(
        'consensus-handler',
        EventType.CONSENSUS_REACHED,
        expect.objectContaining({ requestId: 'req-4', result: false })
      );
    });

    it('should not finalize when not enough votes yet', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b', 'c'],
          mode: 'majority',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [{ voterId: 'a', vote: true, timestamp: Date.now() }],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b', 'c'],
          mode: 'majority',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [{ voterId: 'a', vote: true, timestamp: Date.now() }],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-5',
            voterId: 'a',
            vote: true,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      // Should NOT emit CONSENSUS_REACHED
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('P0 Fix: should reject votes from non-participants', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b', 'c'],
          mode: 'majority',
          status: 'PENDING',
          votes: [],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-5a',
            voterId: 'attacker', // Not in participants list
            vote: true,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      // Should NOT process the vote or emit any event
      expect(emitEvent).not.toHaveBeenCalled();
    });
  });

  describe('CONSENSUS_VOTE — unanimous mode', () => {
    it('should approve only when all vote yes', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b'],
          mode: 'unanimous',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b'],
          mode: 'unanimous',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [
            { voterId: 'a', vote: true, timestamp: Date.now() },
            { voterId: 'b', vote: true, timestamp: Date.now() },
          ],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-6',
            voterId: 'b',
            vote: true,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      expect(emitEvent).toHaveBeenCalledWith(
        'consensus-handler',
        EventType.CONSENSUS_REACHED,
        expect.objectContaining({ result: true })
      );
    });

    it('should reject if any single vote is no', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b'],
          mode: 'unanimous',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b'],
          mode: 'unanimous',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [
            { voterId: 'a', vote: true, timestamp: Date.now() },
            { voterId: 'b', vote: false, timestamp: Date.now() },
          ],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-7',
            voterId: 'b',
            vote: false,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      expect(emitEvent).toHaveBeenCalledWith(
        'consensus-handler',
        EventType.CONSENSUS_REACHED,
        expect.objectContaining({ result: false })
      );
    });

    it('should wait for all votes before deciding', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b', 'c'],
          mode: 'unanimous',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b', 'c'],
          mode: 'unanimous',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [
            { voterId: 'a', vote: true, timestamp: Date.now() },
            { voterId: 'b', vote: true, timestamp: Date.now() },
          ],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-8',
            voterId: 'b',
            vote: true,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      // Only 2/3 votes — should NOT finalize
      expect(emitEvent).not.toHaveBeenCalled();
    });
  });

  describe('CONSENSUS_VOTE — weighted mode', () => {
    it('should approve when weighted yes exceeds 50%', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b', 'c'],
          mode: 'weighted',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b', 'c'],
          mode: 'weighted',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [
            { voterId: 'a', vote: true, weight: 0.9, timestamp: Date.now() },
            { voterId: 'b', vote: false, weight: 0.2, timestamp: Date.now() },
            { voterId: 'c', vote: true, weight: 0.8, timestamp: Date.now() },
          ],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-9',
            voterId: 'c',
            vote: true,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      // total weight = 1.9, yes weight = 1.7 => 1.7/1.9 > 0.5
      expect(emitEvent).toHaveBeenCalledWith(
        'consensus-handler',
        EventType.CONSENSUS_REACHED,
        expect.objectContaining({ result: true })
      );
    });

    it('should reject when weighted yes is below 50%', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          participants: ['a', 'b'],
          mode: 'weighted',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [],
        },
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: {
          participants: ['a', 'b'],
          mode: 'weighted',
          status: 'PENDING',
          initiatorId: 'planner',
          votes: [
            { voterId: 'a', vote: false, weight: 0.9, timestamp: Date.now() },
            { voterId: 'b', vote: true, weight: 0.1, timestamp: Date.now() },
          ],
        },
      });

      await handleConsensus(
        {
          detail: {
            requestId: 'req-10',
            voterId: 'b',
            vote: true,
          },
        },
        EventType.CONSENSUS_VOTE
      );

      // yes weight = 0.1, total = 1.0 => 0.1 < 0.5
      expect(emitEvent).toHaveBeenCalledWith(
        'consensus-handler',
        EventType.CONSENSUS_REACHED,
        expect.objectContaining({ result: false })
      );
    });
  });
});
