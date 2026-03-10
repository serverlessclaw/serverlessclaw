import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers';
import { ReasoningProfile } from '../lib/types';
import { Resource } from 'sst';

const memory = new DynamoMemory();
const providerManager = new ProviderManager();

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
   
   Your plan will be reviewed by the user. Once approved, it will be executed by the Coder Agent.`
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
  const roiInfo = metadata
    ? `\n(ESTIMATED ROI: ${metadata.estimatedROI}, PRIORITY: ${metadata.priority})`
    : '';
  const result = await plannerAgent.process(
    `SYSTEM#PLANNER#${gapId}`,
    `GAP IDENTIFIED: ${details}${roiInfo}\n\nUSER CONTEXT: Please design a STRATEGIC_PLAN to fix this gap for user ${contextUserId}.`,
    ReasoningProfile.DEEP
  );

  console.log('Strategic Plan Generated:', result);

  // Send plan to Telegram
  await notifyUserOnTelegram(
    contextUserId,
    `🚀 **NEW STRATEGIC PLAN PROPOSED**\n\n${result}\n\nReply with 'APPROVE' to execute.`
  );

  return { gapId, plan: result };
};

async function notifyUserOnTelegram(chatId: string, text: string) {
  const token = Resource.TelegramBotToken.value;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
    }),
  });
}
