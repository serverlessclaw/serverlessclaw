import { ITool } from '../lib/types/index';
import { DynamicScheduler } from '../lib/scheduler';
import { formatErrorMessage } from '../lib/utils/error';

/**
 * scheduleGoal
 * Allows an agent to proactively schedule a future task for itself or the system.
 */
export const scheduleGoal: ITool = {
  name: 'scheduleGoal',
  description:
    'Proactively schedules a future task or recurring "wake-up" heartbeat to achieve a goal.',
  parameters: {
    type: 'object',
    properties: {
      goalId: {
        type: 'string',
        description: 'Unique identifier for this goal/schedule (e.g., "audit-s3-permissions").',
      },
      task: {
        type: 'string',
        description: 'Description of the task to be performed when triggered.',
      },
      agentId: {
        type: 'string',
        description: 'The ID of the agent responsible for this goal (e.g., "planner", "coder").',
      },
      scheduleExpression: {
        type: 'string',
        description:
          'AWS Scheduler expression. Support: at(YYYY-MM-DDThh:mm:ss), rate(value unit), cron(fields). Example: "rate(1 hour)".',
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata to be delivered with the heartbeat.',
      },
    },
    required: ['goalId', 'task', 'scheduleExpression', 'agentId'],
  },
  execute: async (args: Record<string, unknown>) => {
    try {
      const { goalId, task, agentId, scheduleExpression, metadata } = args as {
        goalId: string;
        task: string;
        agentId: string;
        scheduleExpression: string;
        metadata?: Record<string, unknown>;
      };
      await DynamicScheduler.upsertSchedule(
        goalId,
        { goalId, task, agentId, metadata, userId: 'SYSTEM' },
        scheduleExpression,
        `Proactive goal for ${agentId}: ${task}`
      );
      return `Successfully scheduled proactive goal "${goalId}" with expression "${scheduleExpression}".`;
    } catch (error: unknown) {
      return `Failed to schedule goal: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * cancelGoal
 * Removes a previously scheduled proactive goal.
 */
export const cancelGoal: ITool = {
  name: 'cancelGoal',
  description: 'Cancels and removes a previously scheduled proactive goal/heartbeat.',
  parameters: {
    type: 'object',
    properties: {
      goalId: { type: 'string', description: 'The unique ID of the goal to cancel.' },
    },
    required: ['goalId'],
  },
  execute: async (args: Record<string, unknown>) => {
    try {
      await DynamicScheduler.removeSchedule((args as { goalId: string }).goalId);
      return `Successfully cancelled proactive goal "${args.goalId}".`;
    } catch (error: unknown) {
      return `Failed to cancel goal: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * listGoals
 * Lists all active proactive schedules.
 */
export const listGoals: ITool = {
  name: 'listGoals',
  description: 'Lists all currently active proactive goals and scheduled heartbeats.',
  parameters: {
    type: 'object',
    properties: {
      namePrefix: { type: 'string', description: 'Optional prefix to filter the goal list.' },
    },
  },
  execute: async (args: Record<string, unknown>) => {
    try {
      const schedules = (await DynamicScheduler.listSchedules(
        (args as { namePrefix?: string }).namePrefix
      )) as unknown[];
      if (schedules.length === 0) return 'No active proactive goals found.';

      const list = (schedules as { Name: string; State: string }[])
        .map((s) => `- ${s.Name}: (${s.State})`)
        .join('\n');
      return `Active Proactive Goals:\n${list}`;
    } catch (error: unknown) {
      return `Failed to list goals: ${formatErrorMessage(error)}`;
    }
  },
};
