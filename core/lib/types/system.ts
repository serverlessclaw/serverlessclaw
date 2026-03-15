/**
 * Interface for managing distributed locks to prevent race conditions.
 */
export interface ILockManager {
  /**
   * Attempts to acquire a lock.
   *
   * @param lockId - Unique identifier for the lock.
   * @param ttlSeconds - Time-to-live for the lock in seconds.
   * @returns A promise resolving to true if the lock was acquired, false otherwise.
   */
  acquire(lockId: string, ttlSeconds: number): Promise<boolean>;
  /**
   * Releases a previously acquired lock.
   *
   * @param lockId - Unique identifier for the lock.
   */
  release(lockId: string): Promise<void>;
}

/**
 * Representation of AWS resources available via the SST framework.
 */
export interface SSTResource {
  /** DynamoDB table for long-term memory. */
  MemoryTable: { name: string };
  /** DynamoDB table for execution traces. */
  TraceTable: { name: string };
  /** DynamoDB table for system configuration. */
  ConfigTable: { name: string };
  /** S3 bucket for deployment artifacts. */
  StagingBucket: { name: string };
  /** EventBridge bus for inter-agent communication. */
  AgentBus: { name: string };
  /** API Gateway URL for external webhooks. */
  WebhookApi: { url: string };
  /** CodeBuild project for automated deployments. */
  Deployer: { name: string };
  /** Secret: Telegram bot authentication token. */
  TelegramBotToken: { value: string };
  /** Secret: OpenAI API authentication key. */
  OpenAIApiKey: { value: string };
  /** Secret: OpenRouter API authentication key. */
  OpenRouterApiKey: { value: string };
  /** The AWS region where resources are deployed. */
  AwsRegion: { value: string };
}

/**
 * Metadata for a node in the system topology visualization.
 */
export interface TopologyNode {
  /** Unique ID of the node. */
  id: string;
  /** Broad category of the resource. */
  type: 'dashboard' | 'infra' | 'agent';
  /** Display label for the node. */
  label: string;
  /** Brief description of the node's function. */
  description?: string;
  /** Icon identifier for UI rendering. */
  icon?: string;
  /** Specific type of icon (e.g., 'lucide', 'custom'). */
  iconType?: string;
  /** Whether the node is currently operational. */
  enabled?: boolean;
  /** Whether this is a core system component. */
  isBackbone?: boolean;
  /** Vertical placement tier. */
  tier?: 'APP' | 'COMM' | 'AGENT' | 'INFRA';
}

/**
 * Metadata for a connection between nodes in the system topology.
 */
export interface TopologyEdge {
  /** Unique ID of the edge. */
  id: string;
  /** ID of the source node. */
  source: string;
  /** ID of the target node. */
  target: string;
  /** Optional semantic label for the connection. */
  label?: string;
  /** Optional category of the connection (e.g., 'event', 'data'). */
  type?: string;
}

/**
 * Full system graph representation.
 */
export interface Topology {
  /** All identified resource nodes. */
  nodes: TopologyNode[];
  /** All identified relationships between nodes. */
  edges: TopologyEdge[];
}

/**
 * Health status and telemetry for the system's "Self" mechanisms.
 */
export interface SelfVerificationStatus {
  evolution: {
    /** Total number of identified strategic gaps. */
    totalGaps: number;
    /** Number of gaps in OPEN or PROGRESS state. */
    activeGaps: number;
    /** Success rate of autonomous fix attempts. */
    fixSuccessRate: number;
  };
  resilience: {
    /** Is the circuit breaker currently engaged? */
    circuitBreakerActive: boolean;
    /** Current deployment count towards the daily limit. */
    deployCountToday: number;
    /** Is the health probe endpoint responding normally? */
    apiHealthy: boolean;
  };
  awareness: {
    /** Number of discovered infrastructure nodes. */
    nodeCount: number;
    /** Timestamp of the last successful infrastructure scan. */
    lastScanTimestamp?: string;
    /** Percentage of agents currently registered in the topology. */
    registryCoverage: number;
  };
}
