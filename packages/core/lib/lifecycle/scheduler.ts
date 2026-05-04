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
   * @param workspaceId - Optional workspaceId for multi-tenant isolation.
   */
  static async upsertSchedule(
    name: string,
    payload: Record<string, unknown>,
    expression: string,
    description?: string,
    workspaceId?: string
  ): Promise<void> {
    const roleArn = process.env.SCHEDULER_ROLE_ARN;
    const targetArn = process.env.HEARTBEAT_HANDLER_ARN;

    if (!roleArn || !targetArn) {
      throw new Error('SCHEDULER_ROLE_ARN or HEARTBEAT_HANDLER_ARN not configured in environment.');
    }

    const scopedName = workspaceId ? `WS-${workspaceId}-${name}` : name;
    // Limit name length to 64 chars as per AWS Scheduler requirements
    const finalName = scopedName.length > 64 ? scopedName.substring(0, 64) : scopedName;

    logger.info(
      `Upserting schedule: ${finalName} with expression: ${expression} (WS: ${workspaceId || 'GLOBAL'})`
    );

    try {
      await scheduler.send(
        new CreateScheduleCommand({
          Name: finalName,
          ScheduleExpression: expression,
          Description:
            description ?? `Dynamic goal-oriented schedule for ${payload.agentId ?? 'system'}`,
          FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
          Target: {
            Arn: targetArn,
            RoleArn: roleArn,
            Input: JSON.stringify({ ...payload, workspaceId }),
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
        logger.info(`Schedule ${finalName} already exists, replacing...`);
        await this.removeSchedule(finalName);
        await this.upsertSchedule(name, payload, expression, description, workspaceId);
      } else {
        logger.error(`Failed to create schedule ${finalName}:`, error);
        throw error;
      }
    }
  }

  /**
   * Removes a dynamic schedule.
   *
   * @param name - Unique name of the schedule to delete.
   * @param workspaceId - Optional workspaceId for multi-tenant isolation.
   */
  static async removeSchedule(name: string, workspaceId?: string): Promise<void> {
    const scopedName = workspaceId ? `WS-${workspaceId}-${name}` : name;
    const finalName = scopedName.length > 64 ? scopedName.substring(0, 64) : scopedName;

    logger.info(`Removing schedule: ${finalName}`);
    try {
      await scheduler.send(new DeleteScheduleCommand({ Name: finalName }));
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error as Error & { name: string }).name === 'ResourceNotFoundException'
      ) {
        logger.warn(`Schedule ${finalName} not found, skipping deletion.`);
      } else {
        logger.error(`Failed to delete schedule ${finalName}:`, error);
        throw error;
      }
    }
  }

  /**
   * Lists all dynamic schedules managed by the system.
   */
  static async listSchedules(namePrefix?: string, workspaceId?: string): Promise<unknown[]> {
    const prefix = workspaceId ? `WS-${workspaceId}-` : '';
    const finalPrefix = namePrefix ? `${prefix}${namePrefix}` : prefix;

    try {
      const response = await scheduler.send(
        new ListSchedulesCommand({
          NamePrefix: finalPrefix || undefined,
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
   *
   * @param name - Unique name of the schedule.
   * @param workspaceId - Optional workspaceId for multi-tenant isolation.
   */
  static async getSchedule(name: string, workspaceId?: string): Promise<unknown> {
    const scopedName = workspaceId ? `WS-${workspaceId}-${name}` : name;
    const finalName = scopedName.length > 64 ? scopedName.substring(0, 64) : scopedName;

    try {
      const response = await scheduler.send(new GetScheduleCommand({ Name: finalName }));
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
    workspaceId?: string;
  }): Promise<void> {
    const existing = await this.getSchedule(params.goalId, params.workspaceId);
    if (!existing) {
      logger.info(
        `Goal ${params.goalId} not found for WS: ${params.workspaceId || 'GLOBAL'}, scheduling proactive task.`
      );
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
        `Proactive goal for ${params.agentId}: ${params.task}`,
        params.workspaceId
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
   * @param workspaceId - Optional workspaceId for multi-tenant isolation.
   */
  static async scheduleOneShotTimeout(
    timeoutId: string,
    payload: Record<string, unknown>,
    targetTime: number,
    eventType: EventType = EventType.CLARIFICATION_TIMEOUT,
    workspaceId?: string
  ): Promise<void> {
    const roleArn = process.env.SCHEDULER_ROLE_ARN;
    const targetArn = process.env.EVENT_HANDLER_ARN ?? process.env.HEARTBEAT_HANDLER_ARN;

    if (!roleArn || !targetArn) {
      logger.warn(
        'SCHEDULER_ROLE_ARN or EVENT_HANDLER_ARN not configured, skipping timeout scheduling.'
      );
      return;
    }

    const scopedId = workspaceId ? `WS-${workspaceId}-${timeoutId}` : timeoutId;
    const finalId = scopedId.length > 64 ? scopedId.substring(0, 64) : scopedId;

    const date = new Date(targetTime);
    const atExpression = `at(${date.toISOString()})`;

    logger.info(
      `Scheduling one-shot timeout: ${finalId} (${eventType}) for ${date.toISOString()} (WS: ${workspaceId || 'GLOBAL'})`
    );

    try {
      await scheduler.send(
        new CreateScheduleCommand({
          Name: finalId,
          ScheduleExpression: atExpression,
          Description: `One-shot timeout for ${payload.traceId ?? 'unknown'}`,
          FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
          Target: {
            Arn: targetArn,
            RoleArn: roleArn,
            Input: JSON.stringify({
              'detail-type': eventType,
              detail: { ...payload, workspaceId },
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
        logger.info(`Timeout ${finalId} already exists, replacing...`);
        await this.removeSchedule(timeoutId, workspaceId);
        await this.scheduleOneShotTimeout(timeoutId, payload, targetTime, eventType, workspaceId);
      } else {
        logger.error(`Failed to schedule one-shot timeout ${finalId}:`, error);
        throw error;
      }
    }
  }
}
