import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { TIME } from '../lib/constants';
import {
  AgentType,
  ReasoningProfile,
  EvolutionMode,
  GapStatus,
  EventType,
  TraceSource,
  SSTResource,
} from '../lib/types/index';
import { getAgentTools } from '../tools/index';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const memory = new DynamoMemory();
const providerManager = new ProviderManager();
const typedResource = Resource as unknown as SSTResource;

export const PLANNER_SYSTEM_PROMPT = `
You are the Strategic Planner for Serverless Claw. Your role is to analyze capability gaps identified by the Reflector and design detailed architectural evolutions.

Key Obligations:
1. **ROI Analysis**: Prioritize gaps based on Impact, Urgency, and Risk. Focus on high-impact capability improvements.
2. **Design Excellence**: Create detailed 'STRATEGIC_PLAN' blocks. Your response must clearly explain THE WHY (reasoning) and THE HOW (technical implementation steps).
3. **System Awareness**: Use 'listAgents', 'listFiles', and 'recallKnowledge' to understand the current system topology and existing logic before proposing changes.
4. **Co-Management**: Clearly state if a plan requires human 'APPROVE' or if it will be executed autonomously based on the current 'evolution_mode'.
5. **Evolutionary Integrity**: Ensure your plans follow the project's 'ARCHITECTURE.md' guidelines and don't introduce redundant components.
6. **Self-Deduplication**: Before generating a new plan, use 'recallKnowledge' or 'listFiles' to ensure the requested capability doesn't already exist or isn't already being worked on. If you see a 'PROGRESS' gap that is similar, ABORT with a status message.
7. **Efficiency Auditing**: During scheduled reviews, analyze the provided 'TOOL_USAGE' telemetry. Design plans to prune redundant tools, de-register rarely used MCP servers, and simplify the architecture to maintain high operational ROI.
8. **Direct Communication**: Use 'sendMessage' to notify the human user immediately when you have generated a new plan or identified a critical gap.
`;

async function getEvolutionMode(): Promise<'auto' | 'hitl'> {
  try {
    const response = await db.send(
      new GetCommand({
        TableName: typedResource.ConfigTable.name,
        Key: { key: 'evolution_mode' },
      })
    );
    return response.Item?.value === 'auto' ? 'auto' : 'hitl';
  } catch {
    logger.warn('Failed to fetch evolution_mode, defaulting to hitl:');
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
  const payload = event.detail || (event as unknown as PlannerPayload);
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
  const baseUserId = contextUserId.startsWith('CONV#')
    ? contextUserId.split('#')[1]
    : contextUserId;

  // 1. Fetch System Context
  const { AgentRegistry } = await import('../lib/registry');
  const config = await AgentRegistry.getAgentConfig(AgentType.STRATEGIC_PLANNER);
  if (!config) {
    logger.error('Failed to load Strategic Planner configuration');
    throw new Error('Config load failed');
  }

  const agentTools = await getAgentTools('planner');
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
  // Logic: Check if we have tried to evolve a similar gap recently
  const evolutionHistory = await memory.getDistilledMemory(`EVOLUTION#HISTORY#${baseUserId}`);
  const isDuplicate = details && evolutionHistory?.includes(details.substring(0, 50));
  if (isDuplicate) {
    logger.warn('Evolution loop detected or cooldown active for this gap. Aborting.');
    return { status: 'COOLDOWN_ACTIVE' };
  }

  // 3. Process with High Reasoning
  const result = await plannerAgent.process(contextUserId, plannerPrompt, {
    profile: ReasoningProfile.DEEP,
    isIsolated: true,
    initiatorId,
    depth,
    traceId,
    sessionId,
    source: TraceSource.SYSTEM,
  });

  logger.info('Strategic Plan Generated:', result);

  // 1. Notify user directly in the chat session
  await sendOutboundMessage(
    'planner.agent',
    contextUserId,
    `🚀 **Strategic Plan Generated**\n\n${result}`,
    [contextUserId],
    sessionId,
    config.name
  );

  const isFailure = result.startsWith('I encountered an internal error');

  // 2. Emit Task Result for Universal Coordination
  if (!result.startsWith('TASK_PAUSED')) {
    try {
      const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
      const eb = new EventBridgeClient({});
      await eb.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'planner.agent',
              DetailType: isFailure ? EventType.TASK_FAILED : EventType.TASK_COMPLETED,
              Detail: JSON.stringify({
                userId: contextUserId,
                agentId: AgentType.STRATEGIC_PLANNER,
                task: isScheduledReview ? 'Scheduled Review' : details,
                [isFailure ? 'error' : 'response']: result,
                traceId,
                initiatorId: payload.initiatorId,
                depth: payload.depth,
                sessionId,
              }),
              EventBusName: typedResource.AgentBus.name,
            },
          ],
        })
      );
    } catch (e) {
      logger.error('Failed to emit result from Planner:', e);
    }
  }

  // 4. Record evolution attempt in history for cooldown logic
  if (details && !isFailure) {
    const updatedHistory = `${details.substring(0, 50)} | ${evolutionHistory || ''}`.substring(
      0,
      500
    );
    await memory.updateDistilledMemory(`EVOLUTION#HISTORY#${baseUserId}`, updatedHistory);
  }

  // 5. Gap Sink: Mark gaps as PLANNED after review to prevent re-planning
  const processedGapIds: string[] = [];
  if (isScheduledReview && result && !result.includes('internal error')) {
    const allGaps = await memory.getAllGaps(GapStatus.OPEN);
    logger.info(`Marking ${allGaps.length} gaps as PLANNED after successful strategic review.`);
    for (const gap of allGaps) {
      const numericId = gap.id.replace('GAP#', '');
      await memory.updateGapStatus(numericId, GapStatus.PLANNED);
      processedGapIds.push(numericId);
    }
  } else if (!isScheduledReview && gapId && result && !result.includes('internal error')) {
    logger.info(`Marking specific gap ${gapId} as PLANNED after design.`);
    await memory.updateGapStatus(gapId, GapStatus.PLANNED);
    processedGapIds.push(gapId);
  }

  // 6. Save plan for QA auditing
  for (const gapIdToSave of processedGapIds) {
    await memory.updateDistilledMemory(`PLAN#${gapIdToSave}`, result);
  }

  const evolutionMode = await getEvolutionMode();

  if (evolutionMode === EvolutionMode.AUTO) {
    logger.info('Evolution mode is auto, dispatching CODER_TASK directly.');
    await sendOutboundMessage(
      'planner.agent',
      contextUserId,
      `🚀 **Autonomous Evolution Triggered**\n\nI have identified a capability gap and designed a plan to fix it. The Coder Agent is now executing the following STRATEGIC_PLAN:\n\n${result}`,
      [contextUserId],
      sessionId,
      config.name
    );

    // 2026 Optimization: Use the dispatchTask tool logic via EventBridge directly
    const { tools } = await import('../tools/index');
    const dispatcher = tools.dispatchTask;
    await dispatcher.execute({
      agentId: AgentType.CODER,
      userId: contextUserId,
      task: result,
      metadata: {
        gapIds: processedGapIds,
      },
      traceId, // Propagate traceId
      sessionId,
    });
  } else {
    logger.info('Evolution mode is hitl, asking for approval.');
    // Send plan to user
    await sendOutboundMessage(
      'planner.agent',
      contextUserId,
      `🚀 **NEW STRATEGIC PLAN PROPOSED**\n\n${result}\n\nReply with 'APPROVE' to execute.`,
      [contextUserId],
      sessionId,
      config.name
    );
  }

  return { gapId, plan: result };
};
