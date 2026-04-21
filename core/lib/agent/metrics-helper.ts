import { logger } from '../logger';
import { ContextualScope } from '../types/memory';

/**
 * Common metrics reporting for agent process and stream loops.
 */
export async function reportAgentMetrics(params: {
  agentId: string;
  traceId: string;
  activeProvider: string;
  activeModel: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  durationMs: number;
  success: boolean;
  paused: boolean;
  scope: ContextualScope;
}) {
  if (process.env.VITEST) return;

  const {
    agentId,
    traceId,
    activeProvider,
    activeModel,
    inputTokens,
    outputTokens,
    toolCalls,
    durationMs,
    success,
    paused,
    scope,
  } = params;

  try {
    const { emitMetrics, METRICS } = await import('../metrics');
    emitMetrics([
      METRICS.agentDuration(agentId, durationMs, scope),
      METRICS.agentInvoked(agentId, success, scope),
      METRICS.tokensInput(inputTokens, agentId, activeProvider, scope),
      METRICS.tokensOutput(outputTokens, agentId, activeProvider, scope),
    ]).catch(() => {});

    const { TokenTracker } = await import('../metrics/token-usage');
    TokenTracker.recordInvocation(
      {
        timestamp: Date.now(),
        traceId: traceId ?? '',
        agentId,
        provider: activeProvider ?? 'unknown',
        model: activeModel ?? 'unknown',
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        toolCalls,
        taskType: 'agent_process',
        success: !paused,
        durationMs,
      },
      scope
    ).catch(() => {});

    TokenTracker.updateRollup(
      agentId,
      {
        inputTokens,
        outputTokens,
        toolCalls,
        success: !paused,
        durationMs,
      },
      scope
    ).catch(() => {});
  } catch (e) {
    logger.warn('Failed to emit agent metrics or persist token usage', e);
  }
}
