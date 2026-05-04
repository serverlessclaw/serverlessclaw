import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageChunk,
  ResponseFormat,
  ICapabilities,
  LLMProvider,
} from '../types/index';
import { logger } from '../logger';
import { OpenAIProvider } from './openai';
import { BedrockProvider } from './bedrock';
import { OpenRouterProvider } from './openrouter';
import { MiniMaxProvider } from './minimax';

/**
 * Health state for a provider circuit breaker.
 */
interface ProviderHealth {
  /** Whether the provider is currently considered healthy. */
  healthy: boolean;
  /** Number of consecutive failures. */
  consecutiveFailures: number;
  /** Timestamp of the last failure. */
  lastFailureTime: number;
  /** Timestamp when the provider should be retried (after cooldown). */
  retryAfter: number;
}

/**
 * Configuration for the fallback provider chain.
 */
interface FallbackConfig {
  /** Primary provider type. */
  primary: LLMProvider;
  /** Ordered list of fallback provider types. */
  fallbacks: LLMProvider[];
  /** Model to use for each provider (optional). */
  models?: Partial<Record<LLMProvider, string>>;
  /** Number of consecutive failures before circuit opens (default: 3). */
  failureThreshold?: number;
  /** Cooldown period in ms before retrying a failed provider (default: 30000). */
  cooldownMs?: number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30000; // 30 seconds

/**
 * LLM Provider with automatic fallback chain.
 * Wraps multiple providers and automatically fails over when the primary is down.
 *
 * Features:
 * - Circuit breaker per provider (tracks consecutive failures)
 * - Automatic failover to secondary/tertiary providers
 * - Health tracking with cooldown-based recovery
 * - Detailed logging for debugging provider issues
 */
export class FallbackProvider implements IProvider {
  private healthMap: Map<LLMProvider, ProviderHealth>;
  private providers: Map<LLMProvider, IProvider>;
  private config: FallbackConfig;

  constructor(config: FallbackConfig) {
    this.config = config;
    this.healthMap = new Map();
    this.providers = new Map();

    // Initialize all providers and health states
    const allProviders = [config.primary, ...config.fallbacks];
    for (const providerType of allProviders) {
      this.providers.set(providerType, this.createProvider(providerType));
      this.healthMap.set(providerType, {
        healthy: true,
        consecutiveFailures: 0,
        lastFailureTime: 0,
        retryAfter: 0,
      });
    }

    logger.info(
      `[FallbackProvider] Initialized with primary=${config.primary}, fallbacks=${config.fallbacks.join(', ')}`
    );
  }

  /**
   * Creates a provider instance for the given type.
   */
  private createProvider(type: LLMProvider): IProvider {
    const model = this.config.models?.[type];
    switch (type) {
      case LLMProvider.OPENAI:
        return new OpenAIProvider(model);
      case LLMProvider.BEDROCK:
        return new BedrockProvider(model);
      case LLMProvider.OPENROUTER:
        return new OpenRouterProvider(model);
      case LLMProvider.MINIMAX:
        return new MiniMaxProvider(model);
      case LLMProvider.ANTHROPIC:
        logger.warn('[FallbackProvider] ANTHROPIC provider not directly supported, using Bedrock');
        return new BedrockProvider(model);
      case LLMProvider.MOCK:
        return {
          call: async () => ({ role: 'assistant' as const, content: 'Mock response' }),
          stream: async function* () {
            yield { role: 'assistant' as const, content: 'Mock' };
          },
          getCapabilities: async () => ({
            maxTokens: 4096,
            supportsVision: false,
            supportsTools: false,
          }),
        } as unknown as IProvider;
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  /**
   * Gets the next healthy provider from the chain.
   * Returns null if all providers are unhealthy.
   */
  private getNextHealthyProvider(): { type: LLMProvider; provider: IProvider } | null {
    const now = Date.now();
    const allProviders = [this.config.primary, ...this.config.fallbacks];

    for (const providerType of allProviders) {
      const health = this.healthMap.get(providerType)!;

      // Check if provider is healthy or cooldown has expired
      if (health.healthy || now >= health.retryAfter) {
        // Reset health if cooldown expired
        if (!health.healthy && now >= health.retryAfter) {
          health.healthy = true;
          health.consecutiveFailures = 0;
          logger.info(
            `[FallbackProvider] Provider ${providerType} cooldown expired, marking as healthy`
          );
        }

        return {
          type: providerType,
          provider: this.providers.get(providerType)!,
        };
      }
    }

    return null;
  }

  /**
   * Marks a provider as failed and updates circuit breaker state.
   */
  private markFailure(providerType: LLMProvider): void {
    const health = this.healthMap.get(providerType)!;
    health.consecutiveFailures++;
    health.lastFailureTime = Date.now();

    const threshold = this.config.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    if (health.consecutiveFailures >= threshold) {
      health.healthy = false;
      health.retryAfter = Date.now() + (this.config.cooldownMs ?? DEFAULT_COOLDOWN_MS);
      logger.warn(
        `[FallbackProvider] Circuit OPEN for ${providerType} after ${health.consecutiveFailures} failures. Retry after ${new Date(health.retryAfter).toISOString()}`
      );
    }
  }

  /**
   * Marks a provider as successful and resets circuit breaker.
   */
  private markSuccess(providerType: LLMProvider): void {
    const health = this.healthMap.get(providerType)!;
    if (health.consecutiveFailures > 0) {
      logger.info(
        `[FallbackProvider] Provider ${providerType} recovered after ${health.consecutiveFailures} failures`
      );
    }
    health.healthy = true;
    health.consecutiveFailures = 0;
    health.retryAfter = 0;
  }

  /**
   * Performs a completion call with automatic fallback.
   */
  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    provider?: string,
    responseFormat?: ResponseFormat,
    temperature?: number,
    maxTokens?: number,
    topP?: number,
    stopSequences?: string[]
  ): Promise<Message> {
    // If a specific provider is requested, use it directly (no fallback)
    if (provider) {
      const specificProvider = this.providers.get(provider as LLMProvider);
      if (specificProvider) {
        return specificProvider.call(
          messages,
          tools,
          profile,
          model,
          undefined,
          responseFormat,
          temperature,
          maxTokens,
          topP,
          stopSequences
        );
      }
    }

    const errors: Array<{ provider: LLMProvider; error: string }> = [];

    // Try each provider in the chain
    const allProviders = [this.config.primary, ...this.config.fallbacks];
    for (const providerType of allProviders) {
      const health = this.healthMap.get(providerType)!;
      const now = Date.now();

      // Skip if circuit is open and cooldown hasn't expired
      if (!health.healthy && now < health.retryAfter) {
        continue;
      }

      const providerInstance = this.providers.get(providerType)!;

      try {
        logger.debug(`[FallbackProvider] Attempting call with ${providerType}`);
        const result = await providerInstance.call(
          messages,
          tools,
          profile,
          model ?? this.config.models?.[providerType],
          undefined,
          responseFormat,
          temperature,
          maxTokens,
          topP,
          stopSequences
        );

        this.markSuccess(providerType);
        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[FallbackProvider] ${providerType} call failed: ${errorMsg}`);
        errors.push({ provider: providerType, error: errorMsg });
        this.markFailure(providerType);
      }
    }

    // All providers failed
    const errorSummary = errors.map((e) => `${e.provider}: ${e.error}`).join('; ');
    throw new Error(`All LLM providers failed. Errors: ${errorSummary}`);
  }

  /**
   * Performs a streaming call with automatic fallback.
   */
  async *stream(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    provider?: string,
    responseFormat?: ResponseFormat,
    temperature?: number,
    maxTokens?: number,
    topP?: number,
    stopSequences?: string[]
  ): AsyncIterable<MessageChunk> {
    // If a specific provider is requested, use it directly (no fallback)
    if (provider) {
      const specificProvider = this.providers.get(provider as LLMProvider);
      if (specificProvider) {
        yield* specificProvider.stream(
          messages,
          tools,
          profile,
          model,
          undefined,
          responseFormat,
          temperature,
          maxTokens,
          topP,
          stopSequences
        );
        return;
      }
    }

    const errors: Array<{ provider: LLMProvider; error: string }> = [];

    // Try each provider in the chain
    const allProviders = [this.config.primary, ...this.config.fallbacks];
    for (const providerType of allProviders) {
      const health = this.healthMap.get(providerType)!;
      const now = Date.now();

      // Skip if circuit is open and cooldown hasn't expired
      if (!health.healthy && now < health.retryAfter) {
        continue;
      }

      const providerInstance = this.providers.get(providerType)!;

      try {
        logger.debug(`[FallbackProvider] Attempting stream with ${providerType}`);
        yield* providerInstance.stream(
          messages,
          tools,
          profile,
          model ?? this.config.models?.[providerType],
          undefined,
          responseFormat,
          temperature,
          maxTokens,
          topP,
          stopSequences
        );
        this.markSuccess(providerType);
        return;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[FallbackProvider] ${providerType} stream failed: ${errorMsg}`);
        errors.push({ provider: providerType, error: errorMsg });
        this.markFailure(providerType);
      }
    }

    // All providers failed
    const errorSummary = errors.map((e) => `${e.provider}: ${e.error}`).join('; ');
    throw new Error(`All LLM providers failed for streaming. Errors: ${errorSummary}`);
  }

  /**
   * Gets capabilities from the primary provider (or first healthy one).
   */
  async getCapabilities(model?: string): Promise<ICapabilities> {
    const healthy = this.getNextHealthyProvider();
    if (healthy) {
      return healthy.provider.getCapabilities(model);
    }

    // Fallback to primary provider capabilities
    const primaryProvider = this.providers.get(this.config.primary)!;
    return primaryProvider.getCapabilities(model);
  }

  /**
   * Returns the health status of all providers.
   */
  getHealthStatus(): Record<LLMProvider, ProviderHealth> {
    const status: Record<string, ProviderHealth> = {};
    for (const [type, health] of this.healthMap) {
      status[type] = { ...health };
    }
    return status as Record<LLMProvider, ProviderHealth>;
  }

  /**
   * Manually resets the circuit breaker for a specific provider.
   */
  resetProvider(providerType: LLMProvider): void {
    const health = this.healthMap.get(providerType);
    if (health) {
      health.healthy = true;
      health.consecutiveFailures = 0;
      health.retryAfter = 0;
      logger.info(`[FallbackProvider] Manually reset ${providerType}`);
    }
  }

  /**
   * Manually resets all circuit breakers.
   */
  resetAll(): void {
    for (const providerType of this.healthMap.keys()) {
      this.resetProvider(providerType);
    }
    logger.info('[FallbackProvider] Reset all provider circuit breakers');
  }
}
