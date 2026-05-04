/**
 * @module MetricsTypes
 * @description Type definitions for cognitive health monitoring.
 */

/**
 * Time windows for metrics aggregation.
 */
export enum MetricsWindow {
  HOURLY = 'hourly',
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

/**
 * Anomaly severity levels.
 */
export enum AnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Types of cognitive anomalies.
 */
export enum AnomalyType {
  REASONING_DEGRADATION = 'reasoning_degradation',
  MEMORY_FRAGMENTATION = 'memory_fragmentation',
  MEMORY_MISS = 'memory_miss',
  TASK_FAILURE_SPIKE = 'task_failure_spike',
  LATENCY_ANOMALY = 'latency_anomaly',
  TOKEN_OVERUSE = 'token_overuse',
  COGNITIVE_LOOP = 'cognitive_loop',
}

/**
 * Individual cognitive metric data point.
 */
export interface CognitiveMetric {
  /** Agent ID this metric belongs to. */
  agentId: string;
  /** Optional workspace ID for tenant isolation. */
  workspaceId?: string;
  /** Metric name (e.g., 'task_completion_rate', 'reasoning_coherence'). */
  name: string;
  /** Numeric value of the metric. */
  value: number;
  /** Timestamp when metric was recorded. */
  timestamp: number;
  /** Optional metadata for the metric. */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated metrics for a time window.
 */
export interface AggregatedMetrics {
  /** Agent ID. */
  agentId: string;
  /** Time window. */
  window: MetricsWindow;
  /** Window start timestamp. */
  windowStart: number;
  /** Window end timestamp. */
  windowEnd: number;
  /** Task completion rate (0-1). */
  taskCompletionRate: number;
  /** Average task latency in ms. */
  avgTaskLatencyMs: number;
  /** Reasoning coherence score (0-10). */
  reasoningCoherence: number;
  /** Memory hit rate (0-1). */
  memoryHitRate: number;
  /** Memory miss rate (0-1, lower is better). */
  memoryMissRate: number;
  /** Token efficiency (tasks per 1000 tokens). */
  tokenEfficiency: number;
  /** Error rate (0-1). */
  errorRate: number;
  /** Total tasks processed. */
  totalTasks: number;
  /** Total tokens consumed. */
  totalTokens: number;
  /** Total reasoning steps across all tasks. */
  totalReasoningSteps: number;
  /** Number of pivot events (agent changed approach). */
  totalPivots: number;
  /** Number of clarification requests made. */
  totalClarifications: number;
  /** Number of self-correction events. */
  totalSelfCorrections: number;
  /** Memory health analysis (optional, populated when available). */
  memoryHealth?: {
    /** Total memory items. */
    totalItems: number;
    /** Fragmentation score (0-1, lower is better). */
    fragmentationScore: number;
    /** Staleness score (0-1, lower is better). */
    stalenessScore: number;
    /** Coverage score (0-1, higher is better). */
    coverageScore: number;
  };
}

/**
 * Detected cognitive anomaly.
 */
export interface CognitiveAnomaly {
  /** Unique anomaly ID. */
  id: string;
  /** Type of anomaly. */
  type: AnomalyType;
  /** Severity level. */
  severity: AnomalySeverity;
  /** Agent ID where anomaly was detected. */
  agentId: string;
  /** Timestamp of detection. */
  detectedAt: number;
  /** Human-readable description. */
  description: string;
  /** Metric values that triggered the anomaly. */
  triggerMetrics: Record<string, number>;
  /** Suggested remediation. */
  suggestion?: string;
}

/**
 * Memory health analysis result.
 */
export interface MemoryHealthAnalysis {
  /** Total memory items. */
  totalItems: number;
  /** Items by tier. */
  itemsByTier: Record<string, number>;
  /** Average item age in days. */
  avgAgeDays: number;
  /** Staleness score (0-1, higher means more stale). */
  stalenessScore: number;
  /** Fragmentation score (0-1, higher means more fragmented). */
  fragmentationScore: number;
  /** Coverage score (0-1, how well memory covers known topics). */
  coverageScore: number;
  /** Recommended actions. */
  recommendations: string[];
}

/**
 * Reasoning quality metrics.
 */
export interface ReasoningQualityMetrics {
  /** Coherence score (0-10, higher is better). */
  coherenceScore: number;
  /** Task completion success rate (0-1). */
  completionRate: number;
  /** Average reasoning steps per task. */
  avgReasoningSteps: number;
  /** Pivot rate (how often agent changes approach). */
  pivotRate: number;
  /** Clarification request rate. */
  clarificationRate: number;
  /** Self-correction rate. */
  selfCorrectionRate: number;
}

/**
 * Cognitive health snapshot combining all metrics.
 */
export interface CognitiveHealthSnapshot {
  /** Timestamp of snapshot. */
  timestamp: number;
  /** Overall health score (0-100). */
  overallScore: number;
  /** Reasoning quality metrics. */
  reasoning: ReasoningQualityMetrics;
  /** Memory health analysis. */
  memory: MemoryHealthAnalysis;
  /** Recent anomalies. */
  anomalies: CognitiveAnomaly[];
  /** Aggregated metrics for each agent. */
  agentMetrics: AggregatedMetrics[];
}

/**
 * Configuration for cognitive metrics collection.
 */
export interface CognitiveMetricsConfig {
  /** Enable metrics collection. */
  enabled: boolean;
  /** Retention days for raw metrics. */
  retentionDays: number;
  /** Anomaly detection thresholds. */
  thresholds: {
    /** Minimum task completion rate before alerting. */
    minCompletionRate: number;
    /** Maximum error rate before alerting. */
    maxErrorRate: number;
    /** Minimum reasoning coherence before alerting. */
    minCoherence: number;
    /** Maximum memory miss rate before alerting. */
    maxMissRate: number;
    /** Maximum average task latency (ms) before alerting. */
    maxAvgLatencyMs: number;
    /** Maximum pivot rate (pivots/task) before flagging cognitive loop. */
    maxPivotRate: number;
    /** Minimum number of tasks before anomaly detection is reliable. */
    minSampleTasks: number;
  };
}
