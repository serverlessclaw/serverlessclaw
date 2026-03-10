import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { ReasoningProfile } from '../lib/types/index';

const memory = new DynamoMemory();
const provider = new ProviderManager();

export const handler = async (event: { userId: string; task: string }) => {
  console.log('Coder Agent received task:', JSON.stringify(event, null, 2));

  const { userId, task } = event;

  if (!userId || !task) {
    console.error('Invalid event payload');
    return;
  }

  // 1. Process the task
  // 2026 Optimization: Use 'thinking' profile for coding tasks
  const agentTools = await getAgentTools('coder');
  const agent = new Agent(
    memory,
    provider,
    agentTools,
    ` You are a specialized Coder Agent for the Serverless Claw stack.
    Your mission: Implement requested code/infra changes with 100% safety.

    DOCUMENTATION HUB: Always load 'INDEX.md' first to find the relevant spoke document before making changes.

    CRITICAL RULES:
    1. PRE-FLIGHT CHECK: After writing files, you MUST call 'validate_code' to ensure no lint/build errors.
    2. PERSISTENCE: After a successful 'validate_code', you MUST call 'stage_changes' with the list of files you modified. This ensures your work is saved to the persistent repository.
    3. PROTECTED FILES: If 'file_write' returns PERMISSION_DENIED, do NOT try to bypass it. Summarize your changes and explicitly state: "MANUAL_APPROVAL_REQUIRED: This change affects protected infrastructure."
    4. ATOMICITY: Do not leave the codebase in a broken state. Always check your work.
    5. DOCUMENTATION: If you change the architecture or add new tools, you MUST update the relevant spoke in 'docs/' (see INDEX.md) in the same step.`
  );
  const response = await agent.process(userId, `CODER TASK: ${task}`, ReasoningProfile.THINKING);

  console.log('Coder Agent completed task:', response);

  // 2. Future: Emit completion event back to the bus
  return response;
};
