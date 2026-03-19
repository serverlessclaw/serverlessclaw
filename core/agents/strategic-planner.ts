import {
  AgentType,
  ReasoningProfile,
  EvolutionMode,
  GapStatus,
  TraceSource,
} from '../lib/types/index';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  loadAgentConfig,
  extractBaseUserId,
  getAgentContext,
  isTaskPaused,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { parseConfigInt } from '../lib/providers/utils';
import { MEMORY_KEYS } from '../lib/constants';

async function getEvolutionMode(): Promise<'auto' | 'hitl'> {
  try {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const { Resource } = await import('sst');

    const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const typedResource = Resource as unknown as { ConfigTable: { name: string } };

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
 * @param _context - The AWS Lambda context (unused).
 * @returns A promise that resolves to an object with gapId and the plan, or a status object.
 */
export async function handler(event: PlannerEvent, _context: Context): Promise<PlannerResult> {
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

  const isProactive =
    (metadata as unknown as Record<string, unknown>)?.isProactive || isScheduledReview;

  // Extract base userId (remove CONV# prefix if present)
  const baseUserId = extractBaseUserId(contextUserId);

  // 1. Fetch System Context
  const config = await loadAgentConfig(AgentType.STRATEGIC_PLANNER);
  const { memory, provider: providerManager } = await getAgentContext();

  const { getAgentTools } = await import('../tools/index');
  const agentTools = await getAgentTools('planner');

  // Self-Scheduling: If this is a proactive review, or we are running for any reason,
  // ensure the NEXT proactive review is scheduled if not already present.
  if (isProactive) {
    try {
      const { DynamicScheduler } = await import('../lib/scheduler');
      const { AgentRegistry } = await import('../lib/registry');

      const GOAL_ID = `PLANNER#STRATEGIC_REVIEW#${baseUserId}`;
      const customFreq = await AgentRegistry.getRawConfig('strategic_review_frequency');
      const frequencyHrs = parseConfigInt(customFreq, 24);

      await DynamicScheduler.ensureProactiveGoal({
        goalId: GOAL_ID,
        agentId: AgentType.STRATEGIC_PLANNER,
        task: 'Proactive Strategic Review',
        userId: contextUserId,
        frequencyHrs,
        metadata: { isProactive: true },
      });
    } catch (e) {
      logger.warn('Failed to manage proactive self-scheduling:', e);
    }
  }

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

  if (isProactive) {
    // 1. Check Frequency and Min Gaps
    try {
      const { AgentRegistry } = await import('../lib/registry');
      const customFreq = await AgentRegistry.getRawConfig('strategic_review_frequency');
      const customMinGaps = await AgentRegistry.getRawConfig('min_gaps_for_review');

      const frequencyHrs = parseConfigInt(customFreq, 48);
      const minGaps = parseConfigInt(customMinGaps, 5); // Proactive lower threshold for progress

      const lastReviewStr = await memory.getDistilledMemory(
        `${MEMORY_KEYS.STRATEGIC_REVIEW}#${baseUserId}`
      );
      const lastReview = parseConfigInt(lastReviewStr, 0);
      const now = Date.now();

      const { TIME } = await import('../lib/constants');
      // Only enforce strict interval for fully automated crons, proactive can be more flexible
      if (
        !isScheduledReview &&
        now - lastReview < (frequencyHrs / 2) * TIME.SECONDS_IN_HOUR * TIME.MS_PER_SECOND
      ) {
        logger.info(
          `Proactive review skipped: too recent. Last run: ${new Date(lastReview).toISOString()}`
        );
        return { status: 'SKIPPED_TOO_RECENT' };
      }

      // Check min gaps
      const allGaps = await memory.getAllGaps(GapStatus.OPEN);
      if (allGaps.length < minGaps) {
        logger.info(`Proactive review skipped. Need ${minGaps} gaps, found ${allGaps.length}.`);
        return { status: 'INSUFFICIENT_GAPS' };
      }

      // 1b. Archive stale gaps older than 30 days
      try {
        const archivedCount = await memory.archiveStaleGaps(30);
        if (archivedCount > 0) {
          logger.info(`Archived ${archivedCount} stale gaps during proactive review.`);
        }
      } catch (error) {
        logger.warn('Failed to archive stale gaps:', error);
      }
    } catch {
      logger.warn('Failed to verify proactive review interval/min_gaps, proceeding anyway.');
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

    let staleMemoryContext = '';
    try {
      const staleItems = await memory.getLowUtilizationMemory(10);
      if (staleItems && staleItems.length > 0) {
        staleMemoryContext = `\n[LOW_UTILIZATION_MEMORY]:\nThese dynamic memory items have not been recalled recently. Consider recommending pruning them if they are no longer relevant to system goals.\n${JSON.stringify(
          staleItems.map((i: Record<string, unknown>) => ({
            id: i.userId,
            timestamp: i.timestamp,
            content: i.content,
            hitCount: (i.metadata as Record<string, unknown>)?.hitCount,
            lastAccessed: (i.metadata as Record<string, unknown>)?.lastAccessed,
          })),
          null,
          2
        )}\n`;
      }
    } catch (e) {
      logger.warn('Failed to fetch stale memory for Strategic Review:', e);
    }

    // Deterministic Review of all Gaps
    const allGaps = await memory.getAllGaps(GapStatus.OPEN);
    if (allGaps.length === 0) {
      logger.info('No gaps found during proactive review. Skipping evolution.');
      return { status: 'NO_GAPS' };
    }

    const gapSummary = allGaps
      .map(
        (g) => `- [Impact: ${g.metadata.impact}/10] ${g.content} (Priority: ${g.metadata.priority})`
      )
      .join('\n');

    plannerPrompt = `
      [PROACTIVE_STRATEGIC_REVIEW]
      I have woken up for a scheduled self-audit. I have detected the following ${allGaps.length} capability gaps:
      ${gapSummary}
      ${telemetry}
      ${toolUsageContext}
      ${staleMemoryContext}

      Please analyze these gaps, the tool usage telemetry, and the memory utilization audit. Prioritize the most critical needs based on ROI (Impact vs Complexity), and design a STRATEGIC_PLAN to either address the MOST IMPORTANT evolution or prune redundant/inefficient tools and stale memories.
      
      If low-utilization memory is no longer relevant, recommend pruning it by suggesting the use of 'pruneMemory' tool or explaining why it should be archived.
    `;

    // Update last review timestamp
    await memory.updateDistilledMemory(
      `${MEMORY_KEYS.STRATEGIC_REVIEW}#${baseUserId}`,
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
      communicationMode: 'json',
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'strategic_plan',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['SUCCESS', 'FAILED'] },
              plan: { type: 'string' },
              coveredGapIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['status', 'plan', 'coveredGapIds'],
            additionalProperties: false,
          },
        },
      },
    }
  );

  logger.info('Strategic Plan Raw Response:', rawResponse);

  let status = 'SUCCESS';
  let plan = rawResponse;
  let coveredGapIds: string[] = [];

  try {
    const parsed = parseStructuredResponse<{
      status: string;
      plan: string;
      coveredGapIds: string[];
    }>(rawResponse);
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
  if (!isTaskPaused(rawResponse)) {
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

    const { TOOLS } = await import('../tools/index');
    const dispatcher = TOOLS.dispatchTask;
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
}
