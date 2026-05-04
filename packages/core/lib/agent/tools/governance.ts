import { DYNAMO_KEYS } from '../../constants';
import { ConfigManager } from '../../registry/config';
import { logger } from '../../logger';
import { emitTypedEvent } from '../../utils/typed-emit';
import { EventType } from '../../types/agent';

interface GovernanceState {
  activeProposals?: Record<
    string,
    {
      agentId: string;
      targetMode: 'AUTO' | 'HITL';
      reason: string;
      trustScore?: number;
      createdAt: number;
      status: 'pending' | 'approved' | 'rejected';
    }
  >;
}

/**
 * Proposes an update to the agent's autonomy mode (EvolutionMode).
 * This is used by SuperClaw to "negotiate" trust with the user.
 */
export async function proposeAutonomyUpdate(args: {
  agentId: string;
  targetMode: 'AUTO' | 'HITL';
  reason: string;
  trustScore?: number;
}): Promise<string> {
  const { agentId, targetMode, reason, trustScore } = args;

  logger.info(
    `[GOVERNANCE] Agent ${agentId} is proposing a mode shift to ${targetMode}. Reason: ${reason}`
  );

  // 1. Record the proposal in governance_state
  const currentState =
    ((await ConfigManager.getRawConfig(DYNAMO_KEYS.GOVERNANCE_STATE)) as GovernanceState) || {};
  const proposalId = `prop_${Date.now()}`;

  const updatedState: GovernanceState = {
    ...currentState,
    activeProposals: {
      ...(currentState.activeProposals || {}),
      [proposalId]: {
        agentId,
        targetMode,
        reason,
        trustScore,
        createdAt: Date.now(),
        status: 'pending',
      },
    },
  };

  await ConfigManager.saveRawConfig(DYNAMO_KEYS.GOVERNANCE_STATE, updatedState, {
    author: agentId,
    description: `Autonomy proposal: ${targetMode} for ${agentId}`,
  });

  // 2. Emit an event to notify the Dashboard/Planner
  await emitTypedEvent('governance.propose', EventType.STRATEGIC_TIE_BREAK, {
    userId: 'SYSTEM',
    agentId: 'superclaw',
    task: `Governance Proposal: ${agentId} requests transition to ${targetMode}`,
    metadata: {
      proposalId,
      agentId,
      targetMode,
      reason,
      trustScore,
    },
  });

  return `SUCCESS: Proposal ${proposalId} submitted for ${targetMode} mode. Status: PENDING_USER_REVIEW.`;
}
