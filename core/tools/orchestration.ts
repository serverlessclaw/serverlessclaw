import { orchestrationTools } from './definitions/orchestration';
import { logger } from '../lib/logger';
import { AgentStatus, AgentType } from '../lib/types/agent';

/**
 * Executes a high-level orchestration signal to decide the next step in a task lifecycle.
 * This tool is primarily used by Initiator agents (SuperClaw, Planner) to maintain
 * goal-directed behavior when sub-agents complete or fail tasks.
 */
export const SIGNAL_ORCHESTRATION = {
  ...orchestrationTools.signalOrchestration,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { status, reasoning, nextStep, targetAgentId } = args as {
      status: AgentStatus;
      reasoning: string;
      nextStep?: string;
      targetAgentId?: AgentType;
    };

    logger.info(`[ORCHESTRATION] Emitting Signal: ${status} | Target: ${targetAgentId ?? 'N/A'}`);
    logger.info(`[ORCHESTRATION] Reasoning: ${reasoning}`);

    // This tool is primarily a structured signal for the agent's reasoning.
    // The EventHandler (task-result-handler) typically catches completion results,
    // but when an Initiator calls this tool, it's an explicit "task closure" or "pivot."

    let report = `ORCHESTRATION_SIGNAL_EMITTED: ${status}.\n\nReasoning: ${reasoning}`;
    if (nextStep) report += `\n\nNext Step: ${nextStep}`;
    if (targetAgentId) report += `\nTarget Agent: ${targetAgentId}`;

    return report;
  },
};
