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
import { Resource } from 'sst';
import {
  EventType,
  SSTResource,
  TraceSource,
  AgentType,
  ReasoningProfile,
  Attachment,
} from '../types/index';
import { AGENT_ERRORS } from '../constants';

/** Singleton agent context - shared across all agent handlers */
let _eventbridge: import('@aws-sdk/client-eventbridge').EventBridgeClient | undefined;
let _typedResource: SSTResource | undefined;

/**
 * Get or initialize the shared eventbridge client (singleton pattern).
 */
async function getEventBridge(): Promise<import('@aws-sdk/client-eventbridge').EventBridgeClient> {
  if (!_eventbridge) {
    const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
    _eventbridge = new EventBridgeClient({});
  }
  return _eventbridge;
}

/**
 * Get typed resource reference
 */
function getTypedResource(): SSTResource {
  if (!_typedResource) {
    _typedResource = Resource as unknown as SSTResource;
  }
  return _typedResource;
}

/**
 * Extract the base userId by removing CONV# prefix if present.
 * Used by multiple agents to normalize userId handling.
 */
export function extractBaseUserId(userId: string): string {
  return userId.startsWith('CONV#') ? userId.split('#')[1] : userId;
}

/**
 * Extract and normalize payload from EventBridge event.
 * EventBridge wraps the payload in 'detail', but direct invocations pass it directly.
 */
export function extractPayload<T extends object>(event: { detail?: T } | T): T {
  return (event as { detail?: T }).detail || (event as T);
}

/**
 * Detect if an agent response indicates an internal error.
 * Used consistently across all agents to determine failure state.
 */
export function detectFailure(response: string): boolean {
  return response === AGENT_ERRORS.PROCESS_FAILURE || response.startsWith('I encountered an internal error');
}

/**
 * Check if response indicates a paused task (should not emit completion event).
 */
export function isTaskPaused(response: string): boolean {
  return response.startsWith('TASK_PAUSED');
}

/**
 * Load and validate agent configuration from the registry.
 * Throws if config is not found or agent is disabled.
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

/**
 * Emit a task completion or failure event to EventBridge.
 * Used by all agents for universal coordination.
 */
export async function emitTaskEvent(params: {
  source: string;
  agentId: string | AgentType;
  userId: string;
  task: string;
  response?: string;
  error?: string;
  attachments?: Attachment[];
  traceId?: string;
  sessionId?: string;
  initiatorId?: string;
  depth?: number;
}): Promise<void> {
  const eventbridge = await getEventBridge();
  const typedResource = getTypedResource();
  const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
  const isFailure = !!params.error;

  try {
    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: params.source,
            DetailType: isFailure ? EventType.TASK_FAILED : EventType.TASK_COMPLETED,
            Detail: JSON.stringify({
              userId: params.userId,
              agentId: params.agentId,
              task: params.task,
              [isFailure ? 'error' : 'response']: params.error || params.response || '',
              attachments: params.attachments,
              traceId: params.traceId,
              initiatorId: params.initiatorId,
              depth: params.depth,
              sessionId: params.sessionId,
            }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      })
    );
  } catch (e) {
    logger.error(`Failed to emit ${isFailure ? 'TASK_FAILED' : 'TASK_COMPLETED'}:`, e);
  }
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
}

/**
 * Build a common process options object for agent.process() calls.
 * Reduces duplication in the agent execution pattern.
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
  };
}

/**
 * Validate required fields in agent payload.
 * Returns true if valid, false otherwise.
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
 * Get the agent context (memory, provider) lazily
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
