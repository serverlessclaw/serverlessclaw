import { ReasoningProfile, ICapabilities, Message, MessageRole } from '../types/llm';
import { ITool } from '../types/tool';
import { logger } from '../logger';

/**
 * Transforms internal tools to OpenAI function format.
 * Consolidates tool transformation logic used in OpenAI and OpenRouter providers.
 *
 * @param tools - An array of internal tools to transform.
 * @returns An array of OpenAI-compatible function definitions.
 */
export function transformToolsToOpenAI(tools?: ITool[]): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: boolean;
  };
}> {
  if (!tools || tools.length === 0) return [];

  return tools
    .filter((t) => !t.type || t.type === 'function')
    .map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as Record<string, unknown>,
        strict: true,
      },
    }));
}

/**
 * Normalizes a reasoning profile based on model capabilities.
 * Ensures the agent never requests a profile that will cause a provider error.
 *
 * @param requested - The desired reasoning profile.
 * @param capabilities - The model capabilities object.
 * @param modelId - The model ID string for logging.
 * @returns The normalized reasoning profile.
 */
export function normalizeProfile(
  requested: ReasoningProfile,
  capabilities: ICapabilities,
  modelId: string
): ReasoningProfile {
  if (capabilities.supportedReasoningProfiles.includes(requested)) {
    return requested;
  }

  const profileLadder = [
    ReasoningProfile.DEEP,
    ReasoningProfile.THINKING,
    ReasoningProfile.STANDARD,
    ReasoningProfile.FAST,
  ];

  const startIndex = profileLadder.indexOf(requested);
  for (let i = startIndex + 1; i < profileLadder.length; i++) {
    const candidate = profileLadder[i];
    if (capabilities.supportedReasoningProfiles.includes(candidate)) {
      logger.info(
        `Profile ${requested} not supported for ${modelId}, falling back to ${candidate}`
      );
      return candidate;
    }
  }

  return ReasoningProfile.STANDARD;
}

/**
 * Generic effort levels used across OpenAI and OpenRouter.
 */
export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

/**
 * Supported image formats for provider attachments.
 * Consolidated from repeated definitions in bedrock.ts and other providers.
 */
export const SUPPORTED_IMAGE_FORMATS = ['png', 'jpeg', 'gif', 'webp'] as const;

/**
 * Caps a provider-specific effort string based on model limits.
 *
 * @param requested - The desired effort string.
 * @param max - The maximum supported effort string for the model.
 * @returns The capped effort string.
 */
export function capEffort(requested: string, max?: string): string {
  if (!max) return requested;

  const currentIndex = EFFORT_LEVELS.indexOf(requested);
  const maxIndex = EFFORT_LEVELS.indexOf(max);

  if (maxIndex !== -1 && currentIndex > maxIndex) {
    return max;
  }

  return requested;
}

/**
 * Creates a standardized empty response message.
 * Deduplicates empty response handling across all provider implementations.
 *
 * @param providerName - The name of the provider.
 * @param traceId - Optional trace ID for the message.
 * @param messageId - Optional unique ID for the message.
 * @returns A standardized empty response message.
 */
export function createEmptyResponse(
  providerName: string,
  traceId: string = 'system-empty-trace',
  messageId: string = `msg-${Date.now()}`
): Message {
  return {
    role: MessageRole.ASSISTANT,
    content: `Empty response from ${providerName}.`,
    traceId,
    messageId,
  };
}

/**
 * Parses a config value to integer with a fallback.
 * Deduplicates parseInt(String(value), 10) patterns across the codebase.
 *
 * @param value - The value to parse as an integer.
 * @param fallback - The value to return if parsing fails.
 * @returns The parsed integer or the fallback value.
 */
export function parseConfigInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) ? fallback : parsed;
}
