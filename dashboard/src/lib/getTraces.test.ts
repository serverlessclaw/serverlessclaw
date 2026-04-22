import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraceSource } from '@claw/core/lib/types/agent';
import { getResourceName } from '@/lib/sst-utils';

vi.mock('@/lib/sst-utils', () => ({ getResourceName: vi.fn(() => 'TraceTable') }));

import { getTraces } from './traces';

describe('getTraces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getResourceName).mockReturnValue('TraceTable');
  });

  it('returns items sorted desc by timestamp, filters SYSTEM, and encodes nextToken', async () => {
    const queryRes = {
      Items: [
        { traceId: 't1', nodeId: '__summary__', source: TraceSource.DASHBOARD, timestamp: '100' },
        { traceId: 't2', nodeId: '__summary__', source: TraceSource.SYSTEM, timestamp: '200' },
        { traceId: 't3', nodeId: '__summary__', source: TraceSource.API, timestamp: '300' },
      ],
      LastEvaluatedKey: { traceId: 't3', nodeId: '__summary__' },
    };

    const mockSend = vi.fn().mockResolvedValue(queryRes);
    const fakeDocClient = { send: mockSend };

    const res = await getTraces(undefined, undefined, fakeDocClient);

    expect(res.items.length).toBe(2);
    expect(res.items[0].traceId).toBe('t3');
    expect(res.items[1].traceId).toBe('t1');
    expect(typeof res.nextToken).toBe('string');
  });

  it('returns empty items when TraceTable name is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getResourceName).mockReturnValue(undefined as any);
    const res = await getTraces();
    expect(res.items).toHaveLength(0);
    expect(res.nextToken).toBeUndefined();
  });

  it('returns empty items and logs error on DynamoDB failure', async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error('Dynamo failure'));
    const fakeDocClient = { send: mockSend };

    const res = await getTraces(undefined, undefined, fakeDocClient);

    expect(res.items).toHaveLength(0);
    expect(res.nextToken).toBeUndefined();
  });

  it('falls back to root-node scan when summary rows are missing', async () => {
    const mockSend = vi
      .fn()
      // First call: summary query returns empty
      .mockResolvedValueOnce({ Items: [] })
      // Second call: scan returns root rows
      .mockResolvedValueOnce({
        Items: [
          { traceId: 'r1', nodeId: 'root', source: TraceSource.DASHBOARD, timestamp: '100' },
          { traceId: 'r2', nodeId: 'root', source: TraceSource.API, timestamp: '300' },
          { traceId: 'r3', nodeId: 'root', source: TraceSource.SYSTEM, timestamp: '500' },
        ],
        LastEvaluatedKey: { traceId: 'r2', nodeId: 'root' },
      });

    const fakeDocClient = { send: mockSend };
    const res = await getTraces(undefined, undefined, fakeDocClient);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].traceId).toBe('r2');
    expect(res.items[1].traceId).toBe('r1');
    expect(typeof res.nextToken).toBe('string');
  });
});
