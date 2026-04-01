import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamicScheduler } from './scheduler';
import {
  SchedulerClient,
  CreateScheduleCommand,
  CreateScheduleCommandInput,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ListSchedulesCommand,
  ListSchedulesCommandOutput,
} from '@aws-sdk/client-scheduler';
import { mockClient } from 'aws-sdk-client-mock';

const schedulerMock = mockClient(SchedulerClient);

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../types/agent', () => ({
  EventType: {
    CLARIFICATION_TIMEOUT: 'clarification_timeout',
    ESCALATION_LEVEL_TIMEOUT: 'escalation_level_timeout',
  },
}));

describe('DynamicScheduler', () => {
  beforeEach(() => {
    schedulerMock.reset();
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/scheduler-role';
    process.env.HEARTBEAT_HANDLER_ARN =
      'arn:aws:lambda:us-east-1:123456789012:function:heartbeat-handler';
  });

  describe('upsertSchedule', () => {
    it('should upsert a schedule successfully', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await expect(
        DynamicScheduler.upsertSchedule(
          'test-goal',
          { agentId: 'test-agent', task: 'test-task', goalId: 'test-goal' },
          'rate(1 hour)'
        )
      ).resolves.not.toThrow();

      expect(schedulerMock.calls()).toHaveLength(1);
      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Name).toBe('test-goal');
      expect(input.ScheduleExpression).toBe('rate(1 hour)');
    });

    it('should use description from payload agentId when not provided', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.upsertSchedule('test-goal', { agentId: 'agent-1' }, 'rate(1 hour)');

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Description).toContain('agent-1');
    });

    it('should use custom description when provided', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.upsertSchedule(
        'test-goal',
        { agentId: 'agent-1' },
        'rate(1 hour)',
        'My custom description'
      );

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Description).toBe('My custom description');
    });

    it('should handle conflict by deleting and recreating', async () => {
      schedulerMock
        .on(CreateScheduleCommand)
        .rejectsOnce({ name: 'ConflictException' })
        .resolves({});
      schedulerMock.on(DeleteScheduleCommand).resolves({});

      await DynamicScheduler.upsertSchedule(
        'conflict-goal',
        { agentId: 'test-agent', task: 'test-task', goalId: 'conflict-goal' },
        'rate(1 hour)'
      );

      expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(2);
      expect(schedulerMock.commandCalls(DeleteScheduleCommand)).toHaveLength(1);
    });

    it('should throw error if env vars are missing', async () => {
      delete process.env.SCHEDULER_ROLE_ARN;
      await expect(DynamicScheduler.upsertSchedule('test', {}, 'rate(1m)')).rejects.toThrow(
        'SCHEDULER_ROLE_ARN or HEARTBEAT_HANDLER_ARN not configured'
      );
    });

    it('should throw error if HEARTBEAT_HANDLER_ARN is missing', async () => {
      delete process.env.HEARTBEAT_HANDLER_ARN;
      await expect(DynamicScheduler.upsertSchedule('test', {}, 'rate(1m)')).rejects.toThrow(
        'SCHEDULER_ROLE_ARN or HEARTBEAT_HANDLER_ARN not configured'
      );
    });

    it('should throw non-ConflictException errors', async () => {
      schedulerMock.on(CreateScheduleCommand).rejects(new Error('AccessDenied'));

      await expect(DynamicScheduler.upsertSchedule('test', {}, 'rate(1 hour)')).rejects.toThrow(
        'AccessDenied'
      );
    });

    it('should set ActionAfterCompletion to DELETE for at() expressions', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.upsertSchedule(
        'one-shot',
        { agentId: 'agent-1' },
        'at(2026-03-15T12:00:00)'
      );

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.ActionAfterCompletion).toBe('DELETE');
    });

    it('should set ActionAfterCompletion to NONE for rate() expressions', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.upsertSchedule('recurring', { agentId: 'agent-1' }, 'rate(1 hour)');

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.ActionAfterCompletion).toBe('NONE');
    });

    it('should set State to ENABLED', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.upsertSchedule('test', {}, 'rate(1 hour)');

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.State).toBe('ENABLED');
    });

    it('should set FlexibleTimeWindow to OFF', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.upsertSchedule('test', {}, 'rate(1 hour)');

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.FlexibleTimeWindow).toEqual({ Mode: 'OFF' });
    });
  });

  describe('removeSchedule', () => {
    it('should remove a schedule', async () => {
      schedulerMock.on(DeleteScheduleCommand).resolves({});
      await expect(DynamicScheduler.removeSchedule('test-goal')).resolves.not.toThrow();
      expect(schedulerMock.commandCalls(DeleteScheduleCommand)).toHaveLength(1);
    });

    it('should not throw if removing non-existent schedule', async () => {
      schedulerMock.on(DeleteScheduleCommand).rejects({ name: 'ResourceNotFoundException' });
      await expect(DynamicScheduler.removeSchedule('not-found')).resolves.not.toThrow();
    });

    it('should throw on other delete errors', async () => {
      schedulerMock.on(DeleteScheduleCommand).rejects(new Error('AccessDenied'));
      await expect(DynamicScheduler.removeSchedule('test')).rejects.toThrow('AccessDenied');
    });
  });

  describe('listSchedules', () => {
    it('should list schedules', async () => {
      schedulerMock.on(ListSchedulesCommand).resolves({
        Schedules: [{ Name: 'goal-1', State: 'ENABLED' }],
      } as unknown as ListSchedulesCommandOutput);

      const results = (await DynamicScheduler.listSchedules()) as { Name: string }[];
      expect(results).toHaveLength(1);
      expect(results[0].Name).toBe('goal-1');
    });

    it('should return empty array when no schedules exist', async () => {
      schedulerMock.on(ListSchedulesCommand).resolves({} as unknown as ListSchedulesCommandOutput);

      const results = await DynamicScheduler.listSchedules();
      expect(results).toEqual([]);
    });

    it('should pass namePrefix to the command', async () => {
      schedulerMock.on(ListSchedulesCommand).resolves({
        Schedules: [],
      } as unknown as ListSchedulesCommandOutput);

      await DynamicScheduler.listSchedules('planner-');

      const call = schedulerMock.call(0);
      expect((call.args[0].input as Record<string, unknown>).NamePrefix).toBe('planner-');
    });

    it('should throw on list error', async () => {
      schedulerMock.on(ListSchedulesCommand).rejects(new Error('ServiceUnavailable'));
      await expect(DynamicScheduler.listSchedules()).rejects.toThrow('ServiceUnavailable');
    });
  });

  describe('getSchedule', () => {
    it('should get a specific schedule', async () => {
      schedulerMock.on(GetScheduleCommand).resolves({ Name: 'test-goal' });
      const result = (await DynamicScheduler.getSchedule('test-goal')) as { Name: string };
      expect(result.Name).toBe('test-goal');
    });

    it('should return null if schedule not found', async () => {
      schedulerMock.on(GetScheduleCommand).rejects({ name: 'ResourceNotFoundException' });
      const result = await DynamicScheduler.getSchedule('not-found');
      expect(result).toBeNull();
    });

    it('should throw on other get errors', async () => {
      schedulerMock.on(GetScheduleCommand).rejects(new Error('InternalError'));
      await expect(DynamicScheduler.getSchedule('test')).rejects.toThrow('InternalError');
    });
  });

  describe('ensureProactiveGoal', () => {
    it('should create a schedule if it does not exist', async () => {
      schedulerMock.on(GetScheduleCommand).rejects({ name: 'ResourceNotFoundException' });
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.ensureProactiveGoal({
        goalId: 'new-goal',
        agentId: 'test-agent',
        task: 'test-task',
        userId: 'test-user',
        frequencyHrs: 24,
      });

      expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(1);
      const call = schedulerMock.commandCalls(CreateScheduleCommand)[0];
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Name).toBe('new-goal');
      expect(input.ScheduleExpression).toBe('rate(24 hours)');
    });

    it('should do nothing if schedule already exists', async () => {
      schedulerMock.on(GetScheduleCommand).resolves({ Name: 'existing-goal' });

      await DynamicScheduler.ensureProactiveGoal({
        goalId: 'existing-goal',
        agentId: 'test-agent',
        task: 'test-task',
        userId: 'test-user',
        frequencyHrs: 24,
      });

      expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(0);
    });

    it('should include metadata in payload', async () => {
      schedulerMock.on(GetScheduleCommand).rejects({ name: 'ResourceNotFoundException' });
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.ensureProactiveGoal({
        goalId: 'meta-goal',
        agentId: 'agent-1',
        task: 'task-1',
        userId: 'user-1',
        frequencyHrs: 12,
        metadata: { customKey: 'customValue' },
      });

      const call = schedulerMock.commandCalls(CreateScheduleCommand)[0];
      const input = call.args[0].input as CreateScheduleCommandInput;
      const payload = JSON.parse(input.Target!.Input as string);
      expect(payload.metadata.isProactive).toBe(true);
      expect(payload.metadata.customKey).toBe('customValue');
    });

    it('should generate description from agentId and task', async () => {
      schedulerMock.on(GetScheduleCommand).rejects({ name: 'ResourceNotFoundException' });
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.ensureProactiveGoal({
        goalId: 'sys-goal',
        agentId: 'my-agent',
        task: 'sys-task',
        userId: 'user-1',
        frequencyHrs: 6,
      });

      const call = schedulerMock.commandCalls(CreateScheduleCommand)[0];
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Description).toContain('my-agent');
      expect(input.Description).toContain('sys-task');
    });
  });

  describe('scheduleOneShotTimeout', () => {
    beforeEach(() => {
      process.env.EVENT_HANDLER_ARN =
        'arn:aws:lambda:us-east-1:123456789012:function:event-handler';
    });

    it('should schedule a one-shot timeout', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.scheduleOneShotTimeout(
        'timeout-1',
        { traceId: 'trace-1' },
        Date.now() + 60000
      );

      expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(1);
      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Name).toBe('timeout-1');
      expect(input.ScheduleExpression).toMatch(/^at\(/);
      expect(input.ActionAfterCompletion).toBe('DELETE');
    });

    it('should use custom event type', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.scheduleOneShotTimeout(
        'timeout-2',
        { traceId: 'trace-2' },
        Date.now() + 60000,
        'custom_event' as any
      );

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      const payload = JSON.parse(input.Target!.Input as string);
      expect(payload['detail-type']).toBe('custom_event');
    });

    it('should handle conflict by deleting and recreating', async () => {
      schedulerMock
        .on(CreateScheduleCommand)
        .rejectsOnce({ name: 'ConflictException' })
        .resolves({});
      schedulerMock.on(DeleteScheduleCommand).resolves({});

      await DynamicScheduler.scheduleOneShotTimeout(
        'timeout-conflict',
        { traceId: 'trace-1' },
        Date.now() + 60000
      );

      expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(2);
      expect(schedulerMock.commandCalls(DeleteScheduleCommand)).toHaveLength(1);
    });

    it('should skip scheduling if env vars are missing', async () => {
      delete process.env.SCHEDULER_ROLE_ARN;
      delete process.env.EVENT_HANDLER_ARN;
      delete process.env.HEARTBEAT_HANDLER_ARN;

      await expect(
        DynamicScheduler.scheduleOneShotTimeout('timeout-3', {}, Date.now() + 60000)
      ).resolves.not.toThrow();

      expect(schedulerMock.calls()).toHaveLength(0);
    });

    it('should throw on non-conflict errors', async () => {
      schedulerMock.on(CreateScheduleCommand).rejects(new Error('ThrottlingException'));

      await expect(
        DynamicScheduler.scheduleOneShotTimeout('timeout-4', {}, Date.now() + 60000)
      ).rejects.toThrow('ThrottlingException');
    });

    it('should fall back to HEARTBEAT_HANDLER_ARN when EVENT_HANDLER_ARN is not set', async () => {
      delete process.env.EVENT_HANDLER_ARN;
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.scheduleOneShotTimeout('timeout-5', {}, Date.now() + 60000);

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Target!.Arn).toBe(process.env.HEARTBEAT_HANDLER_ARN);
    });

    it('should use traceId in description', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.scheduleOneShotTimeout(
        'timeout-6',
        { traceId: 'my-trace-id' },
        Date.now() + 60000
      );

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Description).toContain('my-trace-id');
    });

    it('should use unknown in description when no traceId', async () => {
      schedulerMock.on(CreateScheduleCommand).resolves({});

      await DynamicScheduler.scheduleOneShotTimeout('timeout-7', {}, Date.now() + 60000);

      const call = schedulerMock.call(0);
      const input = call.args[0].input as CreateScheduleCommandInput;
      expect(input.Description).toContain('unknown');
    });
  });
});
