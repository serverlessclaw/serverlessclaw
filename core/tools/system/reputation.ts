import { systemSchema as schema } from './schema';
import { DynamoMemory } from '../../lib/memory';
import { getReputation } from '../../lib/memory/reputation-operations';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Retrieves an agent's rolling 7-day performance reputation metrics.
 */
export const checkReputation = {
  ...schema.checkReputation,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { agentId } = args as { agentId: string };
    try {
      const memory = new DynamoMemory();
      const rep = await getReputation(memory, agentId);

      if (!rep) {
        return `No reputation data found for agent: ${agentId}`;
      }

      const score = (rep.score * 100).toFixed(1);
      const successRate = (rep.successRate * 100).toFixed(1);
      const avgLatency = rep.avgLatencyMs.toFixed(0);

      return (
        `Reputation Report for Agent: ${agentId}\n` +
        `-----------------------------------\n` +
        `- Composite Score: ${score}/100\n` +
        `- Success Rate:    ${successRate}%\n` +
        `- Tasks Completed: ${rep.tasksCompleted}\n` +
        `- Tasks Failed:    ${rep.tasksFailed}\n` +
        `- Avg Latency:     ${avgLatency}ms\n` +
        `- Last Active:     ${new Date(rep.lastActive).toISOString()}\n` +
        `- Window Start:    ${new Date(rep.windowStart).toISOString()}`
      );
    } catch (error) {
      return `Failed to retrieve reputation for ${agentId}: ${formatErrorMessage(error)}`;
    }
  },
};
