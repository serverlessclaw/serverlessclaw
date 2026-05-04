/**
 * @module ReputationTypes
 * Defines the schema for agent reputation tracking and updates.
 */

/**
 * Agent reputation data for routing and consensus.
 */
export interface AgentReputation {
  /** Unique ID of the agent. */
  agentId: string;
  /** Number of tasks successfully completed. */
  tasksCompleted: number;
  /** Number of tasks that failed. */
  tasksFailed: number;
  /** Average latency in milliseconds for task completion. */
  avgLatencyMs: number;
  /** Cumulative latency of completed tasks (ms) for average calculation. */
  totalLatencyMs: number;
  /** Success rate (0.0 to 1.0). */
  successRate: number;
  /** Total number of tasks processed (derived from tasksCompleted + tasksFailed). */
  totalTasks: number;
  /** Timestamp of the last active task. */
  lastActive: number;
  /** Start of the current rolling window (epoch ms). */
  windowStart: number;
  /** Epoch second for DynamoDB TTL. */
  expiresAt: number;
  /** Timestamp when the reputation record was first created (epoch ms). */
  createdAt: number;
  /** Rolling window in days for reputation calculation (e.g., 7). */
  rollingWindow: number;
  /** Composite reputation score (0.0 to 1.0). */
  score: number;
  /** Detailed breakdown of failure types by count. */
  errorDistribution: Record<string, number>;
  /** ID of the most recent trace processed by this agent. */
  lastTraceId?: string;
  /** Current system prompt hash for version tracking. */
  promptHash?: string;
}

/**
 * Data needed to update an agent's reputation.
 */
export interface ReputationUpdatePayload {
  /** The ID of the agent whose reputation is being updated. */
  agentId: string;
  /** Whether the task was successful. */
  success: boolean;
  /** Duration of the task in milliseconds. */
  durationMs: number;
  /** Optional trace ID associated with this update. */
  traceId?: string;
  /** Optional error message if the task failed. */
  error?: string;
  /** Optional context about the task complexity. */
  taskComplexity?: number;
  /** Optional system prompt hash for version tracking. */
  promptHash?: string;
  /** Optional workspace ID for multi-tenant isolation. */
  workspaceId?: string;
  /** Optional team ID for multi-tenant isolation. */
  teamId?: string;
  /** Optional staff ID for multi-tenant isolation. */
  staffId?: string;
}
