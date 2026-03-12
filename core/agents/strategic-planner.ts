import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { AgentType, ReasoningProfile, EvolutionMode, GapStatus } from '../lib/types/index';
import { getAgentTools } from '../tools/index';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const memory = new DynamoMemory();
const providerManager = new ProviderManager();

export const PLANNER_SYSTEM_PROMPT = `
You are the Strategic Planner for Serverless Claw. Your role is to analyze capability gaps identified by the Reflector and design detailed architectural evolutions.

Key Obligations:
1. **ROI Analysis**: Prioritize gaps based on Impact, Urgency, and Risk. Focus on high-impact capability improvements.
2. **Design Excellence**: Create detailed 'STRATEGIC_PLAN' blocks. Your response must clearly explain THE WHY (reasoning) and THE HOW (technical implementation steps).
3. **System Awareness**: Use 'listAgents', 'listFiles', and 'recallKnowledge' to understand the current system topology and existing logic before proposing changes.
4. **Co-Management**: Clearly state if a plan requires human 'APPROVE' or if it will be executed autonomously based on the current 'evolution_mode'.
5. **Evolutionary Integrity**: Ensure your plans follow the project's 'ARCHITECTURE.md' guidelines and don't introduce redundant components.
`;

async function getEvolutionMode(): Promise<'auto' | 'hitl'> {
  try {
    const response = await db.send(
      new GetCommand({
        TableName: (Resource as unknown as { ConfigTable: { name: string } }).ConfigTable.name,
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

interface PlannerResult {
  gapId?: string;
  plan?: string;
  status?: string;
}

/**
 * Planner Agent handler. Analyzes capability gaps and generates strategic plans.
 *
 * @param event - The event containing gap details or scheduling information.
 * @returns A promise that resolves to an object with gapId and the plan, or a status object.
 */
export const handler = async (event: {
  gapId?: string;
  details?: string;
  contextUserId: string;
  metadata?: PlannerMetadata;
  isScheduledReview?: boolean;
}): Promise<PlannerResult> => {
  logger.info('Planner Agent received task:', JSON.stringify(event, null, 2));

  const { gapId, details, contextUserId, metadata, isScheduledReview } = event;

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

      const frequencyHrs = parseInt(String(customFreq || '12'), 10);
      const minGaps = parseInt(String(customMinGaps || '3'), 10);

      const lastReviewStr = await memory.getDistilledMemory(`LAST#STRATEGIC_REVIEW#${contextUserId}`);
      const lastReview = lastReviewStr ? parseInt(lastReviewStr, 10) : 0;
      const now = Date.now();

      if (now - lastReview < frequencyHrs * 60 * 60 * 1000) {
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
    } catch {
      logger.warn('Failed to verify strategic review interval/min_gaps, proceeding anyway.');
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

      Please analyze these gaps, prioritize them based on ROI (Impact vs Complexity), and design a STRATEGIC_PLAN for the MOST IMPORTANT evolution.
    `;

    // Update last review timestamp
    await memory.updateDistilledMemory(`LAST#STRATEGIC_REVIEW#${contextUserId}`, Date.now().toString());
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
  const evolutionHistory = await memory.getDistilledMemory(`EVOLUTION#HISTORY#${contextUserId}`);
  const isDuplicate = details && evolutionHistory?.includes(details.substring(0, 50));
  if (isDuplicate) {
    logger.warn('Evolution loop detected or cooldown active for this gap. Aborting.');
    return { status: 'COOLDOWN_ACTIVE' };
  }

  // 3. Process with High Reasoning
  // 3. Process with High Reasoning
  const result = await plannerAgent.process(contextUserId, plannerPrompt, {
    profile: ReasoningProfile.DEEP,
    isIsolated: true,
  });

  logger.info('Strategic Plan Generated:', result);

  // 4. Record evolution attempt in history for cooldown logic
  if (details) {
    const updatedHistory = `${details.substring(0, 50)} | ${evolutionHistory || ''}`.substring(
      0,
      500
    );
    await memory.updateDistilledMemory(`EVOLUTION#HISTORY#${contextUserId}`, updatedHistory);
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
      [contextUserId]
    );

    // 2026 Optimization: Use the dispatchTask tool logic via EventBridge directly
    // but keep it compatible with the AgentBus pattern.
    const { tools } = await import('../tools/index');
    const dispatcher = tools.dispatchTask;
    await dispatcher.execute({
      agentId: AgentType.CODER,
      userId: contextUserId,
      task: result,
      metadata: {
        gapIds: processedGapIds,
      },
    });
  } else {
    logger.info('Evolution mode is hitl, asking for approval.');
    // Send plan to user
    await sendOutboundMessage(
      'planner.agent',
      contextUserId,
      `🚀 **NEW STRATEGIC PLAN PROPOSED**\n\n${result}\n\nReply with 'APPROVE' to execute.`,
      [contextUserId]
    );
  }

  return { gapId, plan: result };
};
