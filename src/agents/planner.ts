import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers';
import { AgentType, ReasoningProfile, EventType } from '../lib/types';
import { getToolDefinitions } from '../tools/index';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventbridge = new EventBridgeClient({});
const memory = new DynamoMemory();
const providerManager = new ProviderManager();

async function getEvolutionMode(): Promise<'auto' | 'hitl'> {
  try {
    const response = await db.send(
      new GetCommand({
        TableName: (Resource as any).ConfigTable.name,
        Key: { key: 'evolution_mode' },
      })
    );
    return response.Item?.value === 'auto' ? 'auto' : 'hitl';
  } catch (e) {
    console.warn('Failed to fetch evolution_mode, defaulting to hitl:', e);
    return 'hitl';
  }
}

const plannerAgent = new Agent(
  memory,
  providerManager,
  [], // Planner doesn't need external tools, it just designs plans
  `You are the specialized Strategic Planner for the Serverless Claw stack.
   
   Your mission: Transform 'Capability Gaps' into formal, safer, and highly effective STRATEGIC_PLAN documents.
   
   PLANNING PROTOCOL:
   1. CONTEXT: Analyze the identified gap and the previous conversation context.
   2. DESIGN: Outline exactly what needs to be changed (new tools, modified logic, infrastructure updates).
   3. SAFETY: Identify any [PROTECTED] files or high-risk infrastructure changes that will require manual approval.
   4. OUTPUT: Return a markdown-formatted STRATEGIC_PLAN.
   
   Your plan will be reviewed by the user. Once approved, it will be executed by the Coder Agent.
   
   CRUCIAL: Review the provided [SYSTEM_TELEMETRY] block before proposing a plan. DO NOT propose building a new tool if a similar tool already exists in the AVAILABLE_TOOLS registry. DO NOT propose a new agent if an existing ACTIVE_AGENT can handle the task.`
);

export const handler = async (event: {
  gapId: string;
  details: string;
  contextUserId: string;
  metadata?: any;
}) => {
  console.log('Planner Agent received gap:', JSON.stringify(event, null, 2));

  const { gapId, details, contextUserId, metadata } = event;

  // Planner always uses high-reasoning for deep thinking
  const signals = metadata
    ? `
    [EVOLUTIONARY_SIGNALS]:
    - IMPACT: ${metadata.impact}/10
    - URGENCY: ${metadata.urgency}/10
    - RISK: ${metadata.risk}/10
    - PRIORITY: ${metadata.priority}/10 (Confidence: ${metadata.confidence}/10)
  `
    : '';

  const toolsList = getToolDefinitions()
    .map((t) => `- ${t.function.name}: ${t.function.description}`)
    .join('\n    ');
  const telemetry = `
    [SYSTEM_TELEMETRY]:
    - ACTIVE_AGENTS: ${Object.values(AgentType).join(', ')}
    - AVAILABLE_TOOLS:
    ${toolsList}
  `;

  const result = await plannerAgent.process(
    `SYSTEM#PLANNER#${gapId}`,
    `GAP IDENTIFIED: ${details}\n${signals}\n${telemetry}\n\nUSER CONTEXT: Please design a STRATEGIC_PLAN to fix this gap for user ${contextUserId}.`,
    ReasoningProfile.DEEP
  );

  console.log('Strategic Plan Generated:', result);

  const evolutionMode = await getEvolutionMode();

  if (evolutionMode === 'auto') {
    console.log('Evolution mode is auto, dispatching CODER_TASK directly.');
    await sendOutboundMessage(
      contextUserId,
      `🚀 **Autonomous Evolution Triggered**\n\nI have identified a capability gap and designed a plan to fix it. The Coder Agent is now executing the following STRATEGIC_PLAN:\n\n${result}`
    );

    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'planner.agent',
            DetailType: EventType.CODER_TASK,
            Detail: JSON.stringify({
              userId: contextUserId,
              task: result,
            }),
            EventBusName: (Resource as any).AgentBus.name,
          },
        ],
      })
    );
  } else {
    console.log('Evolution mode is hitl, asking for approval.');
    // Send plan to user
    await sendOutboundMessage(
      contextUserId,
      `🚀 **NEW STRATEGIC PLAN PROPOSED**\n\n${result}\n\nReply with 'APPROVE' to execute.`
    );
  }

  return { gapId, plan: result };
};

async function sendOutboundMessage(userId: string, message: string) {
  await eventbridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'planner.agent',
          DetailType: EventType.OUTBOUND_MESSAGE,
          Detail: JSON.stringify({ userId, message }),
          EventBusName: (Resource as any).AgentBus.name,
        },
      ],
    })
  );
}
