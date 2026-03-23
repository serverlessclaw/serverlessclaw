/**
 * Provider-Specific Context Strategies
 *
 * Defines context window limits, safety margins, and prioritization strategies
 * for different LLM providers and models.
 */

export interface ProviderContextStrategy {
  maxContextTokens: number;
  reservedResponseTokens: number;
  compressionTriggerPercent: number; // When to start compressing
  toolResultPriority: 'high' | 'normal'; // Keep tool results or compress them
}

export const PROVIDER_STRATEGIES: Record<string, ProviderContextStrategy> = {
  'gpt-4o': {
    maxContextTokens: 128000,
    reservedResponseTokens: 4096,
    compressionTriggerPercent: 80,
    toolResultPriority: 'high',
  },
  'gpt-4o-mini': {
    maxContextTokens: 128000,
    reservedResponseTokens: 4096,
    compressionTriggerPercent: 85,
    toolResultPriority: 'normal',
  },
  'claude-3-5-sonnet-20240620': {
    maxContextTokens: 200000,
    reservedResponseTokens: 8192,
    compressionTriggerPercent: 80,
    toolResultPriority: 'high',
  },
  'claude-3-haiku-20240307': {
    maxContextTokens: 200000,
    reservedResponseTokens: 4096,
    compressionTriggerPercent: 85,
    toolResultPriority: 'normal',
  },
  default: {
    maxContextTokens: 128000,
    reservedResponseTokens: 4096,
    compressionTriggerPercent: 80,
    toolResultPriority: 'normal',
  },
};

/**
 * Retrieves the strategy for a given model or provider.
 */
export function getContextStrategy(model?: string, provider?: string): ProviderContextStrategy {
  if (model && PROVIDER_STRATEGIES[model]) {
    return PROVIDER_STRATEGIES[model];
  }

  if (provider && PROVIDER_STRATEGIES[provider]) {
    return PROVIDER_STRATEGIES[provider];
  }

  return PROVIDER_STRATEGIES.default;
}
