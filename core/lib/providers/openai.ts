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
import { normalizeProfile, capEffort, createEmptyResponse } from './utils';

interface OpenAIResponse {
  output_text?: string;
  output_thought?: string;
  output?: Array<{
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
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
  constructor(private model: string = OpenAIModel.GPT_5_4) {}

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
    const resource = Resource as unknown as Record<string, { value?: string } | undefined>;
    const apiKey =
      ('OpenAIApiKey' in resource ? resource.OpenAIApiKey?.value : undefined) ||
      process.env.OPENAI_API_KEY ||
      'test-key';
    const client = new OpenAI({ apiKey });

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

    try {
      const response = (await client.responses.create({
        model: activeModel as OpenAI.ResponsesModel,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: responsesInput as any,
        reasoning: { effort: reasoningEffort as OpenAI.ReasoningEffort },
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
      })) as unknown as OpenAIResponse; // Isolate unsafe access

      // Extract output
      const content = response.output_text ?? '';
      const thought = response.output_thought;
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
      return createEmptyResponse('OpenAI');
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
  ): AsyncIterable<MessageChunk> {
    const resource = Resource as unknown as Record<string, { value?: string } | undefined>;
    const apiKey =
      ('OpenAIApiKey' in resource ? resource.OpenAIApiKey?.value : undefined) ||
      process.env.OPENAI_API_KEY ||
      'test-key';
    const client = new OpenAI({ apiKey });

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

    try {
      const stream = await client.responses.create({
        model: activeModel as OpenAI.ResponsesModel,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: responsesInput as any,
        reasoning: { effort: reasoningEffort as OpenAI.ReasoningEffort },
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
      });

      for await (const chunk of stream) {
        // Handle 2026 Responses API stream events
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawChunk = chunk as any;

        if (rawChunk.type === 'text.delta' && rawChunk.delta) {
          yield { content: rawChunk.delta };
        } else if (rawChunk.type === 'output_text.delta' && rawChunk.delta) {
          yield { content: rawChunk.delta };
        } else if (rawChunk.type === 'reasoning.delta' && rawChunk.delta) {
          yield { thought: rawChunk.delta };
        } else if (rawChunk.type === 'output_thought.delta' && rawChunk.delta) {
          yield { thought: rawChunk.delta };
        } else if (rawChunk.type === 'message.delta' && rawChunk.delta?.content) {
          yield { content: rawChunk.delta.content };
        } else if (rawChunk.type === 'message.delta' && rawChunk.delta?.reasoning) {
          yield { thought: rawChunk.delta.reasoning };
        } else if (rawChunk.type === 'usage' && rawChunk.usage) {
          yield {
            usage: {
              prompt_tokens: rawChunk.usage.prompt_tokens ?? 0,
              completion_tokens: rawChunk.usage.completion_tokens ?? 0,
              total_tokens: rawChunk.usage.total_tokens ?? 0,
            },
          };
        }
      }
    } catch (err) {
      logger.error('OpenAI streaming failed:', err);
      yield { content: ' (Streaming failed)' };
    }
  }

  async getCapabilities(model?: string) {
    const activeModel = model ?? this.model;
    const isReasoningModel = activeModel.includes('gpt-5');
    const isMiniModel = activeModel.includes('mini');
    const isNanoModel = activeModel.includes('nano');

    let maxReasoningEffort = 'xhigh';
    if (isMiniModel) maxReasoningEffort = 'xhigh';
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
