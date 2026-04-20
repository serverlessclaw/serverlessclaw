import { ReasoningProfile, ICapabilities } from '../types/llm';
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

import { Resource } from 'sst';

export function isPlaceholderApiKey(value?: string): boolean {
  if (!value) return true;

  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === 'dummy' ||
    normalized === 'test' ||
    normalized === 'test-key'
  );
}

/**
 * Resolves the API key for a provider by checking SST Resources and Environment Variables.
 * Deduplicates API key resolution logic across providers.
 *
 * @param providerName - The name of the provider (e.g., 'OpenAI').
 * @param sstKeyName - The key name in the SST Resource object (e.g., 'OpenAIApiKey').
 * @param envKeyName - The fallback environment variable name (e.g., 'OPENAI_API_KEY').
 * @returns The resolved API key.
 * @throws Error if no valid API key is found.
 */
export function resolveProviderApiKey(
  providerName: string,
  sstKeyName: string,
  envKeyName: string
): string {
  const resource = Resource as unknown as Record<string, { value?: string } | undefined>;
  const linkedKey = resource[sstKeyName]?.value;
  const directEnvKey = process.env[envKeyName];
  const sstSecretEnvKey = process.env[`SST_SECRET_${sstKeyName}`];

  const candidates = [linkedKey, directEnvKey, sstSecretEnvKey];
  const resolved = candidates.find((key) => !isPlaceholderApiKey(key));

  if (!resolved) {
    throw new Error(
      `${providerName} API key is not configured. Set SST_SECRET_${sstKeyName} (preferred for make dev) or ${envKeyName}.`
    );
  }

  return resolved;
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
