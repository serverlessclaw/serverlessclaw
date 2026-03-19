/**
 * Shared Agent Helper Utilities
 *
 * These functions extract common patterns from agent handlers to improve
 * AI-readability and reduce code duplication.
 *
 * NOTE: Heavy dependencies are loaded dynamically to reduce import depth
 * for context-analyzer scoring.
 */

import { logger } from '../logger';
import { TraceSource, AgentType, ReasoningProfile } from '../types/index';
import { AGENT_ERRORS } from '../constants';

/**
 * Extract the base userId by removing CONV# prefix if present.
 * Used by multiple agents to normalize userId handling.
 *
 * @param userId - The user identifier which may be prefixed with 'CONV#'.
 * @returns The normalized base user identifier.
 */
export function extractBaseUserId(userId: string): string {
  return userId.startsWith('CONV#') ? userId.split('#')[1] : userId;
}

/**
 * Extract and normalize payload from EventBridge event.
 * EventBridge wraps the payload in 'detail', but direct invocations pass it directly.
 *
 * @param event - The input object which may be an EventBridge detail-wrapped event or a direct payload.
 * @returns The extracted payload.
 * @since 2026-03-19
 */
export function extractPayload<T extends object>(event: { detail?: T } | T): T {
  return (event as { detail?: T }).detail ?? (event as T);
}

/**
 * Detect if an agent response indicates an internal error.
 * Used consistently across all agents to determine failure state.
 *
 * @param response - The string response from the agent.
 * @returns True if the response indicates a failure, false otherwise.
 */
export function detectFailure(response: string): boolean {
  return (
    response === AGENT_ERRORS.PROCESS_FAILURE ||
    response.startsWith('I encountered an internal error')
  );
}

/**
 * Check if response indicates a paused task (should not emit completion event).
 * This is used to maintain state across async operations.
 *
 * @param response - The string response from the agent.
 * @returns True if the task is paused, false otherwise.
 */
export function isTaskPaused(response: string): boolean {
  return response.startsWith('TASK_PAUSED');
}

/**
 * Load and validate agent configuration from the registry.
 * Throws if config is not found or agent is disabled.
 *
 * @param agentId - The identifier or type of the agent.
 * @returns A promise resolving to the agent configuration.
 */
export async function loadAgentConfig(
  agentId: string | AgentType
): Promise<import('../types/index').IAgentConfig> {
  const { AgentRegistry } = await import('../registry');
  const config = await AgentRegistry.getAgentConfig(agentId);

  if (!config) {
    throw new Error(`Agent configuration for '${agentId}' not found in Registry`);
  }

  if (!config.enabled) {
    throw new Error(`Agent '${agentId}' is disabled`);
  }

  return config;
}

/**
 * Create an Agent instance with tools and configuration.
 * This encapsulates the common agent initialization pattern.
 *
 * @param agentId - The unique identifier for the agent.
 * @param config - The agent configuration object.
 * @param memory - The memory provider instance.
 * @param provider - The model provider manager instance.
 * @returns A promise resolving to the initialized Agent instance.
 */
export async function createAgent(
  agentId: string,
  config: import('../types/index').IAgentConfig,
  memory: import('../memory').DynamoMemory,
  provider: import('../providers/index').ProviderManager
): Promise<import('../agent').Agent> {
  const { getAgentTools } = await import('../../tools/index');
  const { Agent } = await import('../agent');
  const agentTools = await getAgentTools(agentId);
  return new Agent(memory, provider, agentTools, config.systemPrompt, config);
}

/** Options for building process options */
export interface ProcessOptionsParams {
  isContinuation?: boolean;
  isIsolated?: boolean;
  initiatorId?: string;
  depth?: number;
  traceId?: string;
  sessionId?: string;
  source?: TraceSource;
  profile?: ReasoningProfile;
  context?: import('aws-lambda').Context;
  responseFormat?: import('../types/index').ResponseFormat;
  communicationMode?: 'json' | 'text';
}

/**
 * Build a common process options object for agent.process() calls.
 * Reduces duplication in the agent execution pattern.
 *
 * @param params - The input parameters for building process options.
 * @returns A process options object.
 */
export function buildProcessOptions(params: ProcessOptionsParams): {
  isContinuation?: boolean;
  isIsolated?: boolean;
  initiatorId?: string;
  depth?: number;
  traceId?: string;
  sessionId?: string;
  source?: TraceSource;
  profile?: ReasoningProfile;
  context?: import('aws-lambda').Context;
  responseFormat?: import('../types/index').ResponseFormat;
  communicationMode?: 'json' | 'text';
} {
  return {
    isContinuation: !!params.isContinuation,
    isIsolated: params.isIsolated ?? true,
    initiatorId: params.initiatorId,
    depth: params.depth,
    traceId: params.traceId,
    sessionId: params.sessionId,
    source: params.source ?? TraceSource.SYSTEM,
    profile: params.profile,
    context: params.context,
    responseFormat: params.responseFormat,
    communicationMode: params.communicationMode,
  };
}

/**
 * Validate required fields in agent payload.
 * Returns true if valid, false otherwise.
 *
 * @param payload - The payload object to validate.
 * @param requiredFields - The list of field names that must be present.
 * @returns True if all required fields are present, false otherwise.
 */
export function validatePayload(
  payload: Record<string, unknown>,
  requiredFields: string[]
): boolean {
  for (const field of requiredFields) {
    if (!payload[field]) {
      logger.error(`Invalid event payload: missing ${field}`);
      return false;
    }
  }
  return true;
}

/**
 * Get the agent context (memory, provider) lazily.
 *
 * @returns A promise resolving to the agent context object containing memory and provider instances.
 */
export async function getAgentContext(): Promise<{
  memory: import('../memory').DynamoMemory;
  provider: import('../providers/index').ProviderManager;
}> {
  const { DynamoMemory } = await import('../memory');
  const { ProviderManager } = await import('../providers/index');

  // Singleton pattern
  if (!(global as unknown as { _agentMemory?: import('../memory').DynamoMemory })._agentMemory) {
    (global as unknown as { _agentMemory: import('../memory').DynamoMemory })._agentMemory =
      new DynamoMemory();
  }
  if (
    !(global as unknown as { _agentProvider?: import('../providers/index').ProviderManager })
      ._agentProvider
  ) {
    (
      global as unknown as { _agentProvider: import('../providers/index').ProviderManager }
    )._agentProvider = new ProviderManager();
  }

  return {
    memory: (global as unknown as { _agentMemory: import('../memory').DynamoMemory })._agentMemory,
    provider: (
      global as unknown as { _agentProvider: import('../providers/index').ProviderManager }
    )._agentProvider,
  };
}
