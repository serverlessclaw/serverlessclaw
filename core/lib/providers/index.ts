import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  LLMProvider,
  MessageChunk,
  ResponseFormat,
} from '../types/index';
import { Resource } from 'sst';

import { OpenAIProvider } from './openai';
import { OpenRouterProvider } from './openrouter';
import { BedrockProvider } from './bedrock';
import { MiniMaxProvider } from './minimax';
import { FallbackProvider } from './fallback';
import { SYSTEM, CONFIG_KEYS } from '../constants';
import { ConfigManager } from '../registry/config';

/**
 * ProviderManager handles the resolution and execution of LLM provider calls.
 * It acts as a central hub for switching between OpenAI, Bedrock, and OpenRouter.
 */
export class ProviderManager implements IProvider {
  /**
   * Resolves the active provider and model using a hierarchy:
   * 1. Direct overrides (parameters)
   * 2. Hot configuration (DynamoDB ConfigTable)
   * 3. SST Static Resources (if linked)
   * 4. System Constants (last resort)
   *
   * @param overrideProvider - Optional provider name to override defaults.
   * @param overrideModel - Optional model name to override defaults.
   * @returns A promise resolving to the active IProvider implementation.
   */
  static async getActiveProvider(
    overrideProvider?: string,
    overrideModel?: string
  ): Promise<IProvider> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = Resource as any;

    // Resolve Provider
    const providerType = (overrideProvider ??
      (await ConfigManager.getTypedConfig(
        CONFIG_KEYS.ACTIVE_PROVIDER,
        ('ActiveProvider' in resource ? resource.ActiveProvider.value : undefined) ??
          SYSTEM.DEFAULT_PROVIDER
      ))) as LLMProvider;

    // Resolve Model
    const model =
      overrideModel ??
      ((await ConfigManager.getRawConfig(CONFIG_KEYS.ACTIVE_MODEL)) as string) ??
      ('ActiveModel' in resource ? resource.ActiveModel.value : undefined);

    // B1: When no specific provider override is requested, use fallback chain
    // This wraps the primary provider with automatic failover to secondary providers
    if (!overrideProvider) {
      return this.createFallbackProvider(providerType);
    }

    // Specific provider requested — return it directly
    return this.createSingleProvider(providerType, model);
  }

  /**
   * Creates a single provider instance without fallback wrapping.
   */
  private static createSingleProvider(providerType: LLMProvider, model?: string): IProvider {
    switch (providerType) {
      case LLMProvider.BEDROCK:
        return new BedrockProvider(model ?? SYSTEM.DEFAULT_BEDROCK_MODEL);
      case LLMProvider.OPENROUTER:
        return new OpenRouterProvider(model ?? SYSTEM.DEFAULT_OPENROUTER_MODEL);
      case LLMProvider.MINIMAX:
        return new MiniMaxProvider(model ?? SYSTEM.DEFAULT_MINIMAX_MODEL);
      case LLMProvider.OPENAI:
      default:
        return new OpenAIProvider(model ?? SYSTEM.DEFAULT_OPENAI_MODEL);
    }
  }

  /**
   * Performs a completion call to the active LLM provider.
   *
   * @param messages - The conversation history.
   * @param tools - Optional tools available to the LLM.
   * @param profile - The desired reasoning profile.
   * @param model - Optional model override.
   * @param provider - Optional provider override.
   * @param responseFormat - Optional structured output format.
   * @param temperature - Optional sampling temperature.
   * @param maxTokens - Optional maximum tokens.
   * @param topP - Optional nucleus sampling probability.
   * @param stopSequences - Optional stop sequences.
   * @returns A promise resolving to the AI response message.
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
    const activeProvider = await ProviderManager.getActiveProvider(provider, model);
    return activeProvider.call(
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

  /**
   * Performs a streaming completion call to the active LLM provider.
   *
   * @param messages - The conversation history.
   * @param tools - Optional tools available to the LLM.
   * @param profile - The desired reasoning profile.
   * @param model - Optional model override.
   * @param provider - Optional provider override.
   * @param responseFormat - Optional structured output format.
   * @param temperature - Optional sampling temperature.
   * @param maxTokens - Optional maximum tokens.
   * @param topP - Optional nucleus sampling probability.
   * @param stopSequences - Optional stop sequences.
   * @returns An AsyncIterable yielding message chunks.
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
    const activeProvider = await ProviderManager.getActiveProvider(provider, model);
    yield* activeProvider.stream(
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

  /**
   * Retrieves the capabilities of the active model.
   *
   * @param model - Optional model identifier.
   * @returns A promise resolving to the capabilities of the model.
   */
  async getCapabilities(model?: string) {
    const provider = await ProviderManager.getActiveProvider(undefined, model);
    return provider.getCapabilities(model);
  }

  /**
   * Returns the name of the active provider.
   */
  async getActiveProviderName(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = Resource as any;
    return (await ConfigManager.getTypedConfig(
      CONFIG_KEYS.ACTIVE_PROVIDER,
      ('ActiveProvider' in resource ? resource.ActiveProvider.value : undefined) ??
        SYSTEM.DEFAULT_PROVIDER
    )) as string;
  }

  /**
   * Returns the name of the active model.
   */
  async getActiveModelName(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = Resource as any;
    return (
      ((await ConfigManager.getRawConfig(CONFIG_KEYS.ACTIVE_MODEL)) as string) ??
      ('ActiveModel' in resource ? resource.ActiveModel.value : undefined) ??
      SYSTEM.DEFAULT_MINIMAX_MODEL
    );
  }

  /**
   * Creates a FallbackProvider with automatic failover chain.
   * Uses the configured primary provider with intelligent fallbacks.
   *
   * @param primary - The primary provider type (defaults to configured active provider).
   * @param fallbacks - Ordered list of fallback providers (defaults to sensible chain).
   * @returns A FallbackProvider instance with circuit breaker protection.
   */
  static async createFallbackProvider(
    primary?: LLMProvider,
    fallbacks?: LLMProvider[]
  ): Promise<FallbackProvider> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = Resource as any;

    // Resolve primary provider, defaulting to MINIMAX if not configured
    let primaryProvider = primary;
    if (!primaryProvider) {
      const configValue = await ConfigManager.getTypedConfig(
        CONFIG_KEYS.ACTIVE_PROVIDER,
        undefined
      );
      // Use SST Resource value if available, otherwise default to MINIMAX
      const sstProvider =
        'ActiveProvider' in resource ? (resource.ActiveProvider.value as LLMProvider) : undefined;
      primaryProvider =
        (configValue as unknown as LLMProvider) ?? sstProvider ?? LLMProvider.MINIMAX;
    }

    // Default fallback chain: OpenAI → Bedrock → OpenRouter → MiniMax
    const defaultFallbacks: LLMProvider[] = [
      LLMProvider.OPENAI,
      LLMProvider.BEDROCK,
      LLMProvider.OPENROUTER,
      LLMProvider.MINIMAX,
    ].filter((p) => p !== primaryProvider);

    return new FallbackProvider({
      primary: primaryProvider,
      fallbacks: fallbacks ?? defaultFallbacks,
    });
  }
}
