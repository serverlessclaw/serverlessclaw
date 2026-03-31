import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitMetrics, METRICS } from './metrics';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-cloudwatch', () => {
  return {
    CloudWatchClient: class {
      send = mockSend;
    },
    PutMetricDataCommand: class {
      constructor(public input: any) {}
    },
  };
});

describe('Metrics', () => {
  beforeEach(() => {
    mockSend.mockReset();
    vi.clearAllMocks();
  });

  it('should emit metrics using PutMetricDataCommand', async () => {
    mockSend.mockResolvedValue({});

    await emitMetrics([
      METRICS.agentInvoked('test-agent'),
      METRICS.tokensInput(100, 'test-agent', 'openai'),
    ]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.input.Namespace).toBe('ServerlessClaw');
    expect(command.input.MetricData).toHaveLength(2);
    expect(command.input.MetricData[0].MetricName).toBe('AgentInvocations');
    expect(command.input.MetricData[1].MetricName).toBe('TokensInput');
  });

  it('should not call send if metrics array is empty', async () => {
    await emitMetrics([]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
