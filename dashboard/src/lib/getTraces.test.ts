import { describe, it, expect, vi } from 'vitest';
import { TraceSource } from '@claw/core/lib/types/agent';

vi.mock('@/lib/sst-utils', () => ({ getResourceName: () => 'TraceTable' }));

import { getTraces } from './traces';

describe('getTraces', () => {
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

    const res = await getTraces(undefined, fakeDocClient);

    expect(res.items.length).toBe(2);
    expect(res.items[0].traceId).toBe('t3');
    expect(res.items[1].traceId).toBe('t1');
    expect(typeof res.nextToken).toBe('string');

    // Ensure QueryCommand was called (we don't inspect the class, just that send was used)
    expect(mockSend).toHaveBeenCalled();
  });
});
