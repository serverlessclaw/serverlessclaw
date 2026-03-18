import { IProvider, Message, ITool, ReasoningProfile, LLMProvider } from '../types/index';
import { Resource } from 'sst';

import { OpenAIProvider } from './openai';
import { OpenRouterProvider } from './openrouter';
import { BedrockProvider } from './bedrock';
import { SYSTEM, CONFIG_KEYS } from '../constants';
import { ConfigManager } from '../registry/config';

interface ProviderResource {
  ActiveProvider?: { value: string };
  ActiveModel?: { value: string };
  ConfigTable: { name: string };
}

export class ProviderManager implements IProvider {
  /**
   * Resolves the active provider and model using a hierarchy:
   * 1. Direct overrides (parameters)
   * 2. Hot configuration (DynamoDB ConfigTable)
   * 3. SST Static Resources (if linked)
   * 4. System Constants (last resort)
   */
  static async getActiveProvider(
    overrideProvider?: string,
    overrideModel?: string
  ): Promise<IProvider> {
    const typedResource = Resource as unknown as ProviderResource;

    // Resolve Provider
    const providerType = (overrideProvider ??
      (await ConfigManager.getTypedConfig(
        CONFIG_KEYS.ACTIVE_PROVIDER,
        typedResource.ActiveProvider?.value ?? SYSTEM.DEFAULT_PROVIDER
      ))) as LLMProvider;

    // Resolve Model
    const model =
      overrideModel ??
      ((await ConfigManager.getRawConfig(CONFIG_KEYS.ACTIVE_MODEL)) as string) ??
      typedResource.ActiveModel?.value;

    switch (providerType) {
      case LLMProvider.BEDROCK:
        return new BedrockProvider(model ?? SYSTEM.DEFAULT_BEDROCK_MODEL);
      case LLMProvider.OPENROUTER:
        return new OpenRouterProvider(model ?? SYSTEM.DEFAULT_OPENROUTER_MODEL);
      case LLMProvider.OPENAI:
      default:
        return new OpenAIProvider(model ?? SYSTEM.DEFAULT_OPENAI_MODEL);
    }
  }

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    provider?: string,
    responseFormat?: import('../types/index').ResponseFormat
  ): Promise<Message> {
    const activeProvider = await ProviderManager.getActiveProvider(provider, model);
    return activeProvider.call(messages, tools, profile, model, undefined, responseFormat);
  }

  async getCapabilities(model?: string) {
    const provider = await ProviderManager.getActiveProvider(undefined, model);
    return provider.getCapabilities(model);
  }
}
