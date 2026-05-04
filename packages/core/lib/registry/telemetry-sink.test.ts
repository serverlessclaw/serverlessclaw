import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetrySinkRegistry, TelemetryData } from './telemetry-sink';

describe('TelemetrySinkRegistry', () => {
  beforeEach(() => {
    TelemetrySinkRegistry.clear();
  });

  it('records telemetry to registered sinks', async () => {
    const record = vi.fn();
    TelemetrySinkRegistry.register({ record });

    const data: Omit<TelemetryData, 'timestamp'> = {
      traceId: 'trace-123',
      agentId: 'agent-456',
      operation: 'test-op',
      status: 'success',
    };

    await TelemetrySinkRegistry.record(data);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-123',
        agentId: 'agent-456',
        operation: 'test-op',
        status: 'success',
        timestamp: expect.any(Number),
      })
    );
  });

  it('handles multiple telemetry sinks', async () => {
    const record1 = vi.fn();
    const record2 = vi.fn();

    TelemetrySinkRegistry.register({ record: record1 });
    TelemetrySinkRegistry.register({ record: record2 });

    await TelemetrySinkRegistry.record({ traceId: 'test' } as any);

    expect(record1).toHaveBeenCalled();
    expect(record2).toHaveBeenCalled();
  });
});
