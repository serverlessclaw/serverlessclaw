import { infraSchema as schema } from './schema';
import { logger } from '../../lib/logger';
import { AgentStatus, AgentRole, GapStatus } from '../../lib/types/agent';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Triggers batch evolution for multiple gaps by dispatching them to the Coder agent.
 */
export const triggerBatchEvolution = {
  ...schema.triggerBatchEvolution,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { gapIds } = args as { gapIds: string[] };

    if (!gapIds || gapIds.length === 0) {
      return 'FAILED: At least one gapId is required.';
    }

    try {
      const { DynamoMemory } = await import('../../lib/memory');
      const { emitEvent } = await import('../../lib/utils/bus');
      const memory = new DynamoMemory();

      const results: string[] = [];
      for (const gapId of gapIds) {
        const numericId = gapId.includes('#') ? gapId.split('#')[1] : gapId;
        const fullGapId = gapId.includes('#') ? gapId : `GAP#${numericId}`;

        try {
          const plan = await memory.getDistilledMemory(`PLAN#${numericId}`);
          if (plan) {
            await emitEvent('tool.batchEvolution', 'coder_task', {
              userId: 'SYSTEM#GLOBAL',
              task: plan,
              metadata: { gapIds: [fullGapId] },
              source: 'batch_evolution',
            });
            await memory.updateGapStatus(fullGapId, GapStatus.PROGRESS);
            results.push(`- ${fullGapId}: dispatched to Coder`);
          } else {
            results.push(`- ${fullGapId}: SKIPPED (no plan found)`);
          }
        } catch (gapError) {
          results.push(`- ${fullGapId}: ERROR (${formatErrorMessage(gapError)})`);
        }
      }

      return `Batch evolution complete for ${gapIds.length} gaps:\n${results.join('\n')}`;
    } catch (error) {
      return `Failed to trigger batch evolution: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Executes a high-level orchestration signal to decide the next step in a task lifecycle.
 */
export const signalOrchestration = {
  ...schema.signalOrchestration,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { status, reasoning, nextStep, targetAgentId, emit, userId, traceId, sessionId, depth } =
      args as {
        status: AgentStatus;
        reasoning: string;
        nextStep?: string;
        targetAgentId?: AgentRole;
        emit?: boolean;
        userId?: string;
        traceId?: string;
        sessionId?: string;
        depth?: number;
      };

    logger.info(`[ORCHESTRATION] Emitting Signal: ${status} | Target: ${targetAgentId ?? 'N/A'}`);
    logger.info(`[ORCHESTRATION] Reasoning: ${reasoning}`);

    let report = `ORCHESTRATION_SIGNAL_EMITTED: ${status}.\n\nReasoning: ${reasoning}`;
    if (nextStep) report += `\n\nNext Step: ${nextStep}`;
    if (targetAgentId) report += `\nTarget Agent: ${targetAgentId}`;

    if (emit && targetAgentId) {
      try {
        const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
        const { EventType } = await import('../../lib/types/agent');

        await emitTypedEvent('tool.orchestration', EventType.ORCHESTRATION_SIGNAL, {
          userId: userId || 'SYSTEM',
          agentId: targetAgentId,
          status,
          reasoning,
          nextStep,
          traceId,
          sessionId,
          depth: depth ?? 0,
        });
        report += '\n\n[EVENT_EMITTED]: Signal dispatched to the EventBus.';
      } catch (error) {
        report += `\n\n[EMIT_FAILED]: ${formatErrorMessage(error)}`;
      }
    }

    return report;
  },
};

/**
 * Requests swarm consensus from multiple agents on a proposal.
 */
export const requestConsensus = {
  ...schema.requestConsensus,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { proposal, voterIds, mode, timeoutMs } = args as {
      proposal: string;
      voterIds: string[];
      mode?: 'majority' | 'unanimous' | 'weighted';
      timeoutMs?: number;
    };

    if (!voterIds || voterIds.length === 0) {
      return 'FAILED: At least one voterId is required for consensus.';
    }

    try {
      const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
      const { EventType } = await import('../../lib/types/agent');

      await emitTypedEvent('tool.consensus', EventType.CONSENSUS_REQUEST, {
        userId: 'SYSTEM',
        traceId: `consensus-${Date.now()}`,
        taskId: `consensus-req-${Date.now()}`,
        initiatorId: 'tool-requestConsensus',
        depth: 0,
        proposal,
        voterIds,
        mode: mode ?? 'majority',
        timeoutMs: timeoutMs ?? 60000,
        metadata: {},
      });

      return (
        `CONSENSUS_REQUESTED: Proposal "${proposal.slice(0, 100)}..." dispatched to ` +
        `${voterIds.length} voters using ${mode ?? 'majority'} mode. ` +
        `Result will be delivered via CONSENSUS_REACHED event.`
      );
    } catch (error) {
      return `Failed to request consensus: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Submits a vote on an active consensus proposal.
 */
export const voteOnProposal = {
  ...schema.voteOnProposal,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { proposalId, vote, reason } = args as {
      proposalId: string;
      vote: 'approve' | 'reject' | 'abstain';
      reason: string;
    };

    try {
      const { emitTypedEvent } = await import('../../lib/utils/typed-emit');
      const { EventType } = await import('../../lib/types/agent');

      await emitTypedEvent('tool.vote', EventType.CONSENSUS_VOTE, {
        proposalId,
        vote,
        reason,
        voterId: 'SYSTEM',
        timestamp: Date.now(),
      });

      return `VOTE_SUBMITTED: Recorded "${vote}" for proposal ${proposalId}. Reasoning: ${reason}`;
    } catch (error) {
      return `Failed to submit vote: ${formatErrorMessage(error)}`;
    }
  },
};
