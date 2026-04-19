import OpenAI from 'openai';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  AttachmentType,
  MessageRole,
  OpenAIModel,
  MessageChunk,
  ResponseFormat,
} from '../types/index';
import { Resource } from 'sst';
import { OPENAI } from '../constants';
import { logger } from '../logger';
import { normalizeProfile, capEffort } from './utils';

interface OpenAIResponse {
  output_text?: string;
  output_thought?: string;
  output?: Array<{
    id?: string;
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    summary?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const REASONING_MAP: Record<ReasoningProfile, OpenAI.ReasoningEffort> = {
  [ReasoningProfile.FAST]: 'low',
  [ReasoningProfile.STANDARD]: 'medium',
  [ReasoningProfile.THINKING]: 'xhigh',
  [ReasoningProfile.DEEP]: 'xhigh',
};

type ContentItem =
  | { type: string; text: string }
  | { type: string; image_url: { url: string } }
  | { type: string; filename: string; file_data: string };

type ToolConfig = {
  type: string;
  server_label?: string;
  connector_id?: string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
};

/**
 * Provider for OpenAI's LLM services, supporting GPT-5 and reasoning models.
 * Utilizes the Responses API for 2026-grade reasoning and tool use.
 */
export class OpenAIProvider implements IProvider {
  private static _client: OpenAI | null = null;
  private static _currentKey: string | null = null;

  constructor(private model: string = OpenAIModel.GPT_5_4) {}

  private static isPlaceholderApiKey(value?: string): boolean {
    if (!value) return true;

    const normalized = value.trim().toLowerCase();
    return (
      normalized.length === 0 ||
      normalized === 'dummy' ||
      normalized === 'test' ||
      normalized === 'test-key'
    );
  }

  private static resolveApiKey(): string {
    const resource = Resource as unknown as Record<string, { value?: string } | undefined>;
    const linkedKey = resource.OpenAIApiKey?.value;
    const openAiEnvKey = process.env.OPENAI_API_KEY;
    const sstSecretEnvKey = process.env.SST_SECRET_OpenAIApiKey;

    const candidates = [linkedKey, openAiEnvKey, sstSecretEnvKey];
    const resolved = candidates.find((key) => !OpenAIProvider.isPlaceholderApiKey(key));

    if (!resolved) {
      throw new Error(
        'OpenAI API key is not configured. Set SST_SECRET_OpenAIApiKey (preferred for make dev) or OPENAI_API_KEY.'
      );
    }

    return resolved;
  }

  private get client(): OpenAI {
    const apiKey = OpenAIProvider.resolveApiKey();

    if (!OpenAIProvider._client || OpenAIProvider._currentKey !== apiKey) {
      OpenAIProvider._client = new OpenAI({ apiKey });
      OpenAIProvider._currentKey = apiKey;
    }
    return OpenAIProvider._client;
  }

  private static shouldRequestReasoningSummary(
    model: string,
    requestedProfile: ReasoningProfile
  ): boolean {
    const isGpt5Family = model.includes('gpt-5');
    const isThinkingMode =
      requestedProfile === ReasoningProfile.THINKING || requestedProfile === ReasoningProfile.DEEP;
    return isGpt5Family && isThinkingMode;
  }

  private static isReasoningSummaryUnsupportedError(err: unknown): boolean {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return (
      message.includes('reasoning.summary') ||
      (message.includes('summary') && message.includes('reasoning')) ||
      message.includes('unknown parameter') ||
      message.includes('unsupported')
    );
  }

  private static extractSummaryText(summary?: Array<{ text?: string }>): string {
    if (!Array.isArray(summary)) return '';
    return summary
      .map((s) => s?.text ?? '')
      .filter((text) => text.trim().length > 0)
      .join('\n\n')
      .trim();
  }

  private static extractReasoningSummary(output?: OpenAIResponse['output']): string | undefined {
    if (!Array.isArray(output)) return undefined;

    const collected: string[] = [];
    for (const item of output) {
      if (item.type !== 'reasoning') continue;
      const text = OpenAIProvider.extractSummaryText(item.summary);
      if (text.length > 0) {
        collected.push(text);
      }
    }

    return collected.length > 0 ? collected.join('\n\n') : undefined;
  }

  private static splitThoughtIntoChunks(text: string, targetChunkSize = 80): string[] {
    if (!text) return [];
    if (text.length <= targetChunkSize) return [text];

    const tokens = text.split(/(\s+)/);
    const chunks: string[] = [];
    let current = '';

    for (const token of tokens) {
      if (current.length > 0 && (current + token).length > targetChunkSize) {
        chunks.push(current);
        current = token;
      } else {
        current += token;
      }
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
  }

  /**
   * Maps internal Message[] to OpenAI Responses API input format.
   */
  private static mapMessagesToResponsesInput(messages: Message[]): Array<Record<string, unknown>> {
    return messages.flatMap((m) => {
      if (m.role === MessageRole.TOOL) {
        return [
          {
            type: OPENAI.ITEM_TYPES.FUNCTION_CALL_OUTPUT,
            call_id: m.tool_call_id ?? '',
            output: m.content ?? '',
          },
        ];
      }

      const items: Array<Record<string, unknown>> = [];

      // 1. Add message content if present
      if (m.content || (m.attachments && m.attachments.length > 0)) {
        let role: 'user' | 'assistant' | 'system' | 'developer' = OPENAI.ROLES.USER;
        if (m.role === MessageRole.SYSTEM) role = OPENAI.ROLES.DEVELOPER;
        else if (m.role === MessageRole.ASSISTANT) role = OPENAI.ROLES.ASSISTANT;
        else if (m.role === MessageRole.DEVELOPER) role = OPENAI.ROLES.DEVELOPER;

        const content: ContentItem[] = [];
        if (m.content) content.push({ type: OPENAI.CONTENT_TYPES.INPUT_TEXT, text: m.content });

        if (m.attachments) {
          m.attachments.forEach((att) => {
            if (att.type === 'image') {
              content.push({
                type: OPENAI.CONTENT_TYPES.IMAGE_URL,
                image_url: {
                  url: att.url ?? `data:${att.mimeType ?? 'image/png'};base64,${att.base64}`,
                },
              });
            } else if (att.type === 'file') {
              content.push({
                type: OPENAI.CONTENT_TYPES.INPUT_FILE,
                filename: att.name ?? OPENAI.DEFAULT_FILE_NAME,
                file_data: `data:${att.mimeType ?? OPENAI.DEFAULT_MIME_TYPE};base64,${att.base64}`,
              });
            }
          });
        }

        items.push({
          type: OPENAI.ITEM_TYPES.MESSAGE,
          role,
          content:
            content.length === 1 && content[0].type === OPENAI.CONTENT_TYPES.INPUT_TEXT
              ? m.content
              : content,
        });
      }

      // 2. Add tool calls as separate items (flattened)
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          items.push({
            type: OPENAI.ITEM_TYPES.FUNCTION_CALL,
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
      }

      return items;
    });
  }

  /**
   * Maps internal ITool[] to OpenAI API tool format.
   */
  private static mapToolsToOpenAI(tools: ITool[]): ToolConfig[] {
    return tools.map((t) => {
      if (t.connector_id) {
        return {
          type: OPENAI.MCP_TYPE,
          server_label: t.name,
          connector_id: t.connector_id,
        };
      }
      if (t.type && t.type !== OPENAI.FUNCTION_TYPE) {
        return { type: t.type };
      }
      return {
        type: OPENAI.FUNCTION_TYPE,
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as Record<string, unknown>,
        strict: false,
      };
    });
  }

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
    const client = this.client;
    const requestedProfile = profile;

    // Resolve model if only profile is provided
    let activeModel = model ?? this.model;
    if (!model && profile) {
      const profileToModel: Record<ReasoningProfile, string> = {
        [ReasoningProfile.FAST]: OpenAIModel.GPT_5_4_NANO,
        [ReasoningProfile.STANDARD]: OpenAIModel.GPT_5_4_MINI,
        [ReasoningProfile.THINKING]: OpenAIModel.GPT_5_4_MINI,
        [ReasoningProfile.DEEP]: OpenAIModel.GPT_5_4,
      };
      activeModel = (profileToModel[profile] ?? activeModel) as string;
    }

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities(activeModel);
    profile = normalizeProfile(profile, capabilities, activeModel);

    const reasoningEffort = capEffort(
      REASONING_MAP[profile] as string,
      capabilities.maxReasoningEffort
    );

    const hasTools = tools && tools.length > 0;

    logger.info(`Using OpenAI Responses API for model ${activeModel}`);

    const responsesInput = OpenAIProvider.mapMessagesToResponsesInput(messages);

    const shouldRequestSummary = OpenAIProvider.shouldRequestReasoningSummary(
      activeModel,
      requestedProfile
    );

    const requestPayload: any = {
      model: activeModel as OpenAI.ResponsesModel,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input: responsesInput as any,
      reasoning: {
        effort: reasoningEffort as OpenAI.ReasoningEffort,
        ...(shouldRequestSummary ? { summary: 'auto' } : {}),
      },
      // 2026 Responses API: response_format has moved to text.format
      ...(responseFormat
        ? {
            text: {
              format:
                responseFormat.type === 'json_schema'
                  ? {
                      type: 'json_schema',
                      name: responseFormat.json_schema?.name ?? 'response',
                      schema: responseFormat.json_schema?.schema ?? {},
                      strict: responseFormat.json_schema?.strict ?? true,
                      description: responseFormat.json_schema?.description,
                    }
                  : { type: responseFormat.type },
            },
          }
        : {}),
      ...(hasTools
        ? {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: OpenAIProvider.mapToolsToOpenAI(tools) as any,
          }
        : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stop: stopSequences } : {}),
    };

    try {
      let response: OpenAIResponse;
      try {
        response = (await client.responses.create(requestPayload)) as unknown as OpenAIResponse;
      } catch (err) {
        if (!shouldRequestSummary || !OpenAIProvider.isReasoningSummaryUnsupportedError(err)) {
          throw err;
        }

        logger.warn(
          `OpenAI reasoning.summary unsupported for ${activeModel}; retrying without summary.`
        );

        const fallbackPayload = {
          ...requestPayload,
          reasoning: { effort: reasoningEffort as OpenAI.ReasoningEffort },
        };

        response = (await client.responses.create(fallbackPayload)) as unknown as OpenAIResponse;
      }

      // Extract output
      const content = response.output_text ?? '';
      const thought =
        response.output_thought ?? OpenAIProvider.extractReasoningSummary(response.output);
      const toolCalls: Message['tool_calls'] = [];

      if (response.output && Array.isArray(response.output)) {
        for (const item of response.output) {
          if (item.type === OPENAI.ITEM_TYPES.FUNCTION_CALL) {
            toolCalls.push({
              id: item.call_id ?? '',
              type: OPENAI.FUNCTION_TYPE,
              function: {
                name: item.name ?? '',
                arguments: item.arguments ?? '',
              },
            });
          }
        }
      }

      return {
        role: MessageRole.ASSISTANT,
        content,
        thought,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        traceId: messages[0]?.traceId ?? 'unknown-trace', // propagate or fallback
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        usage: response.usage
          ? {
              prompt_tokens: response.usage.prompt_tokens ?? 0,
              completion_tokens: response.usage.completion_tokens ?? 0,
              total_tokens: response.usage.total_tokens ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      logger.error('OpenAI Responses API failed:', err);
      throw new Error(
        `OpenAI provider call failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

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
  ): AsyncGenerator<MessageChunk> {
    const client = this.client;
    const requestedProfile = profile;

    let activeModel = model ?? this.model;
    if (!model && profile) {
      const profileToModel: Record<ReasoningProfile, string> = {
        [ReasoningProfile.FAST]: OpenAIModel.GPT_5_4_NANO,
        [ReasoningProfile.STANDARD]: OpenAIModel.GPT_5_4_MINI,
        [ReasoningProfile.THINKING]: OpenAIModel.GPT_5_4_MINI,
        [ReasoningProfile.DEEP]: OpenAIModel.GPT_5_4,
      };
      activeModel = (profileToModel[profile] ?? activeModel) as string;
    }

    const capabilities = await this.getCapabilities(activeModel);
    profile = normalizeProfile(profile, capabilities, activeModel);
    const reasoningEffort = capEffort(
      REASONING_MAP[profile] as string,
      capabilities.maxReasoningEffort
    );

    const responsesInput = OpenAIProvider.mapMessagesToResponsesInput(messages);

    const shouldRequestSummary = OpenAIProvider.shouldRequestReasoningSummary(
      activeModel,
      requestedProfile
    );

    const requestPayload: any = {
      model: activeModel as OpenAI.ResponsesModel,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input: responsesInput as any,
      reasoning: {
        effort: reasoningEffort as OpenAI.ReasoningEffort,
        ...(shouldRequestSummary ? { summary: 'auto' } : {}),
      },
      stream: true,
      ...(responseFormat
        ? {
            text: {
              format:
                responseFormat.type === 'json_schema'
                  ? {
                      type: 'json_schema',
                      name: responseFormat.json_schema?.name ?? 'response',
                      schema: responseFormat.json_schema?.schema ?? {},
                      strict: responseFormat.json_schema?.strict ?? true,
                      description: responseFormat.json_schema?.description,
                    }
                  : { type: responseFormat.type },
            },
          }
        : {}),
      ...(tools && tools.length > 0
        ? {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: OpenAIProvider.mapToolsToOpenAI(tools) as any,
          }
        : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stop: stopSequences } : {}),
    };

    try {
      let stream: AsyncIterable<unknown>;
      try {
        stream = (await client.responses.create(
          requestPayload
        )) as unknown as AsyncIterable<unknown>;
      } catch (err) {
        if (!shouldRequestSummary || !OpenAIProvider.isReasoningSummaryUnsupportedError(err)) {
          throw err;
        }

        logger.warn(
          `OpenAI reasoning.summary unsupported for ${activeModel} streaming; retrying without summary.`
        );

        const fallbackPayload = {
          ...requestPayload,
          reasoning: { effort: reasoningEffort as OpenAI.ReasoningEffort },
        };
        stream = (await client.responses.create(
          fallbackPayload
        )) as unknown as AsyncIterable<unknown>;
      }

      for await (const chunk of stream) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawChunk = chunk as any;
        const type = rawChunk.type || '';

        // Support both direct deltas and nested item deltas (2026 Responses API)
        // Some events are prefixed with "response."
        const delta = rawChunk.delta ?? rawChunk.item?.delta;

        const isContentEvent =
          type === 'text.delta' ||
          type === 'output_text.delta' ||
          type === 'response.text.delta' ||
          type === 'response.output_text.delta';
        const isThoughtEvent =
          type === 'reasoning.delta' ||
          type === 'output_thought.delta' ||
          type === 'thought.delta' ||
          type === 'response.reasoning.delta' ||
          type === 'response.output_thought.delta' ||
          type === 'response.thought.delta' ||
          !!rawChunk.delta?.reasoning_content ||
          !!rawChunk.item?.delta?.reasoning_content;

        const isReasoningSummaryItemDone =
          type === 'output_item.done' || type === 'response.output_item.done';

        if (isContentEvent && delta) {
          const content = typeof delta === 'string' ? delta : (delta.value ?? delta.text ?? '');
          if (content) {
            yield { content };
          }
        } else if (isThoughtEvent) {
          const thought =
            typeof delta === 'string'
              ? delta
              : (delta?.value ??
                delta?.text ??
                rawChunk.delta?.reasoning_content ??
                rawChunk.item?.delta?.reasoning_content ??
                '');
          if (thought) {
            yield { thought };
          }
        } else if (
          (type === 'message.delta' || type === 'response.message.delta') &&
          rawChunk.delta
        ) {
          if (rawChunk.delta.content) yield { content: rawChunk.delta.content };
          if (rawChunk.delta.reasoning) yield { thought: rawChunk.delta.reasoning };
        } else if (
          isReasoningSummaryItemDone &&
          rawChunk.item?.type === 'reasoning' &&
          Array.isArray(rawChunk.item?.summary)
        ) {
          const summaryText = OpenAIProvider.extractSummaryText(rawChunk.item.summary);
          if (summaryText.length > 0) {
            const summaryChunks = OpenAIProvider.splitThoughtIntoChunks(summaryText);
            for (const thoughtChunk of summaryChunks) {
              yield { thought: thoughtChunk };
            }
          }
        } else if (
          (type === 'usage' || type === 'response.usage') &&
          (rawChunk.usage || rawChunk.response?.usage)
        ) {
          const usage = rawChunk.usage || rawChunk.response?.usage;
          yield {
            usage: {
              prompt_tokens: usage.prompt_tokens ?? 0,
              completion_tokens: usage.completion_tokens ?? 0,
              total_tokens: usage.total_tokens ?? 0,
            },
          };
        }
      }
    } catch (err) {
      logger.error('OpenAI streaming failed:', err);
      throw new Error(
        `OpenAI streaming failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getCapabilities(model?: string) {
    const activeModel = model ?? this.model;
    const isReasoningModel = activeModel.includes('gpt-5');
    const isMiniModel = activeModel.includes('mini');
    const isNanoModel = activeModel.includes('nano');

    let maxReasoningEffort = 'xhigh';
    if (isMiniModel) maxReasoningEffort = 'high';
    else if (isNanoModel) maxReasoningEffort = 'medium';

    return {
      supportedReasoningProfiles: isReasoningModel
        ? [
            ReasoningProfile.FAST,
            ReasoningProfile.STANDARD,
            ReasoningProfile.THINKING,
            ReasoningProfile.DEEP,
          ]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
      maxReasoningEffort,
      supportsStructuredOutput: true,
      contextWindow: 128000,
      supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
    };
  }
}
