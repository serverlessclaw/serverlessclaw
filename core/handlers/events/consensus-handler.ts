import { EventType } from '../../lib/types/agent';
import { logger } from '../../lib/logger';
import { emitEvent } from '../../lib/utils/bus';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from '../../lib/utils/ddb-client';
import { Resource } from 'sst';
import { getReputation, computeReputationScore } from '../../lib/memory/reputation-operations';
import { BaseMemoryProvider } from '../../lib/memory/base';

interface ConsensusRequestDetail {
  requestId: string;
  proposal: string;
  initiatorId: string;
  participants: string[];
  mode?: 'majority' | 'unanimous' | 'weighted';
}

interface ConsensusVoteDetail {
  requestId: string;
  voterId: string;
  vote: boolean;
  reasoning?: string;
  weight?: number;
}

/**
 * Handles consensus requests and votes from the swarm.
 * Manages the state of active consensus cycles in DynamoDB.
 */
export async function handleConsensus(
  event: { detail: ConsensusRequestDetail | ConsensusVoteDetail },
  detailType: string
): Promise<void> {
  const docClient = getDocClient();
  const resource = Resource as unknown as { MemoryTable: { name: string } };
  const tableName = resource.MemoryTable.name;

  try {
    if (detailType === EventType.CONSENSUS_REQUEST) {
      const {
        requestId,
        proposal,
        initiatorId,
        participants,
        mode = 'majority',
      } = event.detail as ConsensusRequestDetail;

      logger.info(`[Consensus] New request ${requestId} from ${initiatorId} (Mode: ${mode})`);

      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: `CONSENSUS#${requestId}`, timestamp: 0 },
          UpdateExpression:
            'SET proposal = :prop, initiatorId = :init, participants = :parts, mode = :mode, votes = :empty_list, status = :status, createdAt = :now',
          ExpressionAttributeValues: {
            ':prop': proposal,
            ':init': initiatorId,
            ':parts': participants,
            ':mode': mode,
            ':empty_list': [],
            ':status': 'PENDING',
            ':now': Date.now(),
          },
        })
      );
    } else if (detailType === EventType.CONSENSUS_VOTE) {
      const { requestId, voterId, vote, reasoning } = event.detail as ConsensusVoteDetail;

      logger.info(`[Consensus] Vote from ${voterId} for ${requestId}: ${vote ? 'YES' : 'NO'}`);

      // Lookup reputation for weighted voting
      let weight = 1.0;
      try {
        const memBase = new BaseMemoryProvider();
        const reputation = await getReputation(memBase, voterId);
        if (reputation) {
          weight = computeReputationScore(reputation);
          logger.info(`[Consensus] Computed weight for ${voterId}: ${weight.toFixed(3)}`);
        } else {
          logger.info(`[Consensus] No reputation for ${voterId}, using default weight 1.0`);
        }
      } catch (err) {
        logger.warn(
          `[Consensus] Failed to lookup reputation for ${voterId}, defaulting to 1.0`,
          err
        );
      }

      const response = await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: `CONSENSUS#${requestId}`, timestamp: 0 },
          UpdateExpression: 'SET votes = list_append(if_not_exists(votes, :empty_list), :vote)',
          ExpressionAttributeValues: {
            ':vote': [{ voterId, vote, reasoning, timestamp: Date.now(), weight }],
            ':empty_list': [],
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const state = response.Attributes;
      if (!state) return;

      const totalVotes = state.votes.length;
      const requiredParticipants = state.participants.length;
      const yesVotes = state.votes.filter((v: { vote: boolean }) => v.vote).length;

      let isReached = false;
      let finalResult = false;

      if (state.mode === 'unanimous') {
        if (totalVotes === requiredParticipants) {
          isReached = true;
          finalResult = yesVotes === requiredParticipants;
        }
      } else if (state.mode === 'weighted') {
        if (totalVotes === requiredParticipants) {
          isReached = true;
          let totalWeight = 0;
          let yesWeight = 0;
          for (const v of state.votes) {
            const w = (v as { weight?: number }).weight ?? 1.0;
            totalWeight += w;
            if (v.vote) yesWeight += w;
          }
          finalResult = totalWeight > 0 && yesWeight / totalWeight > 0.5;
        }
      } else {
        if (totalVotes >= Math.ceil(requiredParticipants / 2)) {
          if (yesVotes > requiredParticipants / 2) {
            isReached = true;
            finalResult = true;
          } else if (totalVotes - yesVotes > requiredParticipants / 2) {
            isReached = true;
            finalResult = false;
          } else if (totalVotes === requiredParticipants) {
            isReached = true;
            finalResult = yesVotes > requiredParticipants / 2;
          }
        }
      }

      if (isReached && state.status === 'PENDING') {
        logger.info(
          `[Consensus] Request ${requestId} finalized: ${finalResult ? 'APPROVED' : 'REJECTED'}`
        );

        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { userId: `CONSENSUS#${requestId}`, timestamp: 0 },
            UpdateExpression: 'SET status = :status, finalizedAt = :now, result = :result',
            ExpressionAttributeValues: {
              ':status': 'COMPLETED',
              ':now': Date.now(),
              ':result': finalResult,
            },
          })
        );

        await emitEvent('consensus-handler', EventType.CONSENSUS_REACHED, {
          requestId,
          result: finalResult,
          initiatorId: state.initiatorId,
          votes: state.votes,
        });
      }
    }
  } catch (error) {
    logger.error('[Consensus] Error handling consensus event:', error);
  }
}
