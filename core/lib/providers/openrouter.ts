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
import { normalizeProfile, capEffort, createEmptyResponse } from './utils';

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

/**
 * Provider for OpenRouter, aggregating multiple high-capability models (GLM, MiniMax, Gemini).
 * Implements dynamic capability detection and standardized reasoning parameters.
 */
export class OpenRouterProvider implements IProvider {
  constructor(private model: string = OpenRouterModel.GEMINI_3_FLASH) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string,
    responseFormat?: import('../types/index').ResponseFormat
  ): Promise<Message> {
    const apiKey = (Resource as unknown as OpenRouterResource).OpenRouterApiKey?.value ?? '';
    const baseUrl = 'https://openrouter.ai/api/v1';
    const activeModel = model ?? this.model;

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities(activeModel);
    profile = normalizeProfile(profile, capabilities, activeModel);

    const reasoningConfig = OPENROUTER_REASONING_MAP[profile];
    const reasoningEffort = capEffort(reasoningConfig.effort, capabilities.maxReasoningEffort);

    const processedMessages = messages.map((m) => {
      if (!m.attachments || m.attachments.length === 0) {
        return m;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = [];
      if (m.content) {
        content.push({ type: 'text', text: m.content });
      }

      m.attachments.forEach((att) => {
        if (att.type === 'image') {
          content.push({
            type: 'image_url',
            image_url: {
              url: att.url ?? `data:${att.mimeType ?? 'image/png'};base64,${att.base64}`,
            },
          });
        } else if (att.type === 'file') {
          // OpenRouter/OpenAI-compatible file input
          content.push({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: 'input_file' as any,
            input_file: {
              file_id:
                att.url ??
                `data:${att.mimeType ?? 'application/octet-stream'};base64,${att.base64}`,
            },
          });
        }
      });

      return {
        ...m,
        content: content.length === 1 && content[0].type === 'text' ? m.content : content,
      };
    });

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: processedMessages,
      route: reasoningConfig.route,
      reasoning: {
        effort: reasoningEffort,
        enabled: reasoningConfig.enabled,
      },
      ...(responseFormat ? { response_format: responseFormat } : {}),
      // 2026: Provider routing and privacy defaults
      provider: {
        allow_fallbacks: true,
        data_collection: 'deny',
        prompt_cache: true,
        // Ensure routing to providers supporting requested features (tools, json_schema)
        ...(responseFormat || (tools && tools.length > 0) ? { require_parameters: true } : {}),
      },
      // 2026: specialized model-specific extra bodies
      ...(activeModel.includes('minimax')
        ? { plugin_id: 'reasoning', include_reasoning: true }
        : {}),
      ...(activeModel.includes('glm') ? { plugin_id: 'reasoning', include_reasoning: true } : {}),
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

    // 2026: Force JSON format for models that require explicit mime types (Gemini 3)
    if (responseFormat?.type === 'json_schema' && activeModel.includes('gemini-3')) {
      body['response_format'] = { type: 'json_object' };
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
      return createEmptyResponse('OpenRouter');
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
      content: message.content ?? '',
      tool_calls: message.tool_calls,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      usage: (data as any).usage
        ? {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prompt_tokens: (data as any).usage.prompt_tokens ?? 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            completion_tokens: (data as any).usage.completion_tokens ?? 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            total_tokens: (data as any).usage.total_tokens ?? 0,
          }
        : undefined,
    } as Message;
  }

  async getCapabilities(model?: string) {
    const activeModel = model ?? this.model;
    // 2026: Dynamic capability detection based on model ID patterns.
    // Standardized reasoning models in OpenRouter usually contain these keywords.
    const isHighCapability =
      activeModel.includes('glm') ||
      activeModel.includes('minimax') ||
      activeModel.includes('gemini-3') ||
      activeModel.includes('claude-3-7') || // Hypothetical 2026 Claude
      activeModel.includes('gpt-5');

    let contextWindow = 128000;
    if (activeModel.includes('gemini-3')) contextWindow = 1048576;
    else if (activeModel.includes('minimax')) contextWindow = 205000;
    else if (activeModel.includes('glm')) contextWindow = 200000;

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
      supportsStructuredOutput: true,
      contextWindow,
    };
  }
}
