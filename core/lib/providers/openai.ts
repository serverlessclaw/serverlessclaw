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
import { OPENAI } from '../constants';
import { logger } from '../logger';
import { normalizeProfile, capEffort, resolveProviderApiKey } from './utils';
import { OpenAIResponse } from './openai/types';
import {
  shouldRequestReasoningSummary,
  isReasoningSummaryUnsupportedError,
  extractSummaryText,
  extractReasoningSummary,
  splitThoughtIntoChunks,
  mapMessagesToResponsesInput,
  mapToolsToOpenAI,
} from './openai/utils';

const REASONING_MAP: Record<ReasoningProfile, OpenAI.ReasoningEffort> = {
  [ReasoningProfile.FAST]: 'low',
  [ReasoningProfile.STANDARD]: 'medium',
  [ReasoningProfile.THINKING]: 'xhigh',
  [ReasoningProfile.DEEP]: 'xhigh',
};

/**
 * Provider for OpenAI's LLM services, supporting GPT-5 and reasoning models.
 * Utilizes the Responses API for 2026-grade reasoning and tool use.
 */
export class OpenAIProvider implements IProvider {
  private static _client: OpenAI | null = null;
  private static _currentKey: string | null = null;

  constructor(private model: string = OpenAIModel.GPT_5_4) {}

  /**
   * Lazily initializes and returns the OpenAI client instance.
   * Handles API key rotation if the key is updated in the environment.
   */
  private get client(): OpenAI {
    const apiKey = resolveProviderApiKey('OpenAI', 'OpenAIApiKey', 'OPENAI_API_KEY');

    if (!OpenAIProvider._client || OpenAIProvider._currentKey !== apiKey) {
      OpenAIProvider._client = new OpenAI({ apiKey });
      OpenAIProvider._currentKey = apiKey;
    }
    return OpenAIProvider._client;
  }

  /**
   * Executes a non-streaming call to the OpenAI Responses API.
   * @param messages - Array of conversation history.
   * @param tools - Optional list of available tools.
   * @param profile - Reasoning profile (FAST, STANDARD, THINKING, DEEP).
   * @param model - Specific model override.
   * @param responseFormat - Schema for structured output.
   * @returns A Promise resolving to the assistant's message.
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

    const responsesInput = mapMessagesToResponsesInput(messages);

    const shouldRequestSummary = shouldRequestReasoningSummary(activeModel, requestedProfile);

    const requestPayload: Record<string, unknown> = {
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
            tools: mapToolsToOpenAI(tools) as any,
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
        if (!shouldRequestSummary || !isReasoningSummaryUnsupportedError(err)) {
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
      const thought = response.output_thought ?? extractReasoningSummary(response.output);
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

  /**
   * Executes a streaming call to the OpenAI Responses API.
   * Yields content, thought, and tool call chunks as they arrive.
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

    const responsesInput = mapMessagesToResponsesInput(messages);

    const shouldRequestSummary = shouldRequestReasoningSummary(activeModel, requestedProfile);

    const requestPayload: Record<string, unknown> = {
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
            tools: mapToolsToOpenAI(tools) as any,
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
        if (!shouldRequestSummary || !isReasoningSummaryUnsupportedError(err)) {
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
        const delta = rawChunk.delta ?? rawChunk.item?.delta;

        const isContentEvent =
          type === OPENAI.EVENT_TYPES.TEXT_DELTA ||
          type === OPENAI.EVENT_TYPES.OUTPUT_TEXT_DELTA ||
          type === OPENAI.EVENT_TYPES.RESPONSE_TEXT_DELTA ||
          type === OPENAI.EVENT_TYPES.RESPONSE_OUTPUT_TEXT_DELTA;
        const isThoughtEvent =
          type === OPENAI.EVENT_TYPES.REASONING_DELTA ||
          type === OPENAI.EVENT_TYPES.OUTPUT_THOUGHT_DELTA ||
          type === OPENAI.EVENT_TYPES.THOUGHT_DELTA ||
          type === OPENAI.EVENT_TYPES.RESPONSE_REASONING_DELTA ||
          type === OPENAI.EVENT_TYPES.RESPONSE_OUTPUT_THOUGHT_DELTA ||
          type === OPENAI.EVENT_TYPES.RESPONSE_THOUGHT_DELTA ||
          !!rawChunk.delta?.reasoning_content ||
          !!rawChunk.item?.delta?.reasoning_content;

        const isReasoningSummaryItemDone =
          type === OPENAI.EVENT_TYPES.OUTPUT_ITEM_DONE ||
          type === OPENAI.EVENT_TYPES.RESPONSE_OUTPUT_ITEM_DONE;

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
          (type === OPENAI.EVENT_TYPES.MESSAGE_DELTA ||
            type === OPENAI.EVENT_TYPES.RESPONSE_MESSAGE_DELTA) &&
          rawChunk.delta
        ) {
          if (rawChunk.delta.content) yield { content: rawChunk.delta.content };
          if (rawChunk.delta.reasoning) yield { thought: rawChunk.delta.reasoning };
        } else if (
          isReasoningSummaryItemDone &&
          rawChunk.item?.type === OPENAI.STREAM_PROPS.REASONING &&
          Array.isArray(rawChunk.item?.summary)
        ) {
          const summaryText = extractSummaryText(rawChunk.item.summary);
          if (summaryText.length > 0) {
            const summaryChunks = splitThoughtIntoChunks(summaryText);
            for (const thoughtChunk of summaryChunks) {
              yield { thought: thoughtChunk };
            }
          }
        } else if (
          isReasoningSummaryItemDone &&
          rawChunk.item?.type === OPENAI.STREAM_PROPS.FUNCTION_CALL
        ) {
          yield {
            tool_calls: [
              {
                id: rawChunk.item.call_id ?? '',
                type: OPENAI.FUNCTION_TYPE,
                function: {
                  name: rawChunk.item.name ?? '',
                  arguments: rawChunk.item.arguments ?? '',
                },
              },
            ],
          };
        } else if (
          (type === OPENAI.EVENT_TYPES.USAGE || type === OPENAI.EVENT_TYPES.RESPONSE_USAGE) &&
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

  /**
   * Returns the capabilities of the provider for the given model.
   * @param model - The model identifier.
   */
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
