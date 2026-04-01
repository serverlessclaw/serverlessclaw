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

  describe('emitMetrics', () => {
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

    it('should default Unit to Count when not specified', async () => {
      mockSend.mockResolvedValue({});

      await emitMetrics([{ MetricName: 'Test', Value: 1 }]);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.MetricData[0].Unit).toBe('Count');
    });

    it('should include Timestamp in each metric datum', async () => {
      mockSend.mockResolvedValue({});

      await emitMetrics([METRICS.agentInvoked('agent')]);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.MetricData[0].Timestamp).toBeInstanceOf(Date);
    });

    it('should handle CloudWatch send failure gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('CloudWatch unavailable'));

      await expect(emitMetrics([METRICS.agentInvoked('agent')])).resolves.not.toThrow();
    });
  });

  describe('METRICS.agentInvoked', () => {
    it('should return correct metric datum', () => {
      const metric = METRICS.agentInvoked('my-agent');

      expect(metric.MetricName).toBe('AgentInvocations');
      expect(metric.Value).toBe(1);
      expect(metric.Unit).toBe('Count');
      expect(metric.Dimensions).toEqual([{ Name: 'AgentId', Value: 'my-agent' }]);
    });
  });

  describe('METRICS.agentDuration', () => {
    it('should return duration metric', () => {
      const metric = METRICS.agentDuration('agent-1', 1500);

      expect(metric.MetricName).toBe('AgentDuration');
      expect(metric.Value).toBe(1500);
      expect(metric.Unit).toBe('Milliseconds');
      expect(metric.Dimensions).toEqual([{ Name: 'AgentId', Value: 'agent-1' }]);
    });
  });

  describe('METRICS.toolExecuted', () => {
    it('should return tool execution metric for success', () => {
      const metric = METRICS.toolExecuted('web_search', true);

      expect(metric.MetricName).toBe('ToolExecutions');
      expect(metric.Value).toBe(1);
      expect(metric.Dimensions).toEqual([
        { Name: 'ToolName', Value: 'web_search' },
        { Name: 'Success', Value: 'true' },
      ]);
    });

    it('should return tool execution metric for failure', () => {
      const metric = METRICS.toolExecuted('web_search', false);

      expect(metric.Dimensions?.[1].Value).toBe('false');
    });
  });

  describe('METRICS.toolDuration', () => {
    it('should return tool duration metric', () => {
      const metric = METRICS.toolDuration('db_query', 250);

      expect(metric.MetricName).toBe('ToolDuration');
      expect(metric.Value).toBe(250);
      expect(metric.Unit).toBe('Milliseconds');
      expect(metric.Dimensions).toEqual([{ Name: 'ToolName', Value: 'db_query' }]);
    });
  });

  describe('METRICS.taskDispatchLatency', () => {
    it('should return dispatch latency metric', () => {
      const metric = METRICS.taskDispatchLatency(50);

      expect(metric.MetricName).toBe('TaskDispatchLatency');
      expect(metric.Value).toBe(50);
      expect(metric.Unit).toBe('Milliseconds');
      expect(metric.Dimensions).toBeUndefined();
    });
  });

  describe('METRICS.circuitBreakerTriggered', () => {
    it('should return circuit breaker metric for deploy type', () => {
      const metric = METRICS.circuitBreakerTriggered('deploy');

      expect(metric.MetricName).toBe('CircuitBreakerTriggered');
      expect(metric.Value).toBe(1);
      expect(metric.Dimensions).toEqual([{ Name: 'Type', Value: 'deploy' }]);
    });

    it('should return circuit breaker metric for recovery type', () => {
      const metric = METRICS.circuitBreakerTriggered('recovery');

      expect(metric.Dimensions?.[0].Value).toBe('recovery');
    });

    it('should return circuit breaker metric for gap type', () => {
      const metric = METRICS.circuitBreakerTriggered('gap');

      expect(metric.Dimensions?.[0].Value).toBe('gap');
    });
  });

  describe('METRICS.mcpHubPing', () => {
    it('should return 1 for successful ping', () => {
      const metric = METRICS.mcpHubPing({ success: true });

      expect(metric.MetricName).toBe('MCPHubPing');
      expect(metric.Value).toBe(1);
      expect(metric.Dimensions).toEqual([{ Name: 'Success', Value: 'true' }]);
    });

    it('should return 0 for failed ping', () => {
      const metric = METRICS.mcpHubPing({ success: false });

      expect(metric.Value).toBe(0);
      expect(metric.Dimensions?.[0].Value).toBe('false');
    });
  });

  describe('METRICS.mcpHubLatency', () => {
    it('should return latency metric', () => {
      const metric = METRICS.mcpHubLatency(300);

      expect(metric.MetricName).toBe('MCPHubLatency');
      expect(metric.Value).toBe(300);
      expect(metric.Unit).toBe('Milliseconds');
    });
  });

  describe('METRICS.eventBridgeEmit', () => {
    it('should return event bridge metric', () => {
      const metric = METRICS.eventBridgeEmit(true, 45);

      expect(metric.MetricName).toBe('EventBridgeEmit');
      expect(metric.Value).toBe(45);
      expect(metric.Unit).toBe('Milliseconds');
      expect(metric.Dimensions).toEqual([{ Name: 'Success', Value: 'true' }]);
    });

    it('should handle failed emit', () => {
      const metric = METRICS.eventBridgeEmit(false, 100);

      expect(metric.Dimensions?.[0].Value).toBe('false');
    });
  });

  describe('METRICS.dlqEvents', () => {
    it('should return DLQ events count', () => {
      const metric = METRICS.dlqEvents(5);

      expect(metric.MetricName).toBe('DLQEvents');
      expect(metric.Value).toBe(5);
      expect(metric.Unit).toBe('Count');
      expect(metric.Dimensions).toBeUndefined();
    });
  });

  describe('METRICS.lockAcquired', () => {
    it('should return lock metric for success', () => {
      const metric = METRICS.lockAcquired('gap-lock-1', true);

      expect(metric.MetricName).toBe('LockAcquisition');
      expect(metric.Value).toBe(1);
      expect(metric.Dimensions).toEqual([{ Name: 'LockId', Value: 'gap-lock-1' }]);
    });

    it('should return lock metric for failure', () => {
      const metric = METRICS.lockAcquired('gap-lock-1', false);

      expect(metric.Value).toBe(0);
    });
  });

  describe('METRICS.deploymentStarted', () => {
    it('should return deployment started metric', () => {
      const metric = METRICS.deploymentStarted();

      expect(metric.MetricName).toBe('DeploymentStarted');
      expect(metric.Value).toBe(1);
      expect(metric.Unit).toBe('Count');
    });
  });

  describe('METRICS.deploymentCompleted', () => {
    it('should return deployment completed metric for success', () => {
      const metric = METRICS.deploymentCompleted({ success: true });

      expect(metric.MetricName).toBe('DeploymentCompleted');
      expect(metric.Dimensions).toEqual([{ Name: 'Success', Value: 'true' }]);
    });

    it('should return deployment completed metric for failure', () => {
      const metric = METRICS.deploymentCompleted({ success: false });

      expect(metric.Dimensions?.[0].Value).toBe('false');
    });
  });

  describe('METRICS.tokensInput', () => {
    it('should return input tokens metric', () => {
      const metric = METRICS.tokensInput(500, 'agent-1', 'openai');

      expect(metric.MetricName).toBe('TokensInput');
      expect(metric.Value).toBe(500);
      expect(metric.Dimensions).toEqual([
        { Name: 'AgentId', Value: 'agent-1' },
        { Name: 'Provider', Value: 'openai' },
      ]);
    });
  });

  describe('METRICS.tokensOutput', () => {
    it('should return output tokens metric', () => {
      const metric = METRICS.tokensOutput(250, 'agent-1', 'anthropic');

      expect(metric.MetricName).toBe('TokensOutput');
      expect(metric.Value).toBe(250);
      expect(metric.Dimensions).toEqual([
        { Name: 'AgentId', Value: 'agent-1' },
        { Name: 'Provider', Value: 'anthropic' },
      ]);
    });
  });

  describe('METRICS.protocolFallback', () => {
    it('should return protocol fallback metric', () => {
      const metric = METRICS.protocolFallback('agent-1', 'mcp', 'http');

      expect(metric.MetricName).toBe('ProtocolFallback');
      expect(metric.Value).toBe(1);
      expect(metric.Dimensions).toEqual([
        { Name: 'AgentId', Value: 'agent-1' },
        { Name: 'OriginalMode', Value: 'mcp' },
        { Name: 'FallbackMode', Value: 'http' },
      ]);
    });

    it('should default fallback mode to none when not provided', () => {
      const metric = METRICS.protocolFallback('agent-1', 'mcp');

      expect(metric.Dimensions?.[2]).toEqual({ Name: 'FallbackMode', Value: 'none' });
    });
  });
});
