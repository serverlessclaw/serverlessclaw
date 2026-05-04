import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleGoal, cancelGoal, listSchedules } from './scheduler';
import { DynamicScheduler } from '../../lib/lifecycle/scheduler';

vi.mock('../../lib/lifecycle/scheduler', () => ({
  DynamicScheduler: {
    upsertSchedule: vi.fn().mockResolvedValue(undefined),
    removeSchedule: vi.fn().mockResolvedValue(undefined),
    listSchedules: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: vi.fn((err) => String(err)),
}));

describe('Scheduler Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scheduleGoal', () => {
    it('successfully schedules a goal', async () => {
      const args = {
        goalId: 'test-goal',
        task: 'test-task',
        agentId: 'coder',
        scheduleExpression: 'rate(1 hour)',
        metadata: { foo: 'bar' },
      };

      const result = await scheduleGoal.execute(args);

      expect(DynamicScheduler.upsertSchedule).toHaveBeenCalledWith(
        'test-goal',
        { foo: 'bar' },
        'rate(1 hour)',
        'test-task'
      );
      expect(result).toContain('SUCCESS: Goal test-goal scheduled');
    });

    it('handles errors during scheduling', async () => {
      vi.mocked(DynamicScheduler.upsertSchedule).mockRejectedValue(new Error('Failed!'));

      const result = await scheduleGoal.execute({
        goalId: 'test-goal',
        task: 'test-task',
        agentId: 'coder',
        scheduleExpression: 'rate(1 hour)',
      });

      expect(result).toContain('FAILED_TO_SCHEDULE: Error: Failed!');
    });
  });

  describe('cancelGoal', () => {
    it('successfully cancels a goal', async () => {
      const result = await cancelGoal.execute({ goalId: 'test-goal' });

      expect(DynamicScheduler.removeSchedule).toHaveBeenCalledWith('test-goal');
      expect(result).toContain('SUCCESS: Goal test-goal cancelled');
    });

    it('handles errors during cancellation', async () => {
      vi.mocked(DynamicScheduler.removeSchedule).mockRejectedValue(new Error('Failed to cancel'));

      const result = await cancelGoal.execute({ goalId: 'test-goal' });

      expect(result).toContain('FAILED_TO_CANCEL: Error: Failed to cancel');
    });
  });

  describe('listSchedules', () => {
    it('returns message when no goals found', async () => {
      vi.mocked(DynamicScheduler.listSchedules).mockResolvedValue([]);

      const result = await listSchedules.execute({});

      expect(result).toBe('No active goals found.');
    });

    it('lists active goals', async () => {
      vi.mocked(DynamicScheduler.listSchedules).mockResolvedValue([
        { Name: 'goal1', State: 'ENABLED' },
        { Name: 'goal2', State: 'DISABLED' },
      ]);

      const result = await listSchedules.execute({ namePrefix: 'goal' });

      expect(DynamicScheduler.listSchedules).toHaveBeenCalledWith('goal');
      expect(result).toContain('Found 2 active goals:');
      expect(result).toContain('- [goal1] Status: ENABLED');
      expect(result).toContain('- [goal2] Status: DISABLED');
    });

    it('handles errors during listing', async () => {
      vi.mocked(DynamicScheduler.listSchedules).mockRejectedValue(new Error('Failed to list'));

      const result = await listSchedules.execute({});

      expect(result).toContain('FAILED_TO_LIST: Error: Failed to list');
    });
  });
});
