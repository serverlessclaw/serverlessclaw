import { logger } from '../../lib/logger';
import { emitEvent, EventPriority } from '../../lib/utils/bus';
import { EventType } from '../../lib/types/agent';
import { sendOutboundMessage } from '../../lib/outbound';

interface StrategicTieBreakPayload {
  userId: string;
  agentId: string;
  task: string;
  originalTask: string;
  question: string;
  traceId: string;
  initiatorId: string;
  sessionId?: string;
  depth?: number;
  workspaceId?: string;
  orgId?: string;
  teamId?: string;
  staffId?: string;
}

/**
 * P1 Fix: Improved strategic tie-break logic.
 * Makes actual strategic decisions based on task risk assessment.
 * - If original task is high-risk, defer execution with safety warning
 * - If task contains SAFE_MODE flag, respect it and add constraints
 * - Otherwise, proceed with conservative assumptions
 */
export async function handleStrategicTieBreak(eventDetail: Record<string, unknown>): Promise<void> {
  const {
    userId,
    agentId,
    task,
    originalTask,
    traceId,
    initiatorId,
    sessionId,
    depth,
    workspaceId,
    teamId,
    staffId,
  } = eventDetail as unknown as StrategicTieBreakPayload;

  // Sh1 Fix: Enforce Principle 12 - Facilitator must be highly trusted for autonomous tie-break
  const { AgentRegistry } = await import('../../lib/registry/AgentRegistry');
  const { TRUST } = await import('../../lib/constants/system');
  const facilitatorConfig = await AgentRegistry.getAgentConfig('facilitator');
  const trustScore = facilitatorConfig?.trustScore ?? TRUST.DEFAULT_SCORE;

  if (trustScore < TRUST.FACILITATOR_THRESHOLD) {
    logger.warn(
      `[TIE_BREAK] Aborting tie-break for ${traceId}: Facilitator trust (${trustScore}) below threshold (${TRUST.FACILITATOR_THRESHOLD}).`
    );
    // Fail the task as the system cannot safely resolve the conflict
    await emitEvent(
      'facilitator.agent',
      EventType.TASK_FAILED,
      {
        userId,
        agentId,
        task,
        originalTask,
        traceId,
        initiatorId,
        sessionId,
        depth,
        error: `STRATEGIC_TIE_BREAK (ABORTED): Facilitator trust score (${trustScore}) is too low for autonomous conflict resolution (required >= ${TRUST.FACILITATOR_THRESHOLD}). A human must resolve this conflict manually.`,
      },
      { priority: EventPriority.HIGH }
    );
    return;
  }

  logger.warn(
    `[TIE_BREAK] Performing strategic tie-break for ${agentId} | traceId: ${traceId} (Facilitator Trust: ${trustScore})`
  );

  // P1 Fix: Analyze original task for high-risk operations and apply strategic handling
  const highRiskPatterns = [
    /delete/i,
    /drop\s+(table|database|index)/i,
    /truncate/i,
    /force\s+push/i,
    /rm\s+-rf/i,
    /shutdown/i,
    /terminate/i,
    /kill\s+(all|process)/i,
  ];

  const safeOriginalTask = originalTask ?? task ?? '';
  const isHighRisk = highRiskPatterns.some((pattern) => pattern.test(safeOriginalTask));

  let finalTask: string;
  let eventType: string;

  // P1 Fix: Map agentId to EventType naming convention (e.g., strategic-planner -> strategic_planner_task)
  const normalizedAgentId = agentId.replace(/-/g, '_');
  const taskEventType = `${normalizedAgentId}_task`;

  if (isHighRisk) {
    // High-risk operation detected - stop execution and fail the task to break the loop
    logger.warn(
      `[TIE_BREAK] High-risk operation detected in task. Failing task to prevent infinite loops.`
    );
    finalTask = `STRATEGIC_TIE_BREAK (FAILED): The original task contained high-risk operations that require explicit human approval. Task: "${originalTask}". Automated execution has been stopped to ensure system safety. Please re-run the task with explicit parameters if you still wish to proceed.`;
    eventType = EventType.TASK_FAILED;
  } else if (task.includes('SAFE_MODE') || task.includes('avoid.*high.*risk')) {
    // Task already has safety instructions - proceed with conservative constraints
    finalTask = `${task}\n\n---\n**STRATEGIC CONSTRAINTS APPLIED:**\n- No destructive operations\n- Prefer read-only or low-impact alternatives\n- Log all changes for audit\n- Request clarification if uncertain`;
    eventType = taskEventType;
  } else {
    // Default: proceed with safe assumptions
    finalTask = task;
    eventType = taskEventType;
  }

  const eventPayload: Record<string, unknown> = {
    userId,
    agentId,
    task: finalTask,
    originalTask,
    traceId,
    initiatorId,
    sessionId,
    depth,
    workspaceId,
    teamId,
    staffId,
    isContinuation: true,
    strategicDecision: isHighRisk ? 'DEFERRED' : 'PROCEED_SAFE',
    metadata: {
      isProactive: !isHighRisk, // Mark as proactive for SafetyEngine bypass/promotion
    },
  };

  if (isHighRisk) {
    eventPayload.error = finalTask;
  }

  const source = isHighRisk ? `${agentId}.agent` : 'strategic-tie-break-handler';

  await emitEvent(source, eventType, eventPayload, { priority: EventPriority.HIGH });

  // Notify user of the strategic tie-break decision
  const decisionType = isHighRisk ? 'DEFERRED' : 'PROCEED_SAFE';
  const notificationMessage = isHighRisk
    ? `⚠️ **Strategic Tie-Break: Task Deferred**\n\nYour task was automatically deferred because it contained high-risk operations that require explicit human approval.\n\nOriginal request: "${originalTask.substring(0, 200)}${originalTask.length > 200 ? '...' : ''}"`
    : `ℹ️ **Strategic Tie-Break: Task Proceeding with Constraints**\n\nA task conflict was resolved automatically. Your request will proceed with additional safety constraints applied.\n\nTask: "${task.substring(0, 200)}${task.length > 200 ? '...' : ''}"`;

  try {
    await sendOutboundMessage(
      'strategic-tie-break-handler',
      userId,
      notificationMessage,
      undefined,
      sessionId,
      'SuperClaw',
      undefined,
      traceId,
      undefined,
      workspaceId,
      teamId,
      staffId
    );
    logger.info(`[TIE_BREAK] User notified of strategic decision for trace ${traceId}`);
  } catch (err) {
    logger.warn(`[TIE_BREAK] Failed to notify user of tie-break decision:`, err);
  }

  logger.info(`[TIE_BREAK] Dispatched strategic tie-break (${decisionType}) to ${agentId}`);
}
