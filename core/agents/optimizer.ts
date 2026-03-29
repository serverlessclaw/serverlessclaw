import { ReasoningProfile } from '../lib/types/llm';
import { AgentType, TraceSource } from '../lib/types/agent';
import { InsightCategory } from '../lib/types/memory';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { extractPayload, initAgent } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { TokenTracker } from '../lib/token-usage';

interface OptimizationReport {
  status: string;
  optimizations: Array<{
    type: 'MODEL_SWAP' | 'TOOL_PRUNE' | 'RESOURCE_ADJUST';
    agentId?: string;
    toolName?: string;
    suggestedModel?: string;
    reason: string;
  }>;
  antiPatterns: string[];
}

/**
 * Optimizer Agent handler. Audits swarm efficiency and tool usage.
 *
 * @param event - The event containing audit instructions or a periodic trigger.
 * @param _context - The AWS Lambda context.
 */
export const handler = async (
  event: { detail?: any } | any,
  _context: Context
): Promise<string | undefined> => {
  logger.info('[OPTIMIZER] Received task:', JSON.stringify(event, null, 2));

  const payload = extractPayload(event);
  const { userId = 'SYSTEM#GLOBAL', traceId, sessionId, task, initiatorId, depth } = payload;

  // 1. Initialize Agent Context (Memory + Provider + Instance)
  const { memory, agent: optimizer } = await initAgent(AgentType.OPTIMIZER);

  // 2. Data Gathering for Audit
  logger.info('[OPTIMIZER] Gathering telemetry and memory for audit...');

  // 2.1 Get Tool Telemetry (last 7 days)
  const allConfigs = await (await import('../lib/registry')).AgentRegistry.getAllConfigs();
  const agentIds = Object.keys(allConfigs);

  const telemetry: Record<string, unknown> = {};
  for (const id of agentIds) {
    const rollups = await TokenTracker.getRollupRange(id, 7);
    if (rollups.length > 0) {
      telemetry[id] = rollups;
    }
  }

  // 2.2 Get Negative Memory (Failed Plans)
  const failedPlans = await memory.getFailedPlans(10);

  // 2.3 Get Failure Patterns
  const failurePatterns = await memory.getFailurePatterns('SYSTEM#GLOBAL', '*', 10);

  // 3. Build Prompt
  const auditPrompt = `
AUDIT TASK: ${task || 'Periodic Efficiency Review'}

TELEMETRY (Last 7 Days per Agent):
${JSON.stringify(telemetry, null, 2)}

FAILED PLANS (Negative Memory):
${JSON.stringify(failedPlans, null, 2)}

FAILURE PATTERNS:
${JSON.stringify(failurePatterns, null, 2)}

Based on this data, perform an efficiency audit. Identify agents using expensive models for simple tasks, redundant tools, or structured recursive failures (anti-patterns).
`;

  // 4. Execute Audit
  const { responseText: response } = await optimizer.process(userId, auditPrompt, {
    profile: ReasoningProfile.STANDARD,
    isIsolated: true,
    traceId,
    sessionId,
    source: TraceSource.SYSTEM,
    communicationMode: 'json',
  });

  // 5. Process Results & Emit Improvements
  if (response && !response.includes('FAILED')) {
    try {
      const report = parseStructuredResponse<OptimizationReport>(response);

      if (report.optimizations && report.optimizations.length > 0) {
        for (const opt of report.optimizations) {
          const improvementGapId = `OPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const gapContent = `[SYSTEM_IMPROVEMENT] Type: ${opt.type}. Agent: ${opt.agentId || 'N/A'}. Details: ${opt.reason}`;

          await memory.setGap(improvementGapId, gapContent, {
            category: InsightCategory.SYSTEM_IMPROVEMENT,
            confidence: 9,
            impact: 7,
            complexity: 3,
            risk: 2,
            urgency: 5,
            priority: 6,
          });

          logger.info(`[OPTIMIZER] Recorded system improvement gap: ${improvementGapId}`);
        }
      }

      if (report.antiPatterns && report.antiPatterns.length > 0) {
        for (const pattern of report.antiPatterns) {
          await memory.recordFailurePattern('SYSTEM#GLOBAL', `[ANTI-PATTERN] ${pattern}`, {
            category: InsightCategory.FAILURE_PATTERN,
            impact: 8,
            confidence: 10,
          });
        }
      }
    } catch (e) {
      logger.error('[OPTIMIZER] Failed to parse audit report:', e);
    }
  }

  // 6. Coordinate Result
  await emitTaskEvent({
    source: AgentType.OPTIMIZER,
    agentId: AgentType.OPTIMIZER,
    userId,
    task: task || 'Efficiency Audit',
    response: response || 'Audit complete. No critical optimizations identified.',
    traceId,
    sessionId,
    initiatorId,
    depth,
  });

  return response;
};
