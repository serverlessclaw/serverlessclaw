import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  AttachmentType,
  MessageRole,
  OpenRouterModel,
  Attachment,
  MessageChunk,
  ResponseFormat,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';
import { normalizeProfile, capEffort, createEmptyResponse } from './utils';

// --- Constants and Configuration ---
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const PROJECT_REFERER = 'https://github.com/serverlessclaw/serverlessclaw';
const PROJECT_TITLE = 'Serverless Claw';
const DEFAULT_DYNAMIC_THRESHOLD = 0.3;

/**
 * Standardized OpenRouter values for type safety and AI signal clarity.
 */
const OPENROUTER_CONSTANTS = {
  CONTENT_TYPES: {
    TEXT: 'text' as const,
    IMAGE_URL: 'image_url' as const,
    INPUT_FILE: 'input_file' as const,
  },
  MIME_TYPES: {
    PNG: 'image/png',
    OCTET_STREAM: 'application/octet-stream',
  },
  TOOL_TYPES: {
    FUNCTION: 'function',
    GOOGLE_SEARCH: 'google_search_retrieval',
  },
  MODELS: {
    GEMINI_3: 'gemini-3',
    GLM: 'glm',
  },
  RESPONSE_FORMATS: {
    JSON_SCHEMA: 'json_schema',
    JSON_OBJECT: 'json_object' as const,
  },
} as const;

/**
 * Known context windows for specific models to avoid magic numbers.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'gemini-3': 1048576,
  glm: 200000,
  default: 128000,
};

/**
 * Mapping of reasoning profiles to OpenRouter-specific reasoning parameters.
 */
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
 * Interface for SST Resource object to avoid 'as any' assertions.
 */
interface ClawSstResource {
  OpenRouterApiKey?: { value: string };
  [key: string]: unknown;
}

/**
 * Interface for OpenRouter/OpenAI-compatible content blocks.
 */
interface OpenRouterContentBlock {
  type: (typeof OPENROUTER_CONSTANTS.CONTENT_TYPES)[keyof typeof OPENROUTER_CONSTANTS.CONTENT_TYPES];
  text?: string;
  image_url?: { url: string };
  input_file?: { file_id: string };
}

/**
 * Interface for OpenRouter API response.
 */
interface OpenRouterResponse {
  choices?: {
    message?: Message & {
      reasoning_details?: Array<{ text?: string }>;
      reasoning?: string;
    };
    delta?: Message & {
      reasoning_details?: Array<{ text?: string }>;
      reasoning?: string;
    };
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Helper to convert a Claw message to an OpenRouter-compatible message.
 * @param message The input Claw message.
 * @returns A formatted message object.
 */
function convertToOpenRouterMessage(message: Message) {
  if (!message.attachments || message.attachments.length === 0) {
    return message;
  }

  const content: OpenRouterContentBlock[] = [];
  if (message.content) {
    content.push({ type: OPENROUTER_CONSTANTS.CONTENT_TYPES.TEXT, text: message.content });
  }

  message.attachments.forEach((attachment) => {
    const block = createContentBlock(attachment);
    if (block) content.push(block);
  });

  return {
    ...message,
    content:
      content.length === 1 && content[0].type === OPENROUTER_CONSTANTS.CONTENT_TYPES.TEXT
        ? message.content
        : content,
  };
}

/**
 * Helper to create a content block for OpenRouter.
 * @param attachment The input attachment.
 * @returns A content block or null if unsupported.
 */
function createContentBlock(attachment: Attachment): OpenRouterContentBlock | null {
  if (attachment.type === 'image') {
    return {
      type: OPENROUTER_CONSTANTS.CONTENT_TYPES.IMAGE_URL,
      image_url: {
        url:
          attachment.url ??
          `data:${attachment.mimeType ?? OPENROUTER_CONSTANTS.MIME_TYPES.PNG};base64,${attachment.base64}`,
      },
    };
  }

  if (attachment.type === 'file') {
    return {
      type: OPENROUTER_CONSTANTS.CONTENT_TYPES.INPUT_FILE,
      input_file: {
        file_id:
          attachment.url ??
          `data:${attachment.mimeType ?? OPENROUTER_CONSTANTS.MIME_TYPES.OCTET_STREAM};base64,${attachment.base64}`,
      },
    };
  }

  return null;
}

/**
 * Provider for OpenRouter, aggregating multiple high-capability models (GLM, Gemini).
 * Implements dynamic capability detection and standardized reasoning parameters.
 */
export class OpenRouterProvider implements IProvider {
  /**
   * Initializes the OpenRouter provider.
   * @param model The model ID to use (defaults to Gemini 3 Flash).
   */
  constructor(private model: string = OpenRouterModel.GEMINI_3_FLASH) {}

  /**
   * Performs a non-streaming chat completion call.
   *
   * @param messages The conversation history.
   * @param tools Optional list of tools for function calling.
   * @param profile The preferred reasoning profile.
   * @param model Override for the model ID.
   * @param _provider Ignored provider identifier.
   * @param responseFormat Preferred format for the response.
   * @param temperature Optional sampling temperature.
   * @param maxTokens Optional maximum tokens to generate.
   * @param topP Optional nucleus sampling probability.
   * @param stopSequences Optional list of stop sequences.
   * @returns A promise resolving to the assistant's message.
   */
  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string,
    responseFormat?: ResponseFormat,
    temperature?: number,
    maxTokens?: number,
    topP?: number,
    stopSequences?: string[]
  ): Promise<Message> {
    const sstResource = Resource as unknown as ClawSstResource;
    const apiKey = sstResource.OpenRouterApiKey?.value ?? '';
    const baseUrl = OPENROUTER_BASE_URL;
    const activeModel = model ?? this.model;

    const capabilities = await this.getCapabilities(activeModel);
    profile = normalizeProfile(profile, capabilities, activeModel);

    const config = OPENROUTER_REASONING_MAP[profile];
    const reasoningEffort = capEffort(config.effort, capabilities.maxReasoningEffort);

    const processedMessages = messages.map(convertToOpenRouterMessage);

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: processedMessages,
      route: config.route,
      reasoning: { effort: reasoningEffort, enabled: config.enabled },
      ...(responseFormat ? { response_format: responseFormat } : {}),
      provider: {
        allow_fallbacks: true,
        data_collection: 'deny',
        prompt_cache: true,
        ...(responseFormat || (tools && tools.length > 0) ? { require_parameters: true } : {}),
      },
      ...(activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GLM)
        ? { plugin_id: 'reasoning', include_reasoning: true }
        : {}),
      ...(activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GEMINI_3)
        ? { safety_settings: 'off' }
        : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stop: stopSequences } : {}),
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools.map((tool) => {
        if (tool.type && tool.type !== OPENROUTER_CONSTANTS.TOOL_TYPES.FUNCTION)
          return { type: tool.type };
        return {
          type: OPENROUTER_CONSTANTS.TOOL_TYPES.FUNCTION,
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        };
      });

      if (
        activeModel.includes('gemini') &&
        tools.some((t) => t.type === OPENROUTER_CONSTANTS.TOOL_TYPES.GOOGLE_SEARCH)
      ) {
        body['google_search_retrieval'] = {
          dynamic_retrieval: { mode: 'unspecified', dynamic_threshold: DEFAULT_DYNAMIC_THRESHOLD },
        };
      }
    }

    if (
      responseFormat?.type === OPENROUTER_CONSTANTS.RESPONSE_FORMATS.JSON_SCHEMA &&
      activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GEMINI_3)
    ) {
      body['response_format'] = { type: OPENROUTER_CONSTANTS.RESPONSE_FORMATS.JSON_OBJECT };
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': PROJECT_REFERER,
        'X-Title': PROJECT_TITLE,
        'X-OpenRouter-Caching': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter Provider error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    const msg = data.choices?.[0]?.message;

    if (!msg) return createEmptyResponse('OpenRouter');

    if (msg.reasoning_details) {
      logger.debug(
        `[OpenRouter Reasoning] for ${activeModel}:`,
        JSON.stringify(msg.reasoning_details)
      );
    }

    let thought: string | undefined;
    if (msg.reasoning_details && Array.isArray(msg.reasoning_details)) {
      const parts = msg.reasoning_details.filter((d) => d.text).map((d) => d.text as string);
      if (parts.length > 0) thought = parts.join('\n\n');
    }

    return {
      role: MessageRole.ASSISTANT,
      content: msg.content ?? '',
      thought,
      tool_calls: msg.tool_calls,
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    } as Message;
  }

  /**
   * Performs a streaming chat completion call.
   */
  async *stream(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string,
    responseFormat?: ResponseFormat,
    temperature?: number,
    maxTokens?: number,
    topP?: number,
    stopSequences?: string[]
  ): AsyncIterable<MessageChunk> {
    const sstResource = Resource as unknown as ClawSstResource;
    const apiKey = sstResource.OpenRouterApiKey?.value ?? '';
    const baseUrl = OPENROUTER_BASE_URL;
    const activeModel = model ?? this.model;

    const capabilities = await this.getCapabilities(activeModel);
    profile = normalizeProfile(profile, capabilities, activeModel);

    const config = OPENROUTER_REASONING_MAP[profile];
    const reasoningEffort = capEffort(config.effort, capabilities.maxReasoningEffort);

    const processedMessages = messages.map(convertToOpenRouterMessage);

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: processedMessages,
      stream: true,
      route: config.route,
      reasoning: { effort: reasoningEffort, enabled: config.enabled },
      ...(responseFormat ? { response_format: responseFormat } : {}),
      provider: {
        allow_fallbacks: true,
        data_collection: 'deny',
        prompt_cache: true,
        ...(responseFormat || (tools && tools.length > 0) ? { require_parameters: true } : {}),
      },
      ...(activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GLM)
        ? { plugin_id: 'reasoning', include_reasoning: true }
        : {}),
      ...(activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GEMINI_3)
        ? { safety_settings: 'off' }
        : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stop: stopSequences } : {}),
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools.map((tool) => {
        if (tool.type && tool.type !== OPENROUTER_CONSTANTS.TOOL_TYPES.FUNCTION)
          return { type: tool.type };
        return {
          type: OPENROUTER_CONSTANTS.TOOL_TYPES.FUNCTION,
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        };
      });

      if (
        activeModel.includes('gemini') &&
        tools.some((t) => t.type === OPENROUTER_CONSTANTS.TOOL_TYPES.GOOGLE_SEARCH)
      ) {
        body['google_search_retrieval'] = {
          dynamic_retrieval: { mode: 'unspecified', dynamic_threshold: DEFAULT_DYNAMIC_THRESHOLD },
        };
      }
    }

    if (
      responseFormat?.type === OPENROUTER_CONSTANTS.RESPONSE_FORMATS.JSON_SCHEMA &&
      activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GEMINI_3)
    ) {
      body['response_format'] = { type: OPENROUTER_CONSTANTS.RESPONSE_FORMATS.JSON_OBJECT };
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': PROJECT_REFERER,
          'X-Title': PROJECT_TITLE,
          'X-OpenRouter-Caching': 'true',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter Provider error: ${response.status} - ${error}`);
      }

      if (!response.body) {
        yield { content: ' (No stream body)' };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      const parseChunk = (line: string): (OpenRouterResponse & { done?: boolean }) | null => {
        if (!line.startsWith('data: ')) return null;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') return { done: true };
        try {
          return JSON.parse(dataStr) as OpenRouterResponse;
        } catch {
          return null;
        }
      };

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const parsed = parseChunk(line);
          if (!parsed) continue;
          if (parsed.done) {
            streamDone = true;
            break;
          }

          const choice = parsed.choices?.[0];

          if (parsed.usage) {
            yield {
              usage: {
                prompt_tokens: parsed.usage.prompt_tokens ?? 0,
                completion_tokens: parsed.usage.completion_tokens ?? 0,
                total_tokens: parsed.usage.total_tokens ?? 0,
              },
            };
          }

          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) yield { content: delta.content };

          if (delta.reasoning_details && Array.isArray(delta.reasoning_details)) {
            for (const detail of delta.reasoning_details) {
              if (detail.text) yield { thought: (detail as { text: string }).text };
            }
          }

          if (delta.reasoning && typeof delta.reasoning === 'string')
            yield { thought: delta.reasoning };

          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              yield {
                tool_calls: [
                  {
                    id: toolCall.id ?? '',
                    type: OPENROUTER_CONSTANTS.TOOL_TYPES.FUNCTION,
                    function: {
                      name: toolCall.function?.name ?? '',
                      arguments: toolCall.function?.arguments ?? '',
                    },
                  },
                ],
              };
            }
          }
        }
      }

      if (buffer.trim()) {
        const parsed = parseChunk(buffer.trim());
        if (parsed && !parsed.done && parsed.usage) {
          yield {
            usage: {
              prompt_tokens: parsed.usage.prompt_tokens ?? 0,
              completion_tokens: parsed.usage.completion_tokens ?? 0,
              total_tokens: parsed.usage.total_tokens ?? 0,
            },
          };
        }
      }
    } catch (err) {
      logger.error('OpenRouter streaming failed:', err);
      yield { content: ' (Streaming failed)' };
    }
  }

  /**
   * Retrieves the capabilities of a specific model.
   *
   * @param model The model ID to check.
   * @returns An object describing reasoning profiles, structured output support, and context window.
   */
  async getCapabilities(model?: string) {
    const activeModel = model ?? this.model;
    const isHighCapability =
      activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GLM) ||
      activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GEMINI_3) ||
      activeModel.includes('claude-3-7') ||
      activeModel.includes('gpt-5');

    return {
      supportedReasoningProfiles: isHighCapability
        ? [
            ReasoningProfile.FAST,
            ReasoningProfile.STANDARD,
            ReasoningProfile.THINKING,
            ReasoningProfile.DEEP,
          ]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
      maxReasoningEffort: 'high',
      supportsStructuredOutput: true,
      contextWindow: activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GEMINI_3)
        ? CONTEXT_WINDOWS['gemini-3']
        : activeModel.includes(OPENROUTER_CONSTANTS.MODELS.GLM)
          ? CONTEXT_WINDOWS['glm']
          : CONTEXT_WINDOWS['default'],
      supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
    };
  }
}
