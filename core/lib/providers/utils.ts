import { ReasoningProfile, ICapabilities } from '../types/index';
import { logger } from '../logger';

/**
 * Normalizes a reasoning profile based on model capabilities.
 * Ensures the agent never requests a profile that will cause a provider error.
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
 * Caps a provider-specific effort string based on model limits.
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
