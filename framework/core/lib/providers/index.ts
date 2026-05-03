import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  LLMProvider,
  MessageChunk,
  ResponseFormat,
  MessageRole,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';

import { OpenAIProvider } from './openai';
import { OpenRouterProvider } from './openrouter';
import { BedrockProvider } from './bedrock';
import { MiniMaxProvider } from './minimax';
import { FallbackProvider } from './fallback';
import { SYSTEM, CONFIG_KEYS } from '../constants';
import { ConfigManager } from '../registry/config';
import { PluginManager } from '../plugin-manager';

function resolveTraceId(messages: Message[]): string {
  const initial = messages.find((m) => m.traceId && m.traceId !== 'unknown')?.traceId ?? 'unknown';
  if (initial !== 'unknown') return initial;

  const msgWithSession = messages.find(
    (m) => m.pageContext?.sessionId || (m as Message & { sessionId?: string }).sessionId
  );
  if (msgWithSession) {
    const sessionId =
      msgWithSession.pageContext?.sessionId ||
      (msgWithSession as Message & { sessionId?: string }).sessionId;
    return `session-${sessionId}`;
  }

  if (messages[0]?.messageId) {
    return `legacy-${messages[0].messageId}`;
  }

  return 'unknown';
}

export class ProviderManager implements IProvider {
  /**
   * Internal helper to resolve trace ID and enforce token budget.
   * @param messages - The conversation history.
   * @throws Error if budget is exceeded.
   */
  private async enforceBudget(messages: Message[]): Promise<string> {
    const tid = resolveTraceId(messages);
    const { isBudgetExceeded } = await import('../recursion-tracker');

    if (await isBudgetExceeded(tid)) {
      throw new Error(
        `[BUDGET_EXCEEDED] Execution halted for trace ${tid} to prevent runaway costs.`
      );
    }

    return tid;
  }

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
    const resource = Resource as unknown as Record<string, { value: string }>;

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
    const pluginProviders = PluginManager.getRegisteredLLMProviders();
    if (pluginProviders[providerType]) {
      return pluginProviders[providerType];
    }

    switch (providerType) {
      case LLMProvider.BEDROCK:
        return new BedrockProvider(model ?? SYSTEM.DEFAULT_BEDROCK_MODEL);
      case LLMProvider.OPENROUTER:
        return new OpenRouterProvider(model ?? SYSTEM.DEFAULT_OPENROUTER_MODEL);
      case LLMProvider.MINIMAX:
        return new MiniMaxProvider(model ?? SYSTEM.DEFAULT_MINIMAX_MODEL);
      case LLMProvider.ANTHROPIC:
        logger.warn('[ProviderManager] ANTHROPIC not directly supported, using Bedrock');
        return new BedrockProvider(model ?? SYSTEM.DEFAULT_BEDROCK_MODEL);
      case LLMProvider.MOCK:
        return {
          call: async () => ({
            role: MessageRole.ASSISTANT,
            content: 'Mock response',
            traceId: 'mock-trace',
            messageId: 'mock-msg',
          }),
          stream: async function* () {
            yield {
              role: MessageRole.ASSISTANT,
              content: 'Mock',
              messageId: 'mock-msg',
            };
          },
          getCapabilities: async () => ({
            maxTokens: 4096,
            supportsVision: false,
            supportsTools: false,
          }),
        } as unknown as IProvider;
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
    const threshold = await ConfigManager.getTypedConfig(
      CONFIG_KEYS.SIMPLE_TASK_THRESHOLD,
      SYSTEM.DEFAULT_SIMPLE_TASK_THRESHOLD
    );

    const isSimpleTask =
      messages.length <= 2 &&
      messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0) <
        (threshold as number);

    // Auto-route to cheaper model for simple tasks if no specific model was requested
    let effectiveProvider = provider;
    let effectiveModel = model;

    if (!provider && !model && isSimpleTask && profile === ReasoningProfile.STANDARD) {
      const activeProviderName = await this.getActiveProviderName();
      const { UTILITY_MODELS } = await import('../constants/system');
      effectiveProvider = activeProviderName;
      effectiveModel = UTILITY_MODELS[activeProviderName] ?? model;

      logger.info(
        `[COST_OPTIMIZATION] Routing simple task to ${effectiveProvider}/${effectiveModel} (Threshold: ${threshold} chars)`
      );
    }

    const activeProvider = await ProviderManager.getActiveProvider(
      effectiveProvider,
      effectiveModel
    );

    // Budget check
    const tid = await this.enforceBudget(messages);

    const response = await activeProvider.call(
      messages,
      tools,
      profile,
      effectiveModel,
      undefined,
      responseFormat,
      temperature,
      maxTokens,
      topP,
      stopSequences
    );

    // Track usage and log for billing transparency
    if (response.usage) {
      const { incrementTokenUsage } = await import('../recursion-tracker');
      const total =
        response.usage.total_tokens ??
        response.usage.prompt_tokens + response.usage.completion_tokens;
      await incrementTokenUsage(tid, total);
      logger.info(
        `[BILLING] Trace: ${tid} | Model: ${effectiveModel} | Tokens: ${total} (P: ${response.usage.prompt_tokens}, C: ${response.usage.completion_tokens})`
      );
    }

    return response;
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
    const threshold = await ConfigManager.getTypedConfig(
      CONFIG_KEYS.SIMPLE_TASK_THRESHOLD,
      SYSTEM.DEFAULT_SIMPLE_TASK_THRESHOLD
    );

    const isSimpleTask =
      messages.length <= 2 &&
      messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0) <
        (threshold as number);

    let effectiveProvider = provider;
    let effectiveModel = model;

    if (!provider && !model && isSimpleTask && profile === ReasoningProfile.STANDARD) {
      const activeProviderName = await this.getActiveProviderName();
      const { UTILITY_MODELS } = await import('../constants/system');
      effectiveProvider = activeProviderName;
      effectiveModel = UTILITY_MODELS[activeProviderName] ?? model;

      logger.info(
        `[COST_OPTIMIZATION] Routing simple task to ${effectiveProvider}/${effectiveModel} (Threshold: ${threshold} chars)`
      );
    }

    const activeProvider = await ProviderManager.getActiveProvider(
      effectiveProvider,
      effectiveModel
    );

    // Budget check
    const stid = await this.enforceBudget(messages);

    let totalTokens = 0;
    const stream = activeProvider.stream(
      messages,
      tools,
      profile,
      effectiveModel,
      undefined,
      responseFormat,
      temperature,
      maxTokens,
      topP,
      stopSequences
    );

    for await (const chunk of stream) {
      if (chunk.usage) {
        totalTokens =
          chunk.usage.total_tokens ?? chunk.usage.prompt_tokens + chunk.usage.completion_tokens;
      }
      yield chunk;
    }

    // Track usage and log for billing transparency
    if (totalTokens > 0) {
      const { incrementTokenUsage } = await import('../recursion-tracker');
      await incrementTokenUsage(stid, totalTokens);
      logger.info(
        `[BILLING] Trace: ${stid} | Model: ${effectiveModel} | Stream Tokens: ${totalTokens}`
      );
    }
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
      SYSTEM.DEFAULT_MODEL
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

    // Resolve primary provider, defaulting to configured system default if not found
    let primaryProvider = primary;
    if (!primaryProvider) {
      const configValue = await ConfigManager.getTypedConfig(
        CONFIG_KEYS.ACTIVE_PROVIDER,
        undefined
      );
      // Use SST Resource value if available, otherwise fallback to system default
      const sstProvider =
        'ActiveProvider' in resource ? (resource.ActiveProvider.value as LLMProvider) : undefined;
      primaryProvider =
        (configValue as unknown as LLMProvider) ?? sstProvider ?? SYSTEM.DEFAULT_PROVIDER;
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
