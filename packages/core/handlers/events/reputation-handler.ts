import { logger } from '../../lib/logger';
import { DynamoMemory } from '../../lib/memory/dynamo-memory';
import { BaseMemoryProvider } from '../../lib/memory/base';
import { updateReputation } from '../../lib/memory/reputation-operations';
import { recordAgentMetric } from '../../lib/metrics/agent-metrics';
import { ReputationUpdatePayload } from '../../lib/types/reputation';

/**
 * Handles reputation update events.
 * Supports both trust score penalty/success events and raw execution result events.
 *
 * @param eventDetail - The event detail containing agent reputation change or execution result
 */
export async function handleReputationUpdate(eventDetail: Record<string, unknown>): Promise<void> {
  const payload = eventDetail as unknown as ReputationUpdatePayload & {
    trustScore?: number;
    metadata?: unknown;
  };
  const { agentId, success, durationMs, traceId, error, promptHash, workspaceId, teamId, staffId } =
    payload;

  if (agentId) {
    logger.info(
      `[REPUTATION] Processing update for ${agentId}: ` +
        (payload.trustScore !== undefined
          ? `TrustScore=${payload.trustScore}`
          : `Success=${success} | Latency=${durationMs}ms`)
    );

    // 1. Update rolling reputation stats if this is an execution result
    if (success !== undefined) {
      const memory: BaseMemoryProvider = new DynamoMemory();
      await updateReputation(memory, agentId, success, durationMs ?? 0, {
        error,
        traceId,
        promptHash,
        scope: { workspaceId, teamId, staffId },
      });

      // 2. Record temporal metric snapshot for charts
      await recordAgentMetric({
        agentId,
        success,
        durationMs: durationMs ?? 0,
        errorType: error,
        promptHash,
        workspaceId,
      });
    }
  }
}
