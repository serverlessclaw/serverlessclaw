import Anthropic from '@anthropic-ai/sdk';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  MiniMaxModel,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';
import { createEmptyResponse } from './utils';

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
    _responseFormat?: import('../types/index').ResponseFormat
  ): Promise<Message> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = Resource as any;
    const apiKey = ('MiniMaxApiKey' in resource ? resource.MiniMaxApiKey.value : '') ?? '';
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
      max_tokens: 4096,
      messages: anthropicMessages,
      ...(systemMessage ? { system: systemMessage } : {}),
      ...(reasoningConfig.enabled
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

    // Make the API call
    const response = await client.messages.create(
      requestParams as unknown as Anthropic.MessageCreateParamsNonStreaming
    );

    // Handle response with thinking blocks
    const content = response.content;
    if (!content || content.length === 0) {
      return createEmptyResponse('MiniMax');
    }

    // Extract text content and log thinking content
    let textContent = '';
    for (const block of content) {
      if (block.type === 'thinking') {
        logger.debug(
          `[MiniMax Thinking] for ${activeModel}:`,
          (block as { thinking?: string }).thinking ?? ''
        );
      } else if (block.type === 'text') {
        textContent += block.text;
      }
    }

    return {
      role: MessageRole.ASSISTANT,
      content: textContent,
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
    } as Message;
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
        anthropicMessages.push({
          role: 'user',
          content: msg.content ?? '',
        });
      } else if (msg.role === MessageRole.ASSISTANT) {
        // For assistant messages with tool calls, we need to convert them
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Convert tool calls to Anthropic format
          const toolUseBlocks: Anthropic.ToolUseBlock[] = msg.tool_calls.map((tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          }));

          anthropicMessages.push({
            role: 'assistant',
            content: [
              ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
              ...toolUseBlocks,
            ],
          });
        } else {
          anthropicMessages.push({
            role: 'assistant',
            content: msg.content ?? '',
          });
        }
      } else if (msg.role === MessageRole.TOOL) {
        // Tool result messages
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

  /**
   * Get thinking budget tokens based on effort level.
   */
  private getThinkingBudget(effort: string): number {
    switch (effort) {
      case 'high':
        return 16000;
      case 'medium':
        return 8000;
      case 'low':
      default:
        return 4000;
    }
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
    };
  }
}
