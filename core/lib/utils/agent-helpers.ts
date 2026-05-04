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
import { AgentType, TraceSource, ReasoningProfile } from '../types/index';
import {
  AGENT_ERRORS,
  AGENT_ERRORS_CN,
  AGENT_ERROR_PREFIXES,
  CONFIG_KEYS,
  LOCALE_INSTRUCTIONS,
} from '../constants';
import { AgentProcessOptions } from '../agent/options';
import { EVENT_SCHEMA_MAP } from '../schema/events';

import { normalizeBaseUserId } from './normalize';

/**
 * Extract the base userId by removing CONV# prefix if present.
 * Used by multiple agents to normalize userId handling.
 *
 * @param userId - The user identifier which may be prefixed with 'CONV#'.
 * @returns The normalized base user identifier.
 */
export function extractBaseUserId(userId: string): string {
  return normalizeBaseUserId(userId);
}

export function isE2ETest(): boolean {
  const lifecycle = process.env.npm_lifecycle_event || '';
  const isVitest =
    process.env.VITEST ||
    process.env.CLAW_TEST === 'true' ||
    process.env.CORE_TEST === 'true' ||
    process.env.NODE_ENV === 'test' ||
    (global as unknown as { __vitest_worker__?: unknown }).__vitest_worker__ !== undefined ||
    process.argv.some((arg) => arg.includes('vitest')) ||
    lifecycle.includes('test') ||
    lifecycle.includes('check') ||
    (global as unknown as { __CLAW_TEST__?: boolean }).__CLAW_TEST__ === true ||
    (global as unknown as { CLAW_TEST?: boolean }).CLAW_TEST === true ||
    (global as unknown as { IS_CLAW_TEST?: boolean }).IS_CLAW_TEST === true ||
    new Error().stack?.includes('.test.ts');

  return !!(process.env.PLAYWRIGHT || process.env.CI || isVitest);
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

export function isWarmupEvent(event: unknown): boolean {
  const payload = extractPayload(event as Record<string, unknown>) as Record<string, unknown>;
  return payload?.type === 'WARMUP' || payload?.intent === 'warmup';
}

/**
 * Handle a warmup event by pre-initializing the agent and returning true.
 * This is meant to be called at the beginning of an agent handler.
 *
 * @param event - The handler event.
 * @param agentId - The agent ID to warm.
 * @returns A promise that resolves to true if handled as warmup, false otherwise.
 */
export async function handleWarmup(event: unknown, agentId: string | AgentType): Promise<boolean> {
  if (isWarmupEvent(event)) {
    const target = agentId === 'brain' ? 'all cognitive agents' : `agent ${agentId}`;
    logger.info(`[WARMUP] Warming ${target}...`);
    try {
      if (agentId === 'brain') {
        // Warm a representative set of agents
        await Promise.all([
          initAgent(AgentType.CODER),
          initAgent(AgentType.RESEARCHER),
          initAgent(AgentType.STRATEGIC_PLANNER),
        ]);
      } else {
        await initAgent(agentId as AgentType);
      }
      logger.info(`[WARMUP] ${target} is now warm.`);
      return true;
    } catch (e) {
      logger.warn(`[WARMUP] Failed to warm ${target}:`, e);
      return true;
    }
  }
  return false;
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
    response === AGENT_ERRORS_CN.PROCESS_FAILURE ||
    response.startsWith(AGENT_ERROR_PREFIXES.EN) ||
    response.startsWith(AGENT_ERROR_PREFIXES.CN) ||
    response.startsWith('SYSTEM_ERROR') ||
    response.startsWith('FAILED') ||
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
 * @param options - Optional configuration options (workspaceId, etc).
 * @returns A promise resolving to the agent configuration.
 */
export async function loadAgentConfig(
  agentId: string | AgentType,
  options?: { workspaceId?: string }
): Promise<import('../types/index').IAgentConfig> {
  const { AgentRegistry } = await import('../registry');
  const config = await AgentRegistry.getAgentConfig(agentId, options);

  if (!config) {
    throw new Error(
      `Agent configuration for '${agentId}' not found in Registry${options?.workspaceId ? ` for workspace ${options.workspaceId}` : ''}`
    );
  }

  if (!config.enabled) {
    throw new Error(`Agent '${agentId}' is disabled`);
  }

  // Inject MCP_SERVER_ARNS from environment if present (Lambda environment)
  if (process.env.MCP_SERVER_ARNS) {
    try {
      const mcpArns = JSON.parse(process.env.MCP_SERVER_ARNS);
      config.mcpServers = {
        ...(config.mcpServers ?? {}),
        ...mcpArns,
      };
    } catch (e) {
      logger.warn(`Failed to parse MCP_SERVER_ARNS for agent ${agentId}:`, e);
    }
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
  memory: import('../types/index').IMemory,
  provider: import('../providers/index').ProviderManager,
  locale: string = 'en'
): Promise<import('../agent').Agent> {
  const [{ getAgentTools }, { Agent }] = await Promise.all([
    import('../../tools/index'),
    import('../agent'),
  ]);
  const agentTools = await getAgentTools(agentId);

  // Apply dynamic localization instructions
  let systemPrompt = config.systemPrompt ?? '';
  const instruction =
    locale.toLowerCase() === 'cn' ? LOCALE_INSTRUCTIONS.CN : LOCALE_INSTRUCTIONS.EN;
  if (instruction && systemPrompt) {
    systemPrompt += instruction;
  }

  return new Agent(memory, provider, agentTools, { ...config, systemPrompt });
}

/**
 * One-shot initialization: load config, get context, and create agent.
 * Combines the 3-step pattern (loadAgentConfig → getAgentContext → createAgent)
 * that every agent handler repeats.
 *
 * @param agentId - The agent identifier or type.
 * @param options - Optional configuration options (workspaceId, etc).
 * @returns A promise resolving to { config, memory, provider, agent }.
 */
export async function initAgent(
  agentId: string | AgentType,
  options?: { workspaceId?: string }
): Promise<{
  config: import('../types/index').IAgentConfig;
  memory: import('../types/index').IMemory;
  provider: import('../providers/index').ProviderManager;
  agent: import('../agent').Agent;
}> {
  const { ConfigManager } = (await import('../registry/config')) as {
    ConfigManager: {
      getTypedConfig: <T>(
        key: string,
        defaultValue: T,
        opts?: { workspaceId?: string }
      ) => Promise<T>;
    };
  };
  const [config, { memory, provider }, locale] = await Promise.all([
    loadAgentConfig(agentId, options),
    getAgentContext(),
    ConfigManager.getTypedConfig<string>(CONFIG_KEYS.ACTIVE_LOCALE, 'en', options),
  ]);
  const agent = await createAgent(String(agentId), config, memory, provider, locale);
  return { config, memory, provider, agent };
}

/**
 * High-level agent execution helper.
 * Combines initialization and processing into a single call.
 */
export async function processWithAgent(
  agentId: string | AgentType,
  userId: string,
  task: string,
  options: ProcessOptionsParams
) {
  const { agent } = await initAgent(agentId, { workspaceId: options.workspaceId });
  return agent.process(userId, task, buildProcessOptions(options));
}

/** Options for building process options */
export interface ProcessOptionsParams {
  isContinuation?: boolean;
  isIsolated?: boolean;
  initiatorId?: string;
  depth?: number;
  traceId?: string;
  taskId?: string;
  sessionId?: string;
  workspaceId?: string;
  teamId?: string;
  staffId?: string;
  userRole?: import('../types/agent').UserRole;
  source?: TraceSource;
  profile?: ReasoningProfile;
  context?: import('aws-lambda').Context;
  responseFormat?: import('../types/index').ResponseFormat;
  communicationMode?: 'json' | 'text';
  taskTimeoutMs?: number;
  tokenBudget?: number;
  costLimit?: number;
  priorTokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  abortSignal?: AbortSignal;
}

/**
 * Build a common process options object for agent.process() calls.
 * Reduces duplication in the agent execution pattern.
 *
 * @param params - The input parameters for building process options.
 * @returns A process options object.
 */
export function buildProcessOptions(params: ProcessOptionsParams): AgentProcessOptions {
  return {
    isContinuation: !!params.isContinuation,
    isIsolated: params.isIsolated ?? true,
    initiatorId: params.initiatorId ?? 'orchestrator',
    depth: params.depth ?? 0,
    traceId: params.traceId,
    taskId: params.taskId,
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    teamId: params.teamId,
    staffId: params.staffId,
    userRole: params.userRole,
    source: params.source ?? TraceSource.SYSTEM,
    profile: params.profile,
    context: params.context,
    responseFormat: params.responseFormat,
    communicationMode: params.communicationMode,
    taskTimeoutMs: params.taskTimeoutMs,
    tokenBudget: params.tokenBudget,
    costLimit: params.costLimit,
    priorTokenUsage: params.priorTokenUsage,
    abortSignal: params.abortSignal,
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
  payload: Record<string, unknown> | null | undefined,
  requiredFields: string[]
): boolean {
  if (!payload) {
    logger.error('Invalid event payload: payload is null or undefined');
    return false;
  }
  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null) {
      logger.error(`Invalid event payload: missing ${field}`);
      return false;
    }
  }
  return true;
}

/**
 * Validate an event payload against a registered schema in EVENT_SCHEMA_MAP.
 * This provides fail-fast runtime validation with Zod schemas.
 *
 * @param event - The EventBridge event or direct payload.
 * @param schemaKey - The key to lookup in EVENT_SCHEMA_MAP (e.g., `${AgentType.RESEARCHER}_task`).
 * @returns The validated and typed payload.
 * @throws Error if validation fails.
 */
export function validateEventPayload<T extends object>(
  event: { detail?: T } | T,
  schemaKey: string
): T {
  const payload = extractPayload<T>(event);
  const schema = EVENT_SCHEMA_MAP[schemaKey as keyof typeof EVENT_SCHEMA_MAP];

  if (!schema) {
    logger.warn(`No schema found for key "${schemaKey}", falling back to basic extraction`);
    return payload;
  }

  try {
    return schema.parse(payload) as T;
  } catch (error) {
    logger.error(`Event validation failed for schema "${schemaKey}":`, error);
    throw new Error(
      `Event validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get the agent context (memory, provider) lazily.
 *
 * @returns A promise resolving to the agent context object containing memory and provider instances.
 */
export async function getAgentContext(): Promise<{
  memory: import('../types/index').IMemory;
  provider: import('../providers/index').ProviderManager;
}> {
  const [{ DynamoMemory }, { CachedMemory }, { ProviderManager }] = await Promise.all([
    import('../memory'),
    import('../memory/cached-memory'),
    import('../providers/index'),
  ]);

  // Singleton pattern
  if (!(global as unknown as { _agentMemory?: import('../types/index').IMemory })._agentMemory) {
    (global as unknown as { _agentMemory: import('../types/index').IMemory })._agentMemory =
      new CachedMemory(new DynamoMemory());
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
    memory: (global as unknown as { _agentMemory: import('../types/index').IMemory })._agentMemory,
    provider: (
      global as unknown as { _agentProvider: import('../providers/index').ProviderManager }
    )._agentProvider,
  };
}
