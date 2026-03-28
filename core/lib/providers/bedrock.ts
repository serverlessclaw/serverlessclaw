import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  Message as BedrockMessage,
  SystemContentBlock,
  Tool as BedrockTool,
  ContentBlock,
  ToolResultContentBlock,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  BedrockModel,
  Attachment,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';
import { normalizeProfile, createEmptyResponse, SUPPORTED_IMAGE_FORMATS } from './utils';

// --- Constants and Configuration ---
const DEFAULT_REGION = 'ap-southeast-2';
const DEFAULT_TOP_P = 0.9;
const DEFAULT_CONTEXT_WINDOW = 200000;
const CLAUDE_46_MODELS = ['claude-sonnet-4-6', 'claude-4-6', 'claude-v4.6'];

/**
 * Dimensions and options for the 'computer' tool in computer-use scenarios.
 */
const COMPUTER_USE_OPTIONS = {
  display_height: 768,
  display_width: 1024,
  display_number: 0,
};

/**
 * Standardized Bedrock values for type safety and AI signal clarity.
 */
const BEDROCK_CONSTANTS = {
  ROLES: {
    USER: 'user' as const,
    ASSISTANT: 'assistant' as const,
  },
  DOC_FORMATS: {
    PDF: 'pdf' as const,
    CSV: 'csv' as const,
    DOC: 'doc' as const,
    DOCX: 'docx' as const,
    XLS: 'xls' as const,
    XLSX: 'xlsx' as const,
    HTML: 'html' as const,
    TXT: 'txt' as const,
    MD: 'md' as const,
  },
  IMG_FORMATS: {
    PNG: 'png' as const,
    JPEG: 'jpeg' as const,
    GIF: 'gif' as const,
    WEBP: 'webp' as const,
  },
  TOOL_TYPES: {
    COMPUTER_USE: 'computer_use',
    FUNCTION: 'function',
  },
  TOOL_NAMES: {
    COMPUTER: 'computer',
  },
  RESPONSE_FORMATS: {
    JSON: 'json' as const,
    JSON_SCHEMA: 'json_schema',
  },
} as const;

type BedrockDocFormat =
  (typeof BEDROCK_CONSTANTS.DOC_FORMATS)[keyof typeof BEDROCK_CONSTANTS.DOC_FORMATS];

/**
 * Configuration for models that support reasoning/thinking budgets.
 */
interface BedrockReasoningConfig {
  thinkingBudget: number;
  thinkingEnabled: boolean;
  maxTokens: number;
  temperature: number;
}

/**
 * Interface for SST Resource object to avoid 'as any' assertions.
 */
interface ClawSstResource {
  AwsRegion?: { value: string };
  [key: string]: unknown;
}

/**
 * Interface for document attachments in Bedrock Converse API.
 */
interface BedrockDocumentBlock {
  document: {
    name: string;
    format: BedrockDocFormat;
    source: {
      bytes: Uint8Array | Buffer;
    };
  };
}

const BEDROCK_REASONING_MAP: Record<ReasoningProfile, BedrockReasoningConfig> = {
  [ReasoningProfile.FAST]: {
    thinkingBudget: 0,
    thinkingEnabled: false,
    maxTokens: 4096,
    temperature: 0.7,
  },
  [ReasoningProfile.STANDARD]: {
    thinkingBudget: 1024,
    thinkingEnabled: true,
    maxTokens: 8192,
    temperature: 0.7,
  },
  [ReasoningProfile.THINKING]: {
    thinkingBudget: 4096,
    thinkingEnabled: true,
    maxTokens: 12288,
    temperature: 1.0,
  },
  [ReasoningProfile.DEEP]: {
    thinkingBudget: 32768,
    thinkingEnabled: true,
    maxTokens: 49152,
    temperature: 1.0,
  },
};

/**
 * Helper to convert a Claw message to a Bedrock Converse API message.
 * @param message The input Claw message.
 * @returns A formatted Bedrock message block.
 */
function convertToBedrockMessage(message: Message): BedrockMessage {
  const role =
    message.role === MessageRole.ASSISTANT
      ? BEDROCK_CONSTANTS.ROLES.ASSISTANT
      : BEDROCK_CONSTANTS.ROLES.USER;

  const content: ContentBlock[] = [{ text: message.content ?? '' }];

  if (message.attachments && message.role !== MessageRole.TOOL) {
    message.attachments.forEach((attachment) => {
      const block = createAttachmentBlock(attachment);
      if (block) content.push(block as ContentBlock);
    });
  }

  if (message.tool_calls) {
    message.tool_calls.forEach((toolCall) => {
      content.push({
        toolUse: {
          toolUseId: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
        },
      });
    });
  }

  if (message.role === MessageRole.TOOL) {
    const toolContent: ToolResultContentBlock[] = [{ text: message.content ?? '' }];

    if (message.attachments) {
      message.attachments.forEach((attachment) => {
        const block = createAttachmentBlock(attachment);
        if (block) toolContent.push(block as ToolResultContentBlock);
      });
    }

    content.push({
      toolResult: {
        toolUseId: message.tool_call_id!,
        content: toolContent,
        status: 'success',
      },
    });
  }

  return { role, content };
}

/**
 * Helper to create an attachment block (image or document) for Bedrock.
 * @param attachment The input attachment.
 * @returns A content block or null if unsupported.
 */
function createAttachmentBlock(
  attachment: Attachment
): ContentBlock | ToolResultContentBlock | null {
  const format = (
    attachment.mimeType?.split('/')[1] ?? BEDROCK_CONSTANTS.IMG_FORMATS.PNG
  ).toLowerCase();

  if (
    attachment.type === 'image' &&
    (SUPPORTED_IMAGE_FORMATS as readonly string[]).includes(format)
  ) {
    return {
      image: {
        format:
          format as (typeof BEDROCK_CONSTANTS.IMG_FORMATS)[keyof typeof BEDROCK_CONSTANTS.IMG_FORMATS],
        source: {
          bytes: attachment.base64 ? Buffer.from(attachment.base64, 'base64') : new Uint8Array(),
        },
      },
    };
  }

  if (attachment.type === 'file') {
    const docFormat = format as BedrockDocFormat;
    const docBlock: BedrockDocumentBlock = {
      document: {
        name: attachment.name ?? 'document',
        format: docFormat,
        source: {
          bytes: attachment.base64 ? Buffer.from(attachment.base64, 'base64') : new Uint8Array(),
        },
      },
    };
    return docBlock as unknown as ContentBlock;
  }

  return null;
}

/**
 * Provider for AWS Bedrock LLM services, specifically optimized for Anthropic Claude 4.6.
 * Implements 'thinking' budgets and native multi-modal support via the Converse API.
 */
export class BedrockProvider implements IProvider {
  /**
   * Initializes the Bedrock provider.
   * @param modelId The model ID to use (defaults to Claude 4.6).
   */
  constructor(private modelId: string = BedrockModel.CLAUDE_4_6) {}

  /**
   * Performs a non-streaming chat completion call via Bedrock Converse API.
   *
   * @param messages The conversation history.
   * @param tools Optional list of tools for function calling.
   * @param profile The preferred reasoning profile.
   * @param model Override for the model ID.
   * @param _provider Ignored provider identifier.
   * @param responseFormat Preferred format for the response.
   * @returns A promise resolving to the assistant's message.
   */
  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string,
    responseFormat?: import('../types/index').ResponseFormat
  ): Promise<Message> {
    const sstResource = Resource as unknown as ClawSstResource;
    const client = new BedrockRuntimeClient({
      region: sstResource.AwsRegion?.value ?? DEFAULT_REGION,
    });
    const activeModelId = model ?? this.modelId;

    const capabilities = await this.getCapabilities(activeModelId);
    profile = normalizeProfile(profile, capabilities, activeModelId);

    const config = BEDROCK_REASONING_MAP[profile];

    const bedrockMessages: BedrockMessage[] = messages
      .filter((m) => m.role !== MessageRole.SYSTEM && m.role !== MessageRole.DEVELOPER)
      .map(convertToBedrockMessage);

    const system: SystemContentBlock[] = messages
      .filter((m) => m.role === MessageRole.SYSTEM || m.role === MessageRole.DEVELOPER)
      .map((m) => ({ text: m.content ?? '' }));

    const bedrockTools: BedrockTool[] | undefined = tools
      ?.filter(
        (t) =>
          !t.type ||
          t.type === BEDROCK_CONSTANTS.TOOL_TYPES.FUNCTION ||
          t.type === BEDROCK_CONSTANTS.TOOL_TYPES.COMPUTER_USE
      )
      .map((tool) => {
        if (tool.type === BEDROCK_CONSTANTS.TOOL_TYPES.COMPUTER_USE) {
          return {
            [tool.name]: {
              display_name: tool.name,
              type: tool.type,
              ...(tool.name === BEDROCK_CONSTANTS.TOOL_NAMES.COMPUTER
                ? { options: COMPUTER_USE_OPTIONS }
                : {}),
            },
          } as unknown as BedrockTool;
        }
        return {
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.parameters as unknown as Record<string, unknown> },
          },
        } as BedrockTool;
      });

    const command = new ConverseCommand({
      modelId: activeModelId,
      messages: bedrockMessages,
      system,
      toolConfig: bedrockTools ? { tools: bedrockTools } : undefined,
      inferenceConfig: {
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        topP: DEFAULT_TOP_P,
      },
      additionalModelRequestFields: {
        ...(config.thinkingEnabled
          ? { thinking: { type: 'enabled', budget_tokens: config.thinkingBudget } }
          : {}),
      },
      ...(responseFormat?.type === BEDROCK_CONSTANTS.RESPONSE_FORMATS.JSON_SCHEMA
        ? { outputConfig: { format: BEDROCK_CONSTANTS.RESPONSE_FORMATS.JSON } }
        : {}),
    } as unknown as ConstructorParameters<typeof ConverseCommand>[0]);

    const response = await client.send(command);

    if (response.output?.message) {
      const msg = response.output.message;

      interface ReasoningBlock {
        reasoningContent?: { reasoningText?: { text?: string } };
      }

      const thought = (msg.content as (ContentBlock | ReasoningBlock)[])
        ?.filter((c) => !!(c as ReasoningBlock).reasoningContent)
        .map((c) => (c as ReasoningBlock).reasoningContent?.reasoningText?.text ?? '')
        .join('\n\n');

      if (thought) logger.debug(`[Bedrock Reasoning] for ${activeModelId}:`, thought);

      const content = msg.content
        ?.filter((c) => c.text)
        .map((c) => c.text)
        .join('\n\n');

      return {
        role: MessageRole.ASSISTANT,
        content: content ?? '',
        thought: thought || undefined,
        tool_calls: msg.content
          ?.filter((c) => c.toolUse)
          .map((c) => ({
            id: c.toolUse!.toolUseId!,
            type: BEDROCK_CONSTANTS.TOOL_TYPES.FUNCTION,
            function: {
              name: c.toolUse!.name!,
              arguments: JSON.stringify(c.toolUse!.input),
            },
          })),
        usage: response.usage
          ? {
              prompt_tokens: response.usage.inputTokens ?? 0,
              completion_tokens: response.usage.outputTokens ?? 0,
              total_tokens: response.usage.totalTokens ?? 0,
            }
          : undefined,
      } as Message;
    }

    return createEmptyResponse('Bedrock');
  }

  /**
   * Performs a streaming chat completion call via Bedrock Converse Stream API.
   */
  async *stream(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string,
    responseFormat?: import('../types/index').ResponseFormat
  ): AsyncIterable<import('../types/index').MessageChunk> {
    const sstResource = Resource as unknown as ClawSstResource;
    const client = new BedrockRuntimeClient({
      region: sstResource.AwsRegion?.value ?? DEFAULT_REGION,
    });
    const activeModelId = model ?? this.modelId;

    const capabilities = await this.getCapabilities(activeModelId);
    profile = normalizeProfile(profile, capabilities, activeModelId);

    const config = BEDROCK_REASONING_MAP[profile];

    const bedrockMessages: BedrockMessage[] = messages
      .filter((m) => m.role !== MessageRole.SYSTEM && m.role !== MessageRole.DEVELOPER)
      .map(convertToBedrockMessage);

    const system: SystemContentBlock[] = messages
      .filter((m) => m.role === MessageRole.SYSTEM || m.role === MessageRole.DEVELOPER)
      .map((m) => ({ text: m.content ?? '' }));

    const bedrockTools: BedrockTool[] | undefined = tools
      ?.filter(
        (t) =>
          !t.type ||
          t.type === BEDROCK_CONSTANTS.TOOL_TYPES.FUNCTION ||
          t.type === BEDROCK_CONSTANTS.TOOL_TYPES.COMPUTER_USE
      )
      .map((tool) => {
        if (tool.type === BEDROCK_CONSTANTS.TOOL_TYPES.COMPUTER_USE) {
          return {
            [tool.name]: {
              display_name: tool.name,
              type: tool.type,
              ...(tool.name === BEDROCK_CONSTANTS.TOOL_NAMES.COMPUTER
                ? { options: COMPUTER_USE_OPTIONS }
                : {}),
            },
          } as unknown as BedrockTool;
        }
        return {
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: tool.parameters as unknown as Record<string, unknown> },
          },
        } as BedrockTool;
      });

    try {
      const command = new ConverseStreamCommand({
        modelId: activeModelId,
        messages: bedrockMessages,
        system,
        toolConfig: bedrockTools ? { tools: bedrockTools } : undefined,
        inferenceConfig: {
          maxTokens: config.maxTokens,
          temperature: config.temperature,
          topP: DEFAULT_TOP_P,
        },
        additionalModelRequestFields: {
          ...(config.thinkingEnabled
            ? { thinking: { type: 'enabled', budget_tokens: config.thinkingBudget } }
            : {}),
        },
        ...(responseFormat?.type === BEDROCK_CONSTANTS.RESPONSE_FORMATS.JSON_SCHEMA
          ? { outputConfig: { format: BEDROCK_CONSTANTS.RESPONSE_FORMATS.JSON } }
          : {}),
      } as unknown as ConstructorParameters<typeof ConverseStreamCommand>[0]);

      const response = await client.send(command);

      if (!response.stream) {
        yield { content: ' (No stream)' };
        return;
      }

      const activeToolCalls: Map<number, { id: string; name: string; arguments: string }> =
        new Map();

      for await (const event of response.stream as AsyncIterable<ConverseStreamOutput>) {
        if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta.delta;
          if (!delta) continue;

          if ('text' in delta && delta.text) yield { content: delta.text };
          else if ('reasoningContent' in delta && delta.reasoningContent) {
            const rc = delta.reasoningContent;
            if ('text' in rc && rc.text) yield { thought: rc.text };
          } else if ('toolUse' in delta && delta.toolUse) {
            const idx = event.contentBlockDelta.contentBlockIndex ?? 0;
            const existing = activeToolCalls.get(idx);
            if (existing) existing.arguments += (delta.toolUse as { input?: string }).input ?? '';
          }
        } else if (event.contentBlockStart) {
          const start = event.contentBlockStart.start;
          if (start && 'toolUse' in start && start.toolUse) {
            const idx = event.contentBlockStart.contentBlockIndex ?? 0;
            activeToolCalls.set(idx, {
              id: start.toolUse.toolUseId ?? '',
              name: start.toolUse.name ?? '',
              arguments: '',
            });
          }
        } else if (event.contentBlockStop) {
          const idx = event.contentBlockStop.contentBlockIndex ?? 0;
          const toolCall = activeToolCalls.get(idx);
          if (toolCall) {
            yield {
              tool_calls: [
                {
                  id: toolCall.id,
                  type: BEDROCK_CONSTANTS.TOOL_TYPES.FUNCTION,
                  function: { name: toolCall.name, arguments: toolCall.arguments },
                },
              ],
            };
            activeToolCalls.delete(idx);
          }
        } else if (event.metadata) {
          const usage = event.metadata.usage;
          if (usage) {
            yield {
              usage: {
                prompt_tokens: usage.inputTokens ?? 0,
                completion_tokens: usage.outputTokens ?? 0,
                total_tokens: usage.totalTokens ?? 0,
              },
            };
          }
        }
      }
    } catch (err) {
      logger.error('Bedrock streaming failed:', err);
      yield { content: ' (Streaming failed)' };
    }
  }

  /**
   * Retrieves the capabilities of a specific model on Bedrock.
   *
   * @param model The model ID to check.
   * @returns An object describing reasoning profiles, structured output support, and context window.
   */
  async getCapabilities(model?: string) {
    const activeModelId = model ?? this.modelId;
    const isClaude46 = CLAUDE_46_MODELS.some((m) => activeModelId.includes(m));

    return {
      supportedReasoningProfiles: isClaude46
        ? [
            ReasoningProfile.FAST,
            ReasoningProfile.STANDARD,
            ReasoningProfile.THINKING,
            ReasoningProfile.DEEP,
          ]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
      supportsStructuredOutput: isClaude46,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    };
  }
}
