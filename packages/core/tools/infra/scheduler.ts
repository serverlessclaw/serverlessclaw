import { infraSchema as schema } from './schema';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Proactively schedules a future task or heartbeat to achieve a goal.
 */
export const scheduleGoal = {
  ...schema.scheduleGoal,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { goalId, task, scheduleExpression, metadata } = args as {
      goalId: string;
      task: string;
      scheduleExpression: string;
      metadata: Record<string, unknown>;
    };

    try {
      const { DynamicScheduler } = await import('../../lib/lifecycle/scheduler');
      await DynamicScheduler.upsertSchedule(goalId, metadata, scheduleExpression, task);

      return `SUCCESS: Goal ${goalId} scheduled. ${scheduleExpression}`;
    } catch (error) {
      return `FAILED_TO_SCHEDULE: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Cancels a previously scheduled goal.
 */
export const cancelGoal = {
  ...schema.cancelGoal,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { goalId } = args as { goalId: string };
    try {
      const { DynamicScheduler } = await import('../../lib/lifecycle/scheduler');
      await DynamicScheduler.removeSchedule(goalId);
      return `SUCCESS: Goal ${goalId} cancelled.`;
    } catch (error) {
      return `FAILED_TO_CANCEL: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Lists all active proactive goals and scheduled heartbeats.
 */
export const listSchedules = {
  ...schema.listGoals,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { namePrefix } = args as { namePrefix: string };
    try {
      const { DynamicScheduler } = await import('../../lib/lifecycle/scheduler');
      const goals = (await DynamicScheduler.listSchedules(namePrefix)) as Record<string, unknown>[];

      if (goals.length === 0) return 'No active goals found.';

      return (
        `Found ${goals.length} active goals:\n` +
        goals
          .map((g) => `- [${g.Name}] Status: ${g.State}, Last Run: ${g.LastRunDate ?? 'Never'}`)
          .join('\n')
      );
    } catch (error) {
      return `FAILED_TO_LIST: ${formatErrorMessage(error)}`;
    }
  },
};
