import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class {
    send = mockSend;
  },
  ListSchedulesCommand: class {},
  GetScheduleCommand: class {},
  CreateScheduleCommand: class {},
  DeleteScheduleCommand: class {},
  UpdateScheduleCommand: class {},
  FlexibleTimeWindowMode: { OFF: 'OFF' },
  ActionAfterCompletion: { DELETE: 'DELETE' },
}));

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: { INTERNAL_SERVER_ERROR: 500 },
}));

describe('Scheduling API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns list of schedules', async () => {
      mockSend
        .mockResolvedValueOnce({ Schedules: [{ Name: 'schedule-1' }, { Name: 'schedule-2' }] })
        .mockResolvedValueOnce({ Name: 'schedule-1', ScheduleExpression: 'rate(5 minutes)' })
        .mockResolvedValueOnce({ Name: 'schedule-2', ScheduleExpression: 'rate(10 minutes)' });

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
    });

    it('returns empty array when no schedules', async () => {
      mockSend.mockResolvedValueOnce({ Schedules: null });

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(data).toEqual([]);
    });

    it('handles individual schedule fetch errors gracefully', async () => {
      mockSend
        .mockResolvedValueOnce({ Schedules: [{ Name: 'schedule-1' }, { Name: 'schedule-2' }] })
        .mockResolvedValueOnce({ Name: 'schedule-1', ScheduleExpression: 'rate(5 minutes)' })
        .mockRejectedValueOnce(new Error('Not found'));

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
    });

    it('returns 500 on scheduler error', async () => {
      mockSend.mockRejectedValueOnce(new Error('AWS error'));

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to fetch schedules');
    });
  });

  describe('POST', () => {
    it('creates a schedule with create action', async () => {
      process.env.DYNAMIC_SCHEDULER_ROLE_ARN = 'arn:aws:iam::123:role/test';
      process.env.HEARTBEAT_HANDLER_ARN = 'arn:aws:lambda:us-east-1:123:function:test';

      mockSend.mockResolvedValue({});

      const { POST } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          name: 'test-schedule',
          expression: 'rate(5 minutes)',
          description: 'Test schedule',
          payload: { test: true },
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('triggers a schedule with trigger action', async () => {
      mockSend
        .mockResolvedValueOnce({ Target: { Arn: 'arn:aws:lambda:us-east-1:123:function:test' } })
        .mockResolvedValueOnce({});

      const { POST } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'POST',
        body: JSON.stringify({ action: 'trigger', name: 'existing-schedule' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.triggerName).toContain('TRIGGER-');
    });

    it('returns 400 for invalid action', async () => {
      const { POST } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'POST',
        body: JSON.stringify({ action: 'invalid' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Invalid action');
    });

    it('returns 500 on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('AWS error'));

      const { POST } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', name: 'test' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to process request');
    });
  });

  describe('PATCH', () => {
    it('updates schedule state', async () => {
      mockSend
        .mockResolvedValueOnce({
          Name: 'test',
          ScheduleExpression: 'rate(5m)',
          FlexibleTimeWindow: { Mode: 'OFF' },
          Target: {},
        })
        .mockResolvedValueOnce({});

      const { PATCH } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'test', state: 'DISABLED' }),
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('returns 404 when schedule not found', async () => {
      mockSend.mockResolvedValueOnce(null);

      const { PATCH } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'nonexistent', state: 'ENABLED' }),
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('Schedule not found');
    });

    it('returns 500 on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('AWS error'));

      const { PATCH } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'test', state: 'ENABLED' }),
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to update schedule');
    });
  });

  describe('DELETE', () => {
    it('deletes a schedule by name', async () => {
      mockSend.mockResolvedValue({});

      const { DELETE } = await import('./route');
      const req = new Request('http://localhost/api/scheduling?name=test-schedule', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('returns 400 if name is missing', async () => {
      const { DELETE } = await import('./route');
      const req = new Request('http://localhost/api/scheduling', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Schedule name is required');
    });

    it('returns 500 on error', async () => {
      mockSend.mockRejectedValueOnce(new Error('AWS error'));

      const { DELETE } = await import('./route');
      const req = new Request('http://localhost/api/scheduling?name=test', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to delete schedule');
    });
  });
});
