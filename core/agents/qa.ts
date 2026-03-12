import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import {
  ReasoningProfile,
  EventType,
  GapStatus,
  AgentType,
  EvolutionMode,
  SSTResource,
  TraceSource,
} from '../lib/types/index';
import { sendOutboundMessage } from '../lib/outbound';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import { AgentRegistry } from '../lib/registry';
import { Context } from 'aws-lambda';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const typedResource = Resource as unknown as SSTResource;

export const QA_SYSTEM_PROMPT = `
You are the QA Auditor for Serverless Claw. Your role is to verify that recent code changes actually resolve the identified capability gaps.

Key Obligations:
1. **Validation**: Use your tools to check the codebase or system state.
2. **Success Criteria**: If the gap is resolved, respond with "VERIFICATION_SUCCESSFUL".
3. **Failure Criteria**: If the implementation is missing, buggy, or incomplete, respond with "REOPEN_REQUIRED" and explain why.
4. **Safety**: Do not approve changes that introduce obvious security risks or architectural regressions.
5. **Direct Communication**: Use 'sendMessage' to notify the human user immediately of your audit results (Success or Reopen).
`;

interface QAPayload {
  userId: string;
  gapIds: string[];
  response: string;
  traceId?: string;
  initiatorId?: string;
  depth?: number;
}

interface QAEvent {
  detail?: QAPayload;
  source?: string;
}

/**
 * QA Agent handler. Triggered after a build success or coder task completion.
 *
 * @param event - The EventBridge event containing task and implementation details.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves when the audit is complete.
 */
export const handler = async (event: QAEvent, _context: Context): Promise<void> => {
  logger.info('QA Agent received verification task:', JSON.stringify(event, null, 2));

  const payload = event.detail || (event as unknown as QAPayload);
  const { userId, gapIds, response: implementationResponse, traceId } = payload;

  if (!userId || !gapIds || !Array.isArray(gapIds) || gapIds.length === 0) {
    logger.warn('QA Auditor received incomplete payload, skipping verification.');
    return;
  }

  // 1. Discovery
  const config = await AgentRegistry.getAgentConfig(AgentType.QA);
  if (!config) {
    logger.error('Failed to load QA configuration');
    return;
  }

  const agentTools = await getAgentTools('qa');
  const qaAgent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  const auditPrompt = `Please verify if the implementation for these gaps is satisfactory. 
    Review the codebase if needed via tools.
    
    Implementation Response from Coder:
    ${implementationResponse}

    Target Gaps:
    ${gapIds.join(', ')}

    Final response MUST include VERIFICATION_SUCCESSFUL or REOPEN_REQUIRED.`;

  const auditReport = await qaAgent.process(userId, auditPrompt, {
    profile: ReasoningProfile.THINKING,
    isIsolated: true,
    source: TraceSource.SYSTEM,
    initiatorId: payload.initiatorId,
    depth: payload.depth,
    traceId,
  });

  logger.info('QA Audit Report:', auditReport);

  const isSatisfied = auditReport.includes('VERIFICATION_SUCCESSFUL');

  // Resolve evolution mode
  let evolutionMode = EvolutionMode.HITL;
  try {
    const mode = await AgentRegistry.getRawConfig('evolution_mode');
    if (mode === 'auto') evolutionMode = EvolutionMode.AUTO;
  } catch {
    logger.warn('Failed to fetch evolution_mode, defaulting to HITL.');
  }

  if (isSatisfied) {
    if (evolutionMode === EvolutionMode.AUTO) {
      logger.info('Verification successful. Auto-closing gaps.');
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DONE);
      }
    } else {
      logger.info('Verification successful. Awaiting human confirmation (HITL).');
      // In HITL mode, we stay in DEPLOYED until human marks as DONE via ManageGap tool
    }
  } else {
    logger.warn('Verification failed. Reopening gaps.');
    for (const gapId of gapIds) {
      await memory.updateGapStatus(gapId, GapStatus.OPEN);
    }
  }

  // 1. Notify user directly in the chat session
  await sendOutboundMessage(
    'qa.agent',
    userId,
    `🔍 **QA Audit Complete**\n\n${auditReport}`,
    [userId],
    traceId,
    config.name
  );

  // Universal Coordination: Notify Initiator (if any)
  try {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eb = new EventBridgeClient({});
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'qa.agent',
            DetailType: EventType.TASK_COMPLETED,
            Detail: JSON.stringify({
              userId,
              agentId: AgentType.QA,
              task: `Audit gaps: ${gapIds.join(', ')}`,
              response: auditReport,
              traceId,
              initiatorId: payload.initiatorId,
              depth: payload.depth,
            }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      })
    );
  } catch (e) {
    logger.error('Failed to emit TASK_COMPLETED from QA Auditor:', e);
  }
};
