import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ListSchedulesCommand,
  FlexibleTimeWindowMode,
  ActionAfterCompletion,
} from '@aws-sdk/client-scheduler';
import { logger } from '../logger';
import { EventType } from '../types/agent';

const scheduler = new SchedulerClient({});

/**
 * Service for managing dynamic, goal-oriented schedules using AWS EventBridge Scheduler.
 * @since 2026-03-19
 */
export class DynamicScheduler {
  /**
   * Upserts a dynamic schedule that triggers a proactive heartbeat.
   *
   * @param name - Unique name for the schedule (e.g., 'planner-strategic-review').
   * @param payload - Data to be delivered when the schedule fires.
   * @param expression - Schedule expression (e.g., 'rate(1 day)', 'at(2026-03-15T12:00:00)', 'cron(0 12 * * ? *)').
   * @param description - Optional description of the goal.
   */
  static async upsertSchedule(
    name: string,
    payload: Record<string, unknown>,
    expression: string,
    description?: string
  ): Promise<void> {
    const roleArn = process.env.SCHEDULER_ROLE_ARN;
    const targetArn = process.env.HEARTBEAT_HANDLER_ARN;

    if (!roleArn || !targetArn) {
      throw new Error('SCHEDULER_ROLE_ARN or HEARTBEAT_HANDLER_ARN not configured in environment.');
    }

    logger.info(`Upserting schedule: ${name} with expression: ${expression}`);

    try {
      await scheduler.send(
        new CreateScheduleCommand({
          Name: name,
          ScheduleExpression: expression,
          Description:
            description ?? `Dynamic goal-oriented schedule for ${payload.agentId ?? 'system'}`,
          FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
          Target: {
            Arn: targetArn,
            RoleArn: roleArn,
            Input: JSON.stringify(payload),
          },
          ActionAfterCompletion: expression.startsWith('at(')
            ? ActionAfterCompletion.DELETE
            : ActionAfterCompletion.NONE,
          State: 'ENABLED',
        })
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as Error & { name: string }).name === 'ConflictException'
      ) {
        // Handle update by deleting and recreating (Scheduler doesn't have UpdateSchedule in all SDK versions,
        // or it's often easier to replace for simple dynamic tasks)
        logger.info(`Schedule ${name} already exists, replacing...`);
        await this.removeSchedule(name);
        await this.upsertSchedule(name, payload, expression, description);
      } else {
        logger.error(`Failed to create schedule ${name}:`, error);
        throw error;
      }
    }
  }

  /**
   * Removes a dynamic schedule.
   *
   * @param name - Unique name of the schedule to delete.
   */
  static async removeSchedule(name: string): Promise<void> {
    logger.info(`Removing schedule: ${name}`);
    try {
      await scheduler.send(new DeleteScheduleCommand({ Name: name }));
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as Error & { name: string }).name === 'ResourceNotFoundException'
      ) {
        logger.warn(`Schedule ${name} not found, skipping deletion.`);
      } else {
        logger.error(`Failed to delete schedule ${name}:`, error);
        throw error;
      }
    }
  }

  /**
   * Lists all dynamic schedules managed by the system.
   */
  static async listSchedules(namePrefix?: string): Promise<unknown[]> {
    try {
      const response = await scheduler.send(
        new ListSchedulesCommand({
          NamePrefix: namePrefix,
        })
      );
      return response.Schedules ?? [];
    } catch (error: unknown) {
      logger.error('Failed to list schedules:', error);
      throw error;
    }
  }

  /**
   * Retrieves details of a specific schedule.
   */
  static async getSchedule(name: string): Promise<unknown> {
    try {
      const response = await scheduler.send(new GetScheduleCommand({ Name: name }));
      return response;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as Error & { name: string }).name === 'ResourceNotFoundException'
      )
        return null;
      throw error;
    }
  }

  /**
   * Ensures a specific proactive goal is scheduled.
   * If the schedule already exists, it does nothing (preserving existing jitter/timing).
   * Otherwise, it creates it with the given frequency.
   */
  static async ensureProactiveGoal(params: {
    goalId: string;
    agentId: string;
    task: string;
    userId: string;
    frequencyHrs: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const existing = await this.getSchedule(params.goalId);
    if (!existing) {
      logger.info(`Goal ${params.goalId} not found, scheduling proactive task.`);
      await this.upsertSchedule(
        params.goalId,
        {
          agentId: params.agentId,
          task: params.task,
          goalId: params.goalId,
          userId: params.userId,
          metadata: { ...params.metadata, isProactive: true },
        },
        `rate(${params.frequencyHrs} hours)`,
        `Proactive goal for ${params.agentId}: ${params.task}`
      );
    }
  }

  /**
   * Schedules a one-shot timeout event.
   * The schedule will be auto-deleted after firing.
   *
   * @param timeoutId - Unique ID for this timeout.
   * @param payload - Data to be delivered when the timeout fires.
   * @param targetTime - Unix timestamp (ms) when the timeout should fire.
   * @param eventType - The detail-type for the event. Defaults to CLARIFICATION_TIMEOUT.
   */
  static async scheduleOneShotTimeout(
    timeoutId: string,
    payload: Record<string, unknown>,
    targetTime: number,
    eventType: EventType = EventType.CLARIFICATION_TIMEOUT
  ): Promise<void> {
    const roleArn = process.env.SCHEDULER_ROLE_ARN;
    const targetArn = process.env.EVENT_HANDLER_ARN ?? process.env.HEARTBEAT_HANDLER_ARN;

    if (!roleArn || !targetArn) {
      logger.warn(
        'SCHEDULER_ROLE_ARN or EVENT_HANDLER_ARN not configured, skipping timeout scheduling.'
      );
      return;
    }

    const date = new Date(targetTime);
    const atExpression = `at(${date.toISOString()})`;

    logger.info(
      `Scheduling one-shot timeout: ${timeoutId} (${eventType}) for ${date.toISOString()}`
    );

    try {
      await scheduler.send(
        new CreateScheduleCommand({
          Name: timeoutId,
          ScheduleExpression: atExpression,
          Description: `One-shot timeout for ${payload.traceId ?? 'unknown'}`,
          FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
          Target: {
            Arn: targetArn,
            RoleArn: roleArn,
            Input: JSON.stringify({
              'detail-type': eventType,
              detail: payload,
            }),
          },
          ActionAfterCompletion: ActionAfterCompletion.DELETE,
          State: 'ENABLED',
        })
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as Error & { name: string }).name === 'ConflictException'
      ) {
        logger.info(`Timeout ${timeoutId} already exists, replacing...`);
        await this.removeSchedule(timeoutId);
        await this.scheduleOneShotTimeout(timeoutId, payload, targetTime, eventType);
      } else {
        logger.error(`Failed to schedule one-shot timeout ${timeoutId}:`, error);
        throw error;
      }
    }
  }
}
