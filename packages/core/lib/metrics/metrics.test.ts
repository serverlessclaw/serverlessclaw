import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitMetrics, METRICS } from './metrics';

const mockSend = vi.fn();
const mockPutSend = vi.fn();

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

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: class {
    constructor(public input: any) {}
  },
}));

vi.mock('../utils/ddb-client', () => ({
  getDocClient: () => ({ send: mockPutSend }),
  getMemoryTableName: () => 'TestMemoryTable',
  getConfigTableName: () => 'TestConfigTable',
}));

describe('Metrics', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockPutSend.mockReset();
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
      mockSend.mockRejectedValue(new Error('CloudWatch unavailable'));
      mockPutSend.mockResolvedValue({});

      await expect(emitMetrics([METRICS.agentInvoked('agent')])).resolves.not.toThrow();
    });

    it('should fall back to DynamoDB when CloudWatch is unavailable', async () => {
      mockSend.mockRejectedValue(new Error('CloudWatch unavailable'));
      mockPutSend.mockResolvedValue({});

      await emitMetrics([METRICS.agentInvoked('agent-1', true, { workspaceId: 'ws-123' })]);

      // Verify DDB persistence
      expect(mockPutSend).toHaveBeenCalled();
      const putCall = mockPutSend.mock.calls[0][0];
      expect(putCall.input.TableName).toBe('TestMemoryTable');
      expect(putCall.input.Item.userId).toBe('WS#ws-123#METRIC#AgentInvocations');
      expect(putCall.input.Item.type).toBe('METRIC');
      expect(putCall.input.Item.metricName).toBe('AgentInvocations');
      expect(putCall.input.Item.timestamp).toBeDefined();
    });
  });

  describe('METRICS.agentInvoked', () => {
    it('should return correct metric datum', () => {
      const metric = METRICS.agentInvoked('my-agent');

      expect(metric.MetricName).toBe('AgentInvocations');
      expect(metric.Value).toBe(1);
      expect(metric.Unit).toBe('Count');
      expect(metric.Dimensions).toEqual([
        { Name: 'AgentId', Value: 'my-agent' },
        { Name: 'Success', Value: 'true' },
      ]);
    });

    it('should include Success dimension as false when specified', () => {
      const metric = METRICS.agentInvoked('my-agent', false);

      expect(metric.Dimensions).toEqual([
        { Name: 'AgentId', Value: 'my-agent' },
        { Name: 'Success', Value: 'false' },
      ]);
    });

    it('should include scope dimensions when provided', () => {
      const scope = {
        workspaceId: 'ws-1',
        teamId: 'team-1',
        staffId: 'staff-1',
      };
      const metric = METRICS.agentInvoked('my-agent', true, scope);

      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-1' });
      expect(metric.Dimensions).toContainEqual({ Name: 'TeamId', Value: 'team-1' });
      expect(metric.Dimensions).toContainEqual({ Name: 'StaffId', Value: 'staff-1' });
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

    it('should include eventType and scope dimensions when provided', () => {
      const scope = { workspaceId: 'ws-123' };
      const metric = METRICS.circuitBreakerTriggered('event', scope, 'test_event');

      expect(metric.Dimensions).toContainEqual({ Name: 'Type', Value: 'event' });
      expect(metric.Dimensions).toContainEqual({ Name: 'EventType', Value: 'test_event' });
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-123' });
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

    it('should include scope dimensions when provided', () => {
      const metric = METRICS.dlqEvents(1, { workspaceId: 'ws-dlq' });
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-dlq' });
    });
  });

  describe('METRICS.lockAcquired', () => {
    it('should return lock metric for success', () => {
      const metric = METRICS.lockAcquired('gap-lock-1', true);

      expect(metric.MetricName).toBe('LockAcquisition');
      expect(metric.Value).toBe(1);
      expect(metric.Dimensions).toEqual([
        { Name: 'LockId', Value: 'gap-lock-1' },
        { Name: 'Success', Value: 'true' },
      ]);
    });

    it('should return lock metric for failure', () => {
      const metric = METRICS.lockAcquired('gap-lock-1', false);

      expect(metric.Value).toBe(0);
      expect(metric.Dimensions).toContainEqual({ Name: 'Success', Value: 'false' });
    });
  });

  describe('METRICS.deploymentStarted', () => {
    it('should return deployment started metric', () => {
      const metric = METRICS.deploymentStarted();

      expect(metric.MetricName).toBe('DeploymentStarted');
      expect(metric.Value).toBe(1);
      expect(metric.Unit).toBe('Count');
    });

    it('should include scope dimensions when provided', () => {
      const metric = METRICS.deploymentStarted({ workspaceId: 'ws-deploy' });
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-deploy' });
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

    it('should include scope dimensions when provided', () => {
      const metric = METRICS.deploymentCompleted({
        success: true,
        scope: { workspaceId: 'ws-done' },
      });
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-done' });
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

  describe('EventHandler metrics', () => {
    it('eventHandlerInvoked should include scope', () => {
      const metric = METRICS.eventHandlerInvoked('test_event', { workspaceId: 'ws-123' });
      expect(metric.MetricName).toBe('EventHandlerInvoked');
      expect(metric.Dimensions).toContainEqual({ Name: 'EventType', Value: 'test_event' });
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-123' });
    });

    it('eventHandlerDuration should include scope', () => {
      const metric = METRICS.eventHandlerDuration('test_event', 450, { workspaceId: 'ws-123' });
      expect(metric.MetricName).toBe('EventHandlerDuration');
      expect(metric.Value).toBe(450);
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-123' });
    });
  });

  describe('Swarm & Parallel metrics', () => {
    it('swarmDecomposed should include subTaskCount and depth', () => {
      const metric = METRICS.swarmDecomposed('agent-1', 5, 2, { workspaceId: 'ws-1' });
      expect(metric.MetricName).toBe('SwarmDecomposed');
      expect(metric.Value).toBe(5);
      expect(metric.Dimensions).toContainEqual({ Name: 'Depth', Value: '2' });
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-1' });
    });

    it('parallelDispatchCompleted should include successCount and status', () => {
      const metric = METRICS.parallelDispatchCompleted('trace-1', 10, 8, 'partial_success', {
        workspaceId: 'ws-1',
      });
      expect(metric.MetricName).toBe('ParallelDispatchCompleted');
      expect(metric.Value).toBe(8);
      expect(metric.Dimensions).toContainEqual({ Name: 'OverallStatus', Value: 'partial_success' });
      expect(metric.Dimensions).toContainEqual({ Name: 'WorkspaceId', Value: 'ws-1' });
    });
  });
});
