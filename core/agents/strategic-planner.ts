import {
  AgentType,
  ReasoningProfile,
  EvolutionMode,
  GapStatus,
  TraceSource,
} from '../lib/types/index';
import type { SSTResource } from '../lib/types/system';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { extractPayload, loadAgentConfig, extractBaseUserId, getAgentContext, emitTaskEvent } from '../lib/utils/agent-helpers';

async function getEvolutionMode(): Promise<'auto' | 'hitl'> {
  try {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const { Resource } = await import('sst');
    
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const typedResource = Resource as any;

    const response = await db.send(
      new GetCommand({
        TableName: typedResource.ConfigTable.name,
        Key: { key: 'evolution_mode' },
      })
    );
    return response.Item?.value === 'auto' ? 'auto' : 'hitl';
  } catch (error) {
    logger.warn('Failed to fetch evolution_mode, defaulting to hitl:', error);
    return 'hitl';
  }
}

interface PlannerMetadata {
  impact: number;
  urgency: number;
  risk: number;
  priority: number;
  confidence: number;
}

interface PlannerPayload {
  gapId?: string;
  details?: string;
  contextUserId: string;
  metadata?: PlannerMetadata;
  isScheduledReview?: boolean;
  traceId?: string;
  initiatorId?: string;
  depth?: number;
  sessionId?: string;
}

interface PlannerEvent {
  detail?: PlannerPayload;
}

interface PlannerResult {
  gapId?: string;
  plan?: string;
  status?: string;
}

/**
 * Planner Agent handler. Analyzes capability gaps and generates strategic plans.
 *
 * @param event - The event containing gap details or scheduling information.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to an object with gapId and the plan, or a status object.
 */
export const handler = async (event: PlannerEvent, _context: Context): Promise<PlannerResult> => {
  logger.info('Planner Agent received task:', JSON.stringify(event, null, 2));

  // EventBridge wraps the payload in 'detail'
  const payload = extractPayload<PlannerPayload>(event);
  const {
    gapId,
    details,
    contextUserId,
    metadata,
    isScheduledReview,
    traceId,
    initiatorId,
    depth,
    sessionId,
  } = payload;

  // Extract base userId (remove CONV# prefix if present)
  const baseUserId = extractBaseUserId(contextUserId);

  // 1. Fetch System Context
  const config = await loadAgentConfig(AgentType.STRATEGIC_PLANNER);
  const { memory, provider: providerManager } = await getAgentContext();

  const { getAgentTools } = await import('../tools/index');
  const agentTools = await getAgentTools('planner');
  const { Agent } = await import('../lib/agent');
  const plannerAgent = new Agent(memory, providerManager, agentTools, config.systemPrompt, config);
  const toolsList = agentTools
    .map((t: { name: string; description: string }) => `- ${t.name}: ${t.description}`)
    .join('\n    ');
  const telemetry = `
    [SYSTEM_TELEMETRY]:
    - ACTIVE_AGENTS: ${Object.values(AgentType).join(', ')}
    - AVAILABLE_TOOLS:
    ${toolsList}
  `;

  let plannerPrompt: string;
  // const id = gapId || `REVIEW#${Date.now()}`;

  if (isScheduledReview) {
    // 1. Check Frequency and Min Gaps
    try {
      const { AgentRegistry } = await import('../lib/registry');
      const customFreq = await AgentRegistry.getRawConfig('strategic_review_frequency');
      const customMinGaps = await AgentRegistry.getRawConfig('min_gaps_for_review');

      const frequencyHrs = parseInt(String(customFreq || '48'), 10);
      const minGaps = parseInt(String(customMinGaps || '20'), 10);

      const lastReviewStr = await memory.getDistilledMemory(`LAST#STRATEGIC_REVIEW#${baseUserId}`);
      const lastReview = lastReviewStr ? parseInt(lastReviewStr, 10) : 0;
      const now = Date.now();

      const { TIME } = await import('../lib/constants');
      if (now - lastReview < frequencyHrs * TIME.SECONDS_IN_HOUR * TIME.MS_PER_SECOND) {
        logger.info(
          `Scheduled review skipped. Interval: ${frequencyHrs}h. Last run: ${new Date(lastReview).toISOString()}`
        );
        return { status: 'SKIPPED_INTERVAL' };
      }

      // Check min gaps
      const allGaps = await memory.getAllGaps(GapStatus.OPEN);
      if (allGaps.length < minGaps) {
        logger.info(`Scheduled review skipped. Need ${minGaps} gaps, found ${allGaps.length}.`);
        return { status: 'INSUFFICIENT_GAPS' };
      }

      // 1b. Archive stale gaps older than 30 days
      try {
        const archivedCount = await memory.archiveStaleGaps(30);
        if (archivedCount > 0) {
          logger.info(`Archived ${archivedCount} stale gaps during scheduled review.`);
        }
      } catch (error) {
        logger.warn('Failed to archive stale gaps:', error);
      }
    } catch {
      logger.warn('Failed to verify strategic review interval/min_gaps, proceeding anyway.');
    }

    // 2. Fetch Tool Usage Telemetry for Auditing
    let toolUsageContext = '';
    try {
      const { AgentRegistry } = await import('../lib/registry');
      const toolUsage = await AgentRegistry.getRawConfig('tool_usage');
      if (toolUsage) {
        toolUsageContext = `\n[TOOL_USAGE_TELEMETRY]:\n${JSON.stringify(toolUsage, null, 2)}\n`;
      }
    } catch (e) {
      logger.warn('Failed to fetch tool_usage for Strategic Review:', e);
    }

    // Deterministic Review of all Gaps
    const allGaps = await memory.getAllGaps(GapStatus.OPEN);
    if (allGaps.length === 0) {
      logger.info('No gaps found during scheduled review. Skipping evolution.');
      return { status: 'NO_GAPS' };
    }

    const gapSummary = allGaps
      .map(
        (g) => `- [Impact: ${g.metadata.impact}/10] ${g.content} (Priority: ${g.metadata.priority})`
      )
      .join('\n');

    plannerPrompt = `
      [SCHEDULED_STRATEGIC_REVIEW]
      I have detected the following ${allGaps.length} capability gaps:
      ${gapSummary}
      ${telemetry}
      ${toolUsageContext}

      Please analyze these gaps and the tool usage telemetry. Prioritize the most critical needs based on ROI (Impact vs Complexity), and design a STRATEGIC_PLAN to either address the MOST IMPORTANT evolution or prune redundant/inefficient tools.
    `;

    // Update last review timestamp
    await memory.updateDistilledMemory(
      `LAST#STRATEGIC_REVIEW#${baseUserId}`,
      Date.now().toString()
    );
  } else {
    // Reactionary single gap handling
    const signals = metadata
      ? `
      [EVOLUTIONARY_SIGNALS]:
      - IMPACT: ${metadata.impact}/10
      - URGENCY: ${metadata.urgency}/10
      - RISK: ${metadata.risk}/10
    `
      : '';

    plannerPrompt = `GAP IDENTIFIED: ${details}\n${signals}\n${telemetry}\n\nUSER CONTEXT: Please design a STRATEGIC_PLAN to fix this gap for user ${contextUserId}.`;
  }

  // 2. Self-Evolution Loop Protection (Cool-down)
  // Cooldown is tracked per gap ID in a structured JSON list stored in DDB.
  // Each entry carries an `expiresAt` epoch so old entries naturally become inactive.
  // This replaces the previous brittle 500-char rolling text buffer which:
  //   a) evicted entries as the buffer filled (same gap became "new" again)
  //   b) did text-prefix matching easily bypassed by rephrased descriptions
  //   c) was never checked for scheduled reviews (details === undefined)
  const COOLDOWN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  if (gapId) {
    const cooldownKey = `COOLDOWN_GAPS#${baseUserId}`;
    try {
      const raw = await memory.getDistilledMemory(cooldownKey);
      const entries: Array<{ gapId: string; expiresAt: number }> = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      const active = entries.filter((e) => e.expiresAt > now);
      if (active.some((e) => e.gapId === gapId)) {
        logger.warn(`Evolution cooldown active for gap ${gapId}. Aborting.`);
        return { status: 'COOLDOWN_ACTIVE' };
      }
    } catch {
      logger.warn('Failed to read cooldown state, proceeding anyway.');
    }
  }

  // 3. Process with High Reasoning
  const { responseText: rawResponse, attachments: resultAttachments } = await plannerAgent.process(
    contextUserId,
    plannerPrompt,
    {
      profile: ReasoningProfile.DEEP,
      isIsolated: true,
      initiatorId,
      depth,
      traceId,
      sessionId,
      source: TraceSource.SYSTEM,
    }
  );

  logger.info('Strategic Plan Raw Response:', rawResponse);

  let status = 'SUCCESS';
  let plan = rawResponse;
  let coveredGapIds: string[] = [];

  try {
    const jsonContent = rawResponse.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonContent);
    status = parsed.status || 'SUCCESS';
    plan = parsed.plan || rawResponse;
    coveredGapIds = parsed.coveredGapIds || [];
    logger.info(`Parsed Strategic Plan. Status: ${status}, Gaps: ${coveredGapIds.join(', ')}`);
  } catch (e) {
    logger.warn('Failed to parse Planner structured response, falling back to raw text.', e);
  }

  // 1. Notify user directly in the chat session
  await sendOutboundMessage(
    'planner.agent',
    contextUserId,
    `🚀 **Strategic Plan Generated**\n\n${plan}`,
    [contextUserId],
    sessionId,
    config.name,
    resultAttachments
  );

  const isFailure = status === 'FAILED' || plan.startsWith('I encountered an internal error');

  // 2. Emit Task Result for Universal Coordination
  if (!rawResponse.startsWith('TASK_PAUSED')) {
    await emitTaskEvent({
      source: 'planner.agent',
      userId: contextUserId,
      agentId: AgentType.STRATEGIC_PLANNER,
      task: isScheduledReview ? 'Scheduled Review' : details || 'Strategic Review',
      response: plan,
      error: isFailure ? plan : undefined,
      traceId,
      initiatorId: payload.initiatorId,
      depth: payload.depth,
      sessionId,
    });
  }

  // 4. Record gap in structured cooldown store
  if (gapId && !isFailure) {
    const cooldownKey = `COOLDOWN_GAPS#${baseUserId}`;
    try {
      const raw = await memory.getDistilledMemory(cooldownKey);
      const entries: Array<{ gapId: string; expiresAt: number }> = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      // Prune expired entries, then add the current gap
      const active = entries.filter((e) => e.expiresAt > now);
      active.push({ gapId, expiresAt: now + COOLDOWN_TTL_MS });
      await memory.updateDistilledMemory(cooldownKey, JSON.stringify(active));
    } catch (e) {
      logger.warn('Failed to record cooldown entry:', e);
    }
  }

  // 5. Gap Sink: Mark covered gaps as PLANNED
  const processedGapIds: string[] = [];
  if (!isFailure) {
    if (isScheduledReview) {
      logger.info(`Marking ${coveredGapIds.length} gaps as PLANNED based on structured output.`);
      for (const gId of coveredGapIds) {
        const numericId = gId.replace('GAP#', '');
        await memory.updateGapStatus(numericId, GapStatus.PLANNED);
        processedGapIds.push(numericId);
      }
    } else if (gapId) {
      logger.info(`Marking specific gap ${gapId} as PLANNED after design.`);
      await memory.updateGapStatus(gapId, GapStatus.PLANNED);
      processedGapIds.push(gapId);
    }
  }

  // 6. Save plan for QA auditing
  for (const gapIdToSave of processedGapIds) {
    await memory.updateDistilledMemory(`PLAN#${gapIdToSave}`, plan);
  }

  const evolutionMode = await getEvolutionMode();

  if (evolutionMode === EvolutionMode.AUTO && !isFailure) {
    logger.info('Evolution mode is auto, dispatching CODER_TASK directly.');
    await sendOutboundMessage(
      'planner.agent',
      contextUserId,
      `🚀 **Autonomous Evolution Triggered**\n\nI have identified a capability gap and designed a plan to fix it. The Coder Agent is now executing the following STRATEGIC_PLAN:\n\n${plan}`,
      [contextUserId],
      sessionId,
      config.name,
      undefined
    );

    const { tools } = await import('../tools/index');
    const dispatcher = tools.dispatchTask;
    await dispatcher.execute({
      agentId: AgentType.CODER,
      userId: contextUserId,
      task: plan,
      metadata: {
        gapIds: processedGapIds,
      },
      traceId,
      sessionId,
    });
  } else if (!isFailure) {
    logger.info('Evolution mode is hitl, asking for approval.');
    await sendOutboundMessage(
      'planner.agent',
      contextUserId,
      `🚀 **NEW STRATEGIC PLAN PROPOSED**\n\n${plan}\n\nReply with 'APPROVE' to execute.`,
      [contextUserId],
      sessionId,
      config.name,
      undefined
    );
  }

  return { gapId, plan: plan };
};
