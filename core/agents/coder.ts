import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { ReasoningProfile } from '../lib/types/index';
import { logger } from '../lib/logger';

const memory = new DynamoMemory();
const provider = new ProviderManager();

export const handler = async (event: {
  userId: string;
  task: string;
  metadata?: { gapIds?: string[] };
}) => {
  logger.info('Coder Agent received task:', JSON.stringify(event, null, 2));

  const { userId, task, metadata } = event;

  if (!userId || !task) {
    logger.error('Invalid event payload');
    return;
  }

  // 1. Transition gaps to PROGRESS
  if (metadata?.gapIds && metadata.gapIds.length > 0) {
    logger.info(`Picking up task. Marking ${metadata.gapIds.length} gaps as PROGRESS.`);
    for (const gapId of metadata.gapIds) {
      await memory.updateGapStatus(gapId, 'PROGRESS');
    }
  }

  // 2. Process the task
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

  logger.info('Coder Agent completed task:', response);

  // 2. Mark gaps as DONE if successful or map them to a build
  const isSuccess =
    response.includes('Successfully staged') && !response.includes('MANUAL_APPROVAL_REQUIRED');

  if (isSuccess && metadata?.gapIds && metadata.gapIds.length > 0) {
    // Check if a deployment was triggered
    const buildMatch = response.match(/Build ID: ([a-zA-Z0-9:-]+)/);
    const buildId = buildMatch ? buildMatch[1] : null;

    if (buildId) {
      logger.info(`Deployment triggered (${buildId}). Mapping gaps to build for monitor.`);
      // Save the mapping so Build Monitor can transition them to DONE/FAILED
      await memory.addMessage(`BUILD_GAPS#${buildId}`, {
        role: 'system' as any,
        content: JSON.stringify(metadata.gapIds),
      });
    } else {
      logger.info(`Task successful without deployment. Marking ${metadata.gapIds.length} gaps as DONE.`);
      for (const gapId of metadata.gapIds) {
        await memory.updateGapStatus(gapId, 'DONE');
      }
    }
  }

  return response;
};
