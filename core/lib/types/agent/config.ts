import { AgentCategory, SafetyTier, ConnectionProfile } from './constants';
import { EvolutionMode } from './status';

/**
 * Configuration interface for an Agent, defining its identity,
 * capabilities, and preferred reasoning behavior.
 */
export interface IAgentConfig {
  id: string;
  name: string;
  enabled: boolean;
  agentType?: 'llm' | 'logic';
  systemPrompt?: string;
  systemPrompts?: { en: string; cn: string };
  description?: string;
  category?: AgentCategory;
  icon?: string;
  model?: string;
  reasoningProfile?: import('../llm').ReasoningProfile;
  provider?: string;
  tools?: string[];
  isBackbone?: boolean;
  connectionProfile?: (ConnectionProfile | string)[];
  maxIterations?: number;
  parallelToolCalls?: boolean;
  defaultCommunicationMode?: 'json' | 'text';
  workspaceId?: string;
  orgId?: string;
  teamId?: string;
  staffId?: string;
  mcpServers?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  topologyOverride?: {
    label?: string;
    icon?: string;
    tier?: 'APP' | 'GATEWAY' | 'COMM' | 'AGENT' | 'UTILITY' | 'INFRA';
  };
  safetyTier?: SafetyTier;
  evolutionMode?: EvolutionMode;
  tokenBudget?: number;
  costLimit?: number;
  trustScore?: number;
  manuallyApproved?: boolean;
  version?: number;
  lastTraceId?: string;
  lastUpdated?: string;
  metadata?: Record<string, unknown>;
  workerFeedback?: boolean;
}

/**
 * Metadata for a dynamically installed skill with optional TTL.
 */
export interface InstalledSkill {
  name: string;
  expiresAt?: number;
}

/**
 * Structured output signal for agent orchestration.
 */
export interface AgentSignal {
  status: import('./status').AgentStatus;
  coveredGapIds?: string[];
  buildId?: string;
  reasoning: string;
}
