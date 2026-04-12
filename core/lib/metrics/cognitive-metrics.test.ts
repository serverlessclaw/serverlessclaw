import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MetricsCollector,
  DegradationDetector,
  HealthTrendAnalyzer,
  CognitiveHealthMonitor,
} from './cognitive-metrics';
import { MetricsWindow, AnomalySeverity, AnomalyType } from '../types/metrics';
import type { AggregatedMetrics } from '../types/metrics';

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock TrustManager
vi.mock('../safety/trust-manager', () => ({
  TrustManager: {
    recordAnomalies: vi.fn().mockResolvedValue(100),
    recordSuccess: vi.fn().mockResolvedValue(100),
    recordFailure: vi.fn().mockResolvedValue(100),
  },
}));

// Mock SafetyConfigManager
vi.mock('../safety/safety-config-manager', () => ({
  SafetyConfigManager: {
    getPolicy: vi.fn().mockResolvedValue({
      cognitiveThresholds: {
        minCompletionRate: 0.7,
        maxErrorRate: 0.3,
        minCoherence: 5.0,
        maxMissRate: 0.5,
        maxAvgLatencyMs: 15000,
        maxPivotRate: 0.2,
        minSampleTasks: 10,
      },
    }),
  },
}));

// Mock AgentRegistry
vi.mock('../registry/AgentRegistry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'agent-1',
      safetyTier: 'local',
    }),
    atomicUpdateAgentField: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock constants
vi.mock('./constants', () => ({
  MEMORY_KEYS: {
    HEALTH_PREFIX: 'HEALTH#',
    CONVERSATION_PREFIX: 'CONV#',
    LESSON_PREFIX: 'LESSON#',
    FACT_PREFIX: 'FACT#',
    SUMMARY_PREFIX: 'SUMMARY#',
  },
  RETENTION: {
    HEALTH_DAYS: 30,
  },
  TIME: {
    MS_PER_DAY: 86400000,
    MS_PER_HOUR: 3600000,
  },
}));

// Mock BaseMemoryProvider
const createMockBase = () => ({
  putItem: vi.fn().mockResolvedValue(undefined),
  queryItems: vi.fn().mockResolvedValue([]),
  queryItemsPaginated: vi.fn().mockResolvedValue({ items: [] }),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  updateItem: vi.fn().mockResolvedValue(undefined),
  scanByPrefix: vi.fn().mockResolvedValue([]),
  getHistory: vi.fn().mockResolvedValue([]),
  clearHistory: vi.fn().mockResolvedValue(undefined),
  getDistilledMemory: vi.fn().mockResolvedValue(''),
  listConversations: vi.fn().mockResolvedValue([]),
  getScopedUserId: vi.fn().mockImplementation((uid, wid) => (wid ? `${uid}#${wid}` : uid)),
});

describe('MetricsCollector', () => {
  let mockBase: ReturnType<typeof createMockBase>;
  let collector: MetricsCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockBase = createMockBase();
    collector = new MetricsCollector(mockBase as any);
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  it('should record task completion metrics', async () => {
    await collector.recordTaskCompletion('agent-1', true, 150, 500, { taskId: 'task-1' });

    // Trigger flush to persist
    await collector.flush();

    expect(mockBase.putItem).toHaveBeenCalledTimes(3);
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'HEALTH#METRIC#agent-1',
        type: 'COGNITIVE_METRIC',
        metricName: 'task_completed',
        value: 1,
      })
    );
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'task_latency_ms',
        value: 150,
      })
    );
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'tokens_used',
        value: 500,
      })
    );
  });

  it('should record failed task completion with value 0', async () => {
    await collector.recordTaskCompletion('agent-1', false, 200, 300);
    await collector.flush();

    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'task_completed',
        value: 0,
      })
    );
  });

  it('should record reasoning quality metrics', async () => {
    await collector.recordReasoningQuality('agent-1', 8.5, 5, false, true);
    await collector.flush();

    expect(mockBase.putItem).toHaveBeenCalledTimes(4);
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'reasoning_coherence',
        value: 8.5,
      })
    );
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'reasoning_steps',
        value: 5,
      })
    );
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'pivot',
        value: 0,
      })
    );
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'clarification_request',
        value: 1,
      })
    );
  });

  it('should record self-correction metrics', async () => {
    await collector.recordSelfCorrection('agent-1');
    await collector.flush();

    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'HEALTH#METRIC#agent-1',
        metricName: 'self_correction',
        value: 1,
      })
    );
  });

  it('should record memory operation metrics', async () => {
    await collector.recordMemoryOperation('agent-1', 'hit', 10);
    await collector.flush();

    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'memory_hit',
        value: 1,
      })
    );
    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: 'memory_latency_ms',
        value: 10,
      })
    );
  });

  it('should not record metrics when disabled', async () => {
    const disabledCollector = new MetricsCollector(mockBase as any, { enabled: false });

    await disabledCollector.recordTaskCompletion('agent-1', true, 100, 200);
    await disabledCollector.recordReasoningQuality('agent-1', 7, 3, false, false);
    await disabledCollector.recordMemoryOperation('agent-1', 'read', 5);
    await disabledCollector.flush();

    expect(mockBase.putItem).not.toHaveBeenCalled();
    disabledCollector.destroy();
  });

  it('should auto-flush when buffer exceeds thresholds [Sh5]', async () => {
    // Sh5: Threshold now set to 50 items (each completion records 3 metrics)
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(collector.recordTaskCompletion('agent-1', true, 100, 200));
    }
    await Promise.all(promises);

    expect(mockBase.putItem).toHaveBeenCalled();
  });

  it('should flush immediately when a task fails (Direct-Persistence) [Sh5]', async () => {
    // Sh5: Critical for preventing telemetry loss on Lambda crashes
    await collector.recordTaskCompletion('agent-1', false, 100, 200, { error: 'test-fail' });

    expect(mockBase.putItem).toHaveBeenCalled();
    const firstCall = mockBase.putItem.mock.calls[0][0];
    expect(firstCall.metricName).toBe('task_completed');
    expect(firstCall.value).toBe(0);
  });

  it('should use a shorter flush interval suitable for Lambda [Sh5]', () => {
    collector.start();
    const flushSpy = vi.spyOn(collector, 'flush');

    // Sh5: Advance by 10 seconds (the new interval)
    vi.advanceTimersByTime(10001);
    expect(flushSpy).toHaveBeenCalled();
  });

  it('should handle flush errors gracefully', async () => {
    mockBase.putItem.mockRejectedValueOnce(new Error('DynamoDB error'));

    await collector.recordTaskCompletion('agent-1', true, 100, 200);
    await collector.flush();

    // Should not throw, error is logged
    const { logger } = await import('../logger');
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to persist cognitive metric',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});

describe('DegradationDetector', () => {
  let detector: DegradationDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new DegradationDetector();
  });

  const createMetrics = (overrides: Partial<AggregatedMetrics> = {}): AggregatedMetrics => ({
    agentId: 'agent-1',
    window: MetricsWindow.HOURLY,
    windowStart: Date.now() - 3600000,
    windowEnd: Date.now(),
    taskCompletionRate: 0.95,
    avgTaskLatencyMs: 150,
    reasoningCoherence: 8.5,
    memoryHitRate: 0.9,
    memoryMissRate: 0.2,
    tokenEfficiency: 2.5,
    errorRate: 0.05,
    totalTasks: 100,
    totalTokens: 40000,
    totalReasoningSteps: 0,
    totalPivots: 0,
    totalClarifications: 0,
    totalSelfCorrections: 0,
    ...overrides,
  });

  it('should return no anomalies for healthy metrics', async () => {
    const metrics = createMetrics();
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    expect(anomalies).toHaveLength(0);
  });

  it('should detect task failure spike when completion rate drops below threshold', async () => {
    const metrics = createMetrics({ taskCompletionRate: 0.6 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe(AnomalyType.TASK_FAILURE_SPIKE);
    expect(anomalies[0].severity).toBe(AnomalySeverity.HIGH);
    expect(anomalies[0].description).toContain('60.0%');
  });

  it('should escalate task failure to CRITICAL when completion rate below 50% of threshold', async () => {
    // Sh5: thresholds.minCompletionRate is 0.7.
    // Severity becomes CRITICAL if < thresholds.minCompletionRate / 2 (0.35)
    // Actually the code says: metrics.taskCompletionRate < (thresholds.minCompletionRate / 2)
    const metrics = createMetrics({ taskCompletionRate: 0.3 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    expect(anomalies[0].severity).toBe(AnomalySeverity.CRITICAL);
  });

  it('should detect elevated error rate', async () => {
    const metrics = createMetrics({ errorRate: 0.35 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const errorAnomaly = anomalies.find((a) => a.type === AnomalyType.TASK_FAILURE_SPIKE);
    expect(errorAnomaly).toBeDefined();
    expect(errorAnomaly!.severity).toBe(AnomalySeverity.HIGH);
    expect(errorAnomaly!.description).toContain('35.0%');
  });

  it('should escalate error rate to CRITICAL when above 2x threshold', async () => {
    // thresholds.maxErrorRate is 0.3. 2x is 0.6.
    const metrics = createMetrics({ errorRate: 0.65 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const errorAnomaly = anomalies.find((a) => a.description.includes('Error rate'));
    expect(errorAnomaly?.severity).toBe(AnomalySeverity.CRITICAL);
  });

  it('should detect reasoning degradation', async () => {
    const metrics = createMetrics({ reasoningCoherence: 4.5 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const reasoningAnomaly = anomalies.find((a) => a.type === AnomalyType.REASONING_DEGRADATION);
    expect(reasoningAnomaly).toBeDefined();
    expect(reasoningAnomaly!.severity).toBe(AnomalySeverity.MEDIUM);
    expect(reasoningAnomaly!.description).toContain('4.5/10');
  });

  it('should escalate reasoning degradation to CRITICAL when coherence below 50% of threshold', async () => {
    // thresholds.minCoherence is 5.0. 50% is 2.5
    const metrics = createMetrics({ reasoningCoherence: 2.0 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const reasoningAnomaly = anomalies.find((a) => a.type === AnomalyType.REASONING_DEGRADATION);
    expect(reasoningAnomaly?.severity).toBe(AnomalySeverity.CRITICAL);
  });

  it('should detect memory miss rate anomaly', async () => {
    const metrics = createMetrics({ memoryMissRate: 0.6 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const memoryAnomaly = anomalies.find((a) => a.type === AnomalyType.MEMORY_MISS);
    expect(memoryAnomaly).toBeDefined();
    expect(memoryAnomaly!.severity).toBe(AnomalySeverity.MEDIUM);
    expect(memoryAnomaly!.description).toContain('Memory miss rate');
  });

  it('should escalate memory miss rate anomaly to HIGH when above 1.5x threshold', async () => {
    // thresholds.maxMissRate is 0.5. 1.5x is 0.75
    const metrics = createMetrics({ memoryMissRate: 0.8 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const memoryAnomaly = anomalies.find((a) => a.type === AnomalyType.MEMORY_MISS);
    expect(memoryAnomaly?.severity).toBe(AnomalySeverity.HIGH);
  });

  it('should detect token overuse when efficiency is low', async () => {
    const metrics = createMetrics({ tokenEfficiency: 0.3, totalTasks: 50 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const tokenAnomaly = anomalies.find((a) => a.type === AnomalyType.TOKEN_OVERUSE);
    expect(tokenAnomaly).toBeDefined();
    expect(tokenAnomaly!.severity).toBe(AnomalySeverity.MEDIUM);
  });

  it('should not detect token overuse when totalTasks is less than minSampleTasks', async () => {
    const metrics = createMetrics({ tokenEfficiency: 0.3, totalTasks: 5 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const tokenAnomaly = anomalies.find((a) => a.type === AnomalyType.TOKEN_OVERUSE);
    expect(tokenAnomaly).toBeUndefined();
  });

  it('should detect latency anomaly when avgTaskLatencyMs exceeds threshold', async () => {
    const metrics = createMetrics({ avgTaskLatencyMs: 20000, totalTasks: 20 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const latencyAnomaly = anomalies.find((a) => a.type === AnomalyType.LATENCY_ANOMALY);
    expect(latencyAnomaly).toBeDefined();
    expect(latencyAnomaly!.severity).toBe(AnomalySeverity.MEDIUM);
    expect(latencyAnomaly!.description).toContain('20000ms');
  });

  it('should escalate latency anomaly to HIGH when above 2x threshold', async () => {
    const metrics = createMetrics({ avgTaskLatencyMs: 40000, totalTasks: 20 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const latencyAnomaly = anomalies.find((a) => a.type === AnomalyType.LATENCY_ANOMALY);
    expect(latencyAnomaly?.severity).toBe(AnomalySeverity.HIGH);
  });

  it('should not detect latency anomaly when totalTasks is less than minSampleTasks', async () => {
    const metrics = createMetrics({ avgTaskLatencyMs: 50000, totalTasks: 3 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const latencyAnomaly = anomalies.find((a) => a.type === AnomalyType.LATENCY_ANOMALY);
    expect(latencyAnomaly).toBeUndefined();
  });

  it('should detect cognitive loop when pivot rate exceeds threshold', async () => {
    const metrics = createMetrics({ totalPivots: 6, totalTasks: 20 }); // pivot rate 0.3 > 0.2
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const loopAnomaly = anomalies.find((a) => a.type === AnomalyType.COGNITIVE_LOOP);
    expect(loopAnomaly).toBeDefined();
    expect(loopAnomaly!.severity).toBe(AnomalySeverity.HIGH);
    expect(loopAnomaly!.description).toContain('30.0%');
  });

  it('should escalate cognitive loop to CRITICAL when pivot rate above 1.5x threshold', async () => {
    const metrics = createMetrics({ totalPivots: 8, totalTasks: 20 }); // pivot rate 0.4 > 0.3 (1.5 * 0.2)
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const loopAnomaly = anomalies.find((a) => a.type === AnomalyType.COGNITIVE_LOOP);
    expect(loopAnomaly?.severity).toBe(AnomalySeverity.CRITICAL);
  });

  it('should not detect cognitive loop when totalTasks is less than minSampleTasks', async () => {
    const metrics = createMetrics({ totalPivots: 5, totalTasks: 5 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    const loopAnomaly = anomalies.find((a) => a.type === AnomalyType.COGNITIVE_LOOP);
    expect(loopAnomaly).toBeUndefined();
  });

  it('should detect multiple anomalies simultaneously', async () => {
    const metrics = createMetrics({
      taskCompletionRate: 0.3,
      errorRate: 0.7,
      reasoningCoherence: 2.0,
      memoryMissRate: 0.85,
    });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    expect(anomalies.length).toBeGreaterThanOrEqual(4);
    const types = new Set(anomalies.map((a) => a.type));
    expect(types.has(AnomalyType.TASK_FAILURE_SPIKE)).toBe(true);
    expect(types.has(AnomalyType.REASONING_DEGRADATION)).toBe(true);
    expect(types.has(AnomalyType.MEMORY_MISS)).toBe(true);
  });

  it('should include trigger metrics and suggestions in anomalies', async () => {
    const metrics = createMetrics({ taskCompletionRate: 0.6 });
    const anomalies = await detector.detectAnomalies('agent-1', metrics);

    expect(anomalies[0].triggerMetrics).toHaveProperty('taskCompletionRate', 0.6);
    expect(anomalies[0].suggestion).toBeDefined();
    expect(anomalies[0].id).toMatch(/^anomaly_\d+_[a-z0-9]+$/);
  });
});

describe('HealthTrendAnalyzer', () => {
  let mockBase: ReturnType<typeof createMockBase>;
  let analyzer: HealthTrendAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBase = createMockBase();
    analyzer = new HealthTrendAnalyzer(mockBase as any);
  });

  it('should aggregate metrics from query results', async () => {
    const now = Date.now();
    mockBase.queryItems.mockResolvedValue([
      { metricName: 'task_completed', value: 1, timestamp: now - 1000 },
      { metricName: 'task_completed', value: 1, timestamp: now - 2000 },
      { metricName: 'task_completed', value: 0, timestamp: now - 3000 },
      { metricName: 'task_latency_ms', value: 100, timestamp: now - 1000 },
      { metricName: 'task_latency_ms', value: 200, timestamp: now - 2000 },
      { metricName: 'task_latency_ms', value: 150, timestamp: now - 3000 },
      { metricName: 'tokens_used', value: 5000, timestamp: now - 1000 },
      { metricName: 'tokens_used', value: 3000, timestamp: now - 2000 },
      { metricName: 'reasoning_coherence', value: 8, timestamp: now - 1000 },
      { metricName: 'reasoning_coherence', value: 9, timestamp: now - 2000 },
      { metricName: 'memory_hit', value: 1, timestamp: now - 1000 },
      { metricName: 'memory_hit', value: 1, timestamp: now - 2000 },
      { metricName: 'memory_miss', value: 1, timestamp: now - 3000 },
    ]);

    const result = await analyzer.getAggregatedMetrics(
      'agent-1',
      MetricsWindow.HOURLY,
      now - 3600000,
      now
    );

    expect(result.agentId).toBe('agent-1');
    expect(result.totalTasks).toBe(3);
    expect(result.taskCompletionRate).toBeCloseTo(2 / 3);
    expect(result.avgTaskLatencyMs).toBeCloseTo(150);
    expect(result.totalTokens).toBe(8000);
    expect(result.reasoningCoherence).toBeCloseTo(8.5);
    expect(result.memoryHitRate).toBeCloseTo(2 / 3);
    expect(result.errorRate).toBeCloseTo(1 / 3);
  });

  it('should return default values for empty metrics', async () => {
    mockBase.queryItems.mockResolvedValue([]);

    const result = await analyzer.getAggregatedMetrics(
      'agent-1',
      MetricsWindow.HOURLY,
      Date.now() - 3600000,
      Date.now()
    );

    expect(result.taskCompletionRate).toBe(1);
    expect(result.avgTaskLatencyMs).toBe(0);
    expect(result.reasoningCoherence).toBe(10);
    expect(result.memoryHitRate).toBe(1);
    expect(result.errorRate).toBe(0);
    expect(result.totalTasks).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it('should query with correct parameters', async () => {
    const windowStart = 1000000;
    const windowEnd = 2000000;

    await analyzer.getAggregatedMetrics('agent-1', MetricsWindow.DAILY, windowStart, windowEnd);

    expect(mockBase.queryItems).toHaveBeenCalledWith({
      KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': 'HEALTH#METRIC#agent-1',
        ':start': windowStart,
        ':end': windowEnd,
      },
    });
  });

  it('should analyze memory health', async () => {
    const result = await analyzer.analyzeMemoryHealth();

    expect(result.totalItems).toBe(0);
    expect(result.stalenessScore).toBe(0);
    expect(result.fragmentationScore).toBe(0);
    expect(result.coverageScore).toBe(0);
    expect(result.recommendations).toEqual([]);
  });
});

describe('CognitiveHealthMonitor', () => {
  let mockBase: ReturnType<typeof createMockBase>;
  let monitor: CognitiveHealthMonitor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockBase = createMockBase();
    monitor = new CognitiveHealthMonitor(mockBase as any);
  });

  afterEach(() => {
    monitor.destroy();
    vi.useRealTimers();
  });

  it('should return a metrics collector', () => {
    const collector = monitor.getCollector();
    expect(collector).toBeInstanceOf(MetricsCollector);
  });

  it('should take a cognitive health snapshot', async () => {
    mockBase.queryItems.mockResolvedValue([]);

    const snapshot = await monitor.takeSnapshot(['agent-1']);

    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.overallScore).toBeGreaterThanOrEqual(0);
    expect(snapshot.overallScore).toBeLessThanOrEqual(100);
    expect(snapshot.reasoning).toBeDefined();
    expect(snapshot.memory).toBeDefined();
    expect(snapshot.anomalies).toBeInstanceOf(Array);
    expect(snapshot.agentMetrics).toHaveLength(1);
  });

  it('should calculate overall score based on metrics', async () => {
    mockBase.queryItems.mockResolvedValue([
      { metricName: 'task_completed', value: 1 },
      { metricName: 'task_completed', value: 1 },
      { metricName: 'reasoning_coherence', value: 9 },
      { metricName: 'reasoning_coherence', value: 8 },
    ]);

    const snapshot = await monitor.takeSnapshot(['agent-1']);

    // High completion (100%) + high coherence (85%) + low error (0%) + low fragmentation (100%)
    // = 0.4*40 + 0.85*30 + 1.0*20 + 1.0*10 = 16 + 25.5 + 20 + 10 = 71.5 -> 72
    expect(snapshot.overallScore).toBeGreaterThan(50);
  });

  it('should get recent anomalies with limit', async () => {
    // Simulate some anomalies by running detection
    mockBase.queryItems.mockResolvedValue([
      { metricName: 'task_completed', value: 0 },
      { metricName: 'task_completed', value: 0 },
    ]);

    await monitor.takeSnapshot(['agent-1']);
    const anomalies = monitor.getRecentAnomalies(10);

    expect(anomalies).toBeInstanceOf(Array);
    expect(anomalies.length).toBeLessThanOrEqual(10);
  });

  it('should use default agent IDs when none provided', async () => {
    mockBase.queryItems.mockResolvedValue([]);

    const snapshot = await monitor.takeSnapshot();

    // Default agents: superclaw, coder, strategic-planner, cognition-reflector
    expect(snapshot.agentMetrics).toHaveLength(4);
    const agentIds = snapshot.agentMetrics.map((m) => m.agentId);
    expect(agentIds).toContain('superclaw');
    expect(agentIds).toContain('coder');
    expect(agentIds).toContain('strategic-planner');
    expect(agentIds).toContain('cognition-reflector');
  });

  it('should aggregate agent metrics in parallel [Sh5]', async () => {
    const agents = ['agent-1', 'agent-2', 'agent-3'];
    await monitor.takeSnapshot(agents);

    // Sh5: Each agent should have triggered a concurrent DynamoDB query
    expect(mockBase.queryItems).toHaveBeenCalledTimes(agents.length);
  });

  it('should cap anomalies at 1000', async () => {
    // Generate many snapshots to accumulate anomalies
    mockBase.queryItems.mockResolvedValue([{ metricName: 'task_completed', value: 0 }]);

    for (let i = 0; i < 60; i++) {
      await monitor.takeSnapshot(['agent-1']);
    }

    const anomalies = monitor.getRecentAnomalies(2000);
    expect(anomalies.length).toBeLessThanOrEqual(1000);
  });

  it('should report detected anomalies to TrustManager in batch [Sh6]', async () => {
    const { TrustManager } = await import('../safety/trust-manager');

    // Simulate metrics that trigger an anomaly
    mockBase.queryItems.mockResolvedValue([
      { metricName: 'task_completed', value: 0 },
      { metricName: 'task_completed', value: 0 },
    ]);

    await monitor.takeSnapshot(['agent-1']);

    expect(TrustManager.recordAnomalies).toHaveBeenCalledWith(
      'agent-1',
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'agent-1',
          type: expect.any(String),
        }),
      ])
    );
  });

  it('should detect signal drift via ConsistencyProbe [Sh5]', async () => {
    const { ConsistencyProbe } = await import('./cognitive-metrics');
    const probe = new ConsistencyProbe(mockBase as any);

    // Scenario: Backend has 10 task completions, but Dashboard only has 5 events
    mockBase.queryItems
      .mockResolvedValueOnce(new Array(10).fill({ metricName: 'task_completed' })) // task_completed
      .mockResolvedValueOnce(new Array(5).fill({ metricName: 'task_latency_ms' })); // task_latency_ms (Drift!)

    const result = await probe.verifyTraceConsistency('agent-1', Date.now() - 3600000, Date.now());
    expect(result.consistent).toBe(false);
    expect(result.drift).toBe(5);
  });
});

describe('AnomalySeverity and AnomalyType enums', () => {
  it('should have correct severity levels', () => {
    expect(AnomalySeverity.LOW).toBe('low');
    expect(AnomalySeverity.MEDIUM).toBe('medium');
    expect(AnomalySeverity.HIGH).toBe('high');
    expect(AnomalySeverity.CRITICAL).toBe('critical');
  });

  it('should have all expected anomaly types', () => {
    expect(AnomalyType.REASONING_DEGRADATION).toBe('reasoning_degradation');
    expect(AnomalyType.MEMORY_FRAGMENTATION).toBe('memory_fragmentation');
    expect(AnomalyType.MEMORY_MISS).toBe('memory_miss');
    expect(AnomalyType.TASK_FAILURE_SPIKE).toBe('task_failure_spike');
    expect(AnomalyType.LATENCY_ANOMALY).toBe('latency_anomaly');
    expect(AnomalyType.TOKEN_OVERUSE).toBe('token_overuse');
    expect(AnomalyType.COGNITIVE_LOOP).toBe('cognitive_loop');
  });
});

describe('MetricsWindow enum', () => {
  it('should have correct window values', () => {
    expect(MetricsWindow.HOURLY).toBe('hourly');
    expect(MetricsWindow.DAILY).toBe('daily');
    expect(MetricsWindow.WEEKLY).toBe('weekly');
  });
});
