import Anthropic from '@anthropic-ai/sdk';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  AttachmentType,
  MessageRole,
  MiniMaxModel,
  ToolCall,
  MessageChunk,
  ResponseFormat,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';
// createEmptyResponse removed - providers now throw on failure

const MINIMAX_REASONING_MAP: Record<ReasoningProfile, { budget_tokens: number; enabled: boolean }> =
  {
    [ReasoningProfile.FAST]: { budget_tokens: 2000, enabled: false },
    [ReasoningProfile.STANDARD]: { budget_tokens: 4000, enabled: true },
    [ReasoningProfile.THINKING]: { budget_tokens: 8000, enabled: true },
    [ReasoningProfile.DEEP]: { budget_tokens: 16000, enabled: true },
  };

/**
 * Direct provider for MiniMax API using Anthropic-compatible endpoint.
 * Provides native access to MiniMax M2.7 models with reasoning capabilities.
 *
 * MiniMax M2.7 is their latest model with:
 * - 204,800 context window
 * - Interleaved thinking for tool use
 * - Advanced reasoning capabilities
 * - ~60 tps output speed (standard) / ~100 tps (highspeed variant)
 *
 * Uses Anthropic-compatible API (MiniMax's recommended approach) for:
 * - Native reasoning support
 * - Better tool use with interleaved thinking
 * - Direct API connection instead of OpenRouter for lower latency
 */
export class MiniMaxProvider implements IProvider {
  constructor(private model: string = MiniMaxModel.M2_7) {}

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
    const typedResource = Resource as unknown as import('../types/system').SSTResource;
    const apiKey = typedResource.MiniMaxApiKey?.value ?? '';
    const activeModel = model ?? this.model;

    const reasoningConfig = MINIMAX_REASONING_MAP[profile];

    // Initialize Anthropic client with MiniMax's base URL
    const client = new Anthropic({
      apiKey,
      baseURL: 'https://api.minimax.io/anthropic',
    });

    // Extract system message and convert messages to Anthropic format
    const { systemMessage, anthropicMessages } = this.convertMessages(messages);

    // Build request parameters
    const requestParams: Record<string, unknown> = {
      model: activeModel,
      max_tokens: maxTokens ?? 4096,
      messages: anthropicMessages,
      ...(systemMessage ? { system: systemMessage } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stop_sequences: stopSequences } : {}),
      ...(reasoningConfig.enabled && responseFormat?.type !== 'json_schema'
        ? {
            thinking: {
              type: 'enabled',
              budget_tokens: reasoningConfig.budget_tokens,
            },
          }
        : {}),
    };

    if (tools && tools.length > 0) {
      requestParams['tools'] = this.transformToolsToAnthropic(tools);
    }

    if (responseFormat?.type === 'json_schema' && responseFormat.json_schema) {
      requestParams['output_config'] = {
        format: {
          type: 'json_schema',
          schema: responseFormat.json_schema.schema,
        },
      };
    }

    // Make the API call
    const response = await client.messages.create(
      requestParams as unknown as Anthropic.MessageCreateParamsNonStreaming
    );

    // Handle response with thinking blocks
    const content = response.content;
    if (!content || content.length === 0) {
      throw new Error('MiniMax provider call failed: No content in response');
    }

    // Extract text content and log thinking content
    let textContent = '';
    const tool_calls: ToolCall[] = [];

    for (const block of content) {
      if (block.type === 'thinking') {
        logger.debug(
          `[MiniMax Thinking] for ${activeModel}:`,
          (block as { thinking?: string }).thinking ?? ''
        );
      } else if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        tool_calls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      role: MessageRole.ASSISTANT,
      content: textContent || undefined,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      traceId: messages[0]?.traceId ?? 'unknown-trace',
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
    } as unknown as Message;
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
    const typedResource = Resource as unknown as import('../types/system').SSTResource;
    const apiKey = typedResource.MiniMaxApiKey?.value ?? '';
    const activeModel = model ?? this.model;

    const reasoningConfig = MINIMAX_REASONING_MAP[profile];

    // Initialize Anthropic client with MiniMax's base URL
    const client = new Anthropic({
      apiKey,
      baseURL: 'https://api.minimax.io/anthropic',
    });

    // Extract system message and convert messages to Anthropic format
    const { systemMessage, anthropicMessages } = this.convertMessages(messages);

    // Build request parameters
    const requestParams: Record<string, unknown> = {
      model: activeModel,
      max_tokens: maxTokens ?? 4096,
      messages: anthropicMessages,
      stream: true,
      ...(systemMessage ? { system: systemMessage } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stop_sequences: stopSequences } : {}),
      ...(reasoningConfig.enabled && responseFormat?.type !== 'json_schema'
        ? {
            thinking: {
              type: 'enabled',
              budget_tokens: reasoningConfig.budget_tokens,
            },
          }
        : {}),
    };

    if (tools && tools.length > 0) {
      requestParams['tools'] = this.transformToolsToAnthropic(tools);
    }

    if (responseFormat?.type === 'json_schema' && responseFormat.json_schema) {
      requestParams['output_config'] = {
        format: {
          type: 'json_schema',
          schema: responseFormat.json_schema.schema,
        },
      };
    }

    try {
      const stream = (await client.messages.create(
        requestParams as unknown as Anthropic.MessageCreateParams
      )) as unknown as AsyncIterable<Anthropic.MessageStreamEvent>;

      let currentToolCall: ToolCall | null = null;
      const toolCalls: ToolCall[] = [];

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
          currentToolCall = {
            id: chunk.content_block.id,
            type: 'function',
            function: {
              name: chunk.content_block.name,
              arguments: '',
            },
          };
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'thinking_delta') {
            yield { thought: chunk.delta.thinking };
          } else if (chunk.delta.type === 'text_delta') {
            yield { content: chunk.delta.text };
          } else if (chunk.delta.type === 'input_json_delta' && currentToolCall) {
            currentToolCall.function.arguments += chunk.delta.partial_json;
          }
        } else if (chunk.type === 'content_block_stop' && currentToolCall) {
          toolCalls.push(currentToolCall);
          yield { tool_calls: [currentToolCall] };
          currentToolCall = null;
        } else if (chunk.type === 'message_delta' && chunk.usage) {
          yield {
            usage: {
              prompt_tokens: 0,
              completion_tokens: chunk.usage.output_tokens,
              total_tokens: chunk.usage.output_tokens,
            },
          };
        } else if (chunk.type === 'message_start' && chunk.message.usage) {
          yield {
            usage: {
              prompt_tokens: chunk.message.usage.input_tokens,
              completion_tokens: chunk.message.usage.output_tokens,
              total_tokens: chunk.message.usage.input_tokens + chunk.message.usage.output_tokens,
            },
          };
        }
      }
    } catch (err) {
      logger.error('MiniMax streaming failed:', err);
      yield { content: ' (Streaming failed)' };
    }
  }

  /**
   * Extract system message and convert messages to Anthropic SDK format.
   */
  private convertMessages(messages: Message[]): {
    systemMessage: string | undefined;
    anthropicMessages: Anthropic.MessageParam[];
  } {
    let systemMessage: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === MessageRole.SYSTEM) {
        systemMessage = msg.content ?? undefined;
      } else if (msg.role === MessageRole.USER) {
        if (msg.attachments && msg.attachments.length > 0) {
          const content: unknown[] = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          for (const att of msg.attachments) {
            if (att.type === 'image' && att.base64) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: att.mimeType || 'image/png',
                  data: att.base64,
                },
              });
            } else if (att.type === 'file' && att.base64) {
              content.push({
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: att.mimeType || 'application/pdf',
                  data: att.base64,
                },
              });
            }
          }
          anthropicMessages.push({
            role: 'user',
            content: content as Anthropic.MessageParam['content'],
          });
        } else {
          anthropicMessages.push({
            role: 'user',
            content: msg.content ?? '',
          });
        }
      } else if (msg.role === MessageRole.ASSISTANT) {
        // For assistant messages with tool calls, we need to convert them
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Convert tool calls to Anthropic format
          const toolUseBlocks: unknown[] = msg.tool_calls.map((tc) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          }));

          anthropicMessages.push({
            role: 'assistant',
            content: [
              ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
              ...toolUseBlocks,
            ] as Anthropic.MessageParam['content'],
          });
        } else {
          anthropicMessages.push({
            role: 'assistant',
            content: msg.content ?? '',
          });
        }
      } else if (msg.role === MessageRole.TOOL) {
        // Tool result messages
        if (msg.attachments && msg.attachments.length > 0) {
          const content: unknown[] = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          for (const att of msg.attachments) {
            if (att.type === 'image' && att.base64) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: att.mimeType || 'image/png',
                  data: att.base64,
                },
              });
            }
          }
          anthropicMessages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id ?? '',
                content: content as unknown as (
                  | Anthropic.TextBlockParam
                  | Anthropic.ImageBlockParam
                )[],
              },
            ],
          });
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id ?? '',
                content: msg.content ?? '',
              },
            ],
          });
        }
      }
    }

    return { systemMessage, anthropicMessages };
  }

  /**
   * Transform tools to Anthropic format.
   */
  private transformToolsToAnthropic(tools: ITool[]) {
    return tools
      .filter((t) => !t.type || t.type === 'function')
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
  }

  async getCapabilities(_model?: string) {
    // MiniMax M2.7 has 204,800 context window
    const contextWindow = 204800;

    return {
      supportedReasoningProfiles: [
        ReasoningProfile.FAST,
        ReasoningProfile.STANDARD,
        ReasoningProfile.THINKING,
        ReasoningProfile.DEEP,
      ],
      maxReasoningEffort: 'high',
      supportsStructuredOutput: true,
      contextWindow,
      supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
    };
  }
}
