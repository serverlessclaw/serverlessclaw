import { describe, it, expect, beforeEach } from 'vitest';
import { DynamicScheduler } from './scheduler';
import {
  SchedulerClient,
  CreateScheduleCommand,
  CreateScheduleCommandInput,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ListSchedulesCommand,
} from '@aws-sdk/client-scheduler';
import { mockClient } from 'aws-sdk-client-mock';

const schedulerMock = mockClient(SchedulerClient);

describe('DynamicScheduler', () => {
  beforeEach(() => {
    schedulerMock.reset();
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/scheduler-role';
    process.env.HEARTBEAT_HANDLER_ARN =
      'arn:aws:lambda:us-east-1:123456789012:function:heartbeat-handler';
  });

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

  it('should handle conflict by deleting and recreating', async () => {
    // First call fails with ConflictException, second (delete) succeeds, third (recreate) succeeds
    schedulerMock.on(CreateScheduleCommand).rejectsOnce({ name: 'ConflictException' }).resolves({});
    schedulerMock.on(DeleteScheduleCommand).resolves({});

    await DynamicScheduler.upsertSchedule(
      'conflict-goal',
      { agentId: 'test-agent', task: 'test-task', goalId: 'conflict-goal' },
      'rate(1 hour)'
    );

    // 1 failed create + 1 delete + 1 successful create = 3 total scheduler calls (2 create, 1 delete)
    // Wait, the recursion in upsertSchedule will make another call to upsertSchedule.
    // Flow: upsert -> create (fail) -> remove -> delete (ok) -> upsert -> create (ok)
    expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(2);
    expect(schedulerMock.commandCalls(DeleteScheduleCommand)).toHaveLength(1);
  });

  it('should throw error if env vars are missing', async () => {
    delete process.env.SCHEDULER_ROLE_ARN;
    await expect(DynamicScheduler.upsertSchedule('test', {}, 'rate(1m)')).rejects.toThrow(
      'SCHEDULER_ROLE_ARN or HEARTBEAT_HANDLER_ARN not configured'
    );
  });

  it('should remove a schedule', async () => {
    schedulerMock.on(DeleteScheduleCommand).resolves({});
    await expect(DynamicScheduler.removeSchedule('test-goal')).resolves.not.toThrow();
    expect(schedulerMock.commandCalls(DeleteScheduleCommand)).toHaveLength(1);
  });

  it('should not throw if removing non-existent schedule', async () => {
    schedulerMock.on(DeleteScheduleCommand).rejects({ name: 'ResourceNotFoundException' });
    await expect(DynamicScheduler.removeSchedule('not-found')).resolves.not.toThrow();
  });

  it('should list schedules', async () => {
    schedulerMock.on(ListSchedulesCommand).resolves({
      Schedules: [{ Name: 'goal-1', ScheduleExpression: 'rate(1h)', State: 'ENABLED' } as any],
    });

    const results = await DynamicScheduler.listSchedules();
    expect(results).toHaveLength(1);
    expect(results[0].Name).toBe('goal-1');
  });

  it('should get a specific schedule', async () => {
    schedulerMock.on(GetScheduleCommand).resolves({ Name: 'test-goal' } as any);
    const result = await DynamicScheduler.getSchedule('test-goal');
    expect(result.Name).toBe('test-goal');
  });

  it('should return null if schedule not found in getSchedule', async () => {
    schedulerMock.on(GetScheduleCommand).rejects({ name: 'ResourceNotFoundException' });
    const result = await DynamicScheduler.getSchedule('not-found');
    expect(result).toBeNull();
  });
});
