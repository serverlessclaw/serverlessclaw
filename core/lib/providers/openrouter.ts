import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  OpenRouterModel,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';
import { normalizeProfile, capEffort } from './utils';

interface OpenRouterResource {
  OpenRouterApiKey: { value: string };
}

const OPENROUTER_REASONING_MAP: Record<
  ReasoningProfile,
  { effort: 'low' | 'medium' | 'high'; enabled: boolean; route: 'latency' | 'fallback' }
> = {
  [ReasoningProfile.FAST]: { effort: 'low', enabled: false, route: 'latency' },
  [ReasoningProfile.STANDARD]: { effort: 'low', enabled: true, route: 'fallback' },
  [ReasoningProfile.THINKING]: { effort: 'medium', enabled: true, route: 'fallback' },
  [ReasoningProfile.DEEP]: { effort: 'high', enabled: true, route: 'fallback' },
};

export class OpenRouterProvider implements IProvider {
  constructor(private model: string = OpenRouterModel.GEMINI_3_FLASH) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string
  ): Promise<Message> {
    const apiKey = (Resource as unknown as OpenRouterResource).OpenRouterApiKey?.value || '';
    const baseUrl = 'https://openrouter.ai/api/v1';
    const activeModel = model || this.model;

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities(activeModel);
    profile = normalizeProfile(profile, capabilities, activeModel);

    const reasoningConfig = OPENROUTER_REASONING_MAP[profile];
    const reasoningEffort = capEffort(reasoningConfig.effort, capabilities.maxReasoningEffort);

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: messages,
      route: reasoningConfig.route,
      reasoning: {
        effort: reasoningEffort,
        enabled: reasoningConfig.enabled,
      },
      // 2026: Provider routing and privacy defaults
      provider: {
        allow_fallbacks: true,
        data_collection: 'deny',
        prompt_cache: true,
      },
      // 2026: specialized model-specific extra bodies
      ...(activeModel.includes('minimax') ? { plugin_id: 'reasoning' } : {}),
      ...(activeModel.includes('gemini-3') ? { safety_settings: 'off' } : {}),
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools.map((t) => {
        if (t.type && t.type !== 'function') {
          return { type: t.type };
        }
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        };
      });

      // 2026: Specialized Google Gemini Grounded Search
      if (
        activeModel.includes('gemini') &&
        tools.some((t) => t.type === 'google_search_retrieval')
      ) {
        body['google_search_retrieval'] = {
          dynamic_retrieval: {
            mode: 'unspecified',
            dynamic_threshold: 0.3,
          },
        };
      }
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/serverlessclaw/serverlessclaw',
        'X-Title': 'Serverless Claw',
        'X-OpenRouter-Caching': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter Provider error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices?: {
        message: Message & {
          reasoning_details?: unknown[];
        };
      }[];
    };
    const message = data.choices?.[0]?.message;

    if (!message) {
      return { role: MessageRole.ASSISTANT, content: 'Empty response from provider.' } as Message;
    }

    // 2026 Log reasoning details for observability if present
    if (message.reasoning_details) {
      logger.debug(
        `[OpenRouter Reasoning] for ${activeModel}:`,
        JSON.stringify(message.reasoning_details)
      );
    }

    return {
      role: MessageRole.ASSISTANT,
      content: message.content || '',
      tool_calls: message.tool_calls,
      usage: (data as any).usage
        ? {
            prompt_tokens: (data as any).usage.prompt_tokens || 0,
            completion_tokens: (data as any).usage.completion_tokens || 0,
            total_tokens: (data as any).usage.total_tokens || 0,
          }
        : undefined,
    } as Message;
  }

  async getCapabilities(model?: string) {
    const activeModel = model || this.model;
    // These standardized models from OpenRouter all support advanced reasoning in 2026
    const highCapabilityModels = [
      OpenRouterModel.GLM_5,
      OpenRouterModel.MINIMAX_2_5,
      OpenRouterModel.GEMINI_3_FLASH,
    ];

    const isHighCapability = highCapabilityModels.includes(activeModel as OpenRouterModel);

    return {
      supportedReasoningProfiles: isHighCapability
        ? [
            ReasoningProfile.FAST,
            ReasoningProfile.STANDARD,
            ReasoningProfile.THINKING,
            ReasoningProfile.DEEP,
          ]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
      maxReasoningEffort: 'high', // OpenRouter's reasoning.effort usually caps at high
    };
  }
}
