import {
  BedrockRuntimeClient,
  ConverseCommand,
  Message as BedrockMessage,
  SystemContentBlock,
  Tool as BedrockTool,
  ContentBlock,
  ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import {
  IProvider,
  Message,
  ITool,
  ReasoningProfile,
  MessageRole,
  BedrockModel,
} from '../types/index';
import { Resource } from 'sst';
import { logger } from '../logger';

interface BedrockResource {
  AwsRegion: { value: string };
}

interface BedrockReasoningConfig {
  thinkingBudget: number;
  thinkingEnabled: boolean;
  maxTokens: number;
  temperature: number;
}

const imgFormats = ['png', 'jpeg', 'gif', 'webp'];

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

export class BedrockProvider implements IProvider {
  constructor(private modelId: string = BedrockModel.CLAUDE_4_6) {}

  async call(
    messages: Message[],
    tools?: ITool[],
    profile: ReasoningProfile = ReasoningProfile.STANDARD,
    model?: string,
    _provider?: string
  ): Promise<Message> {
    const typedResource = Resource as unknown as BedrockResource;
    const client = new BedrockRuntimeClient({
      region: typedResource.AwsRegion?.value || 'ap-southeast-2',
    });
    const activeModelId = model || this.modelId;

    // Fallback if profile not supported
    const capabilities = await this.getCapabilities();
    if (!capabilities.supportedReasoningProfiles.includes(profile)) {
      logger.warn(
        `Profile ${profile} not supported for model ${activeModelId}, falling back to STANDARD`
      );
      profile = ReasoningProfile.STANDARD;
    }

    const reasoningConfig = BEDROCK_REASONING_MAP[profile];

    // 2026 Bedrock Optimization: Converse API System/User mapping
    const bedrockMessages: BedrockMessage[] = messages
      .filter((m) => m.role !== MessageRole.SYSTEM && m.role !== MessageRole.DEVELOPER)
      .map((m) => {
        let role: 'user' | 'assistant' = 'user';
        if (m.role === MessageRole.ASSISTANT) role = 'assistant';

        const content: ContentBlock[] = [{ text: m.content || '' }];

        if (m.tool_calls) {
          m.tool_calls.forEach(
            (tc: { id: string; function: { name: string; arguments: string } }) => {
              content.push({
                toolUse: {
                  toolUseId: tc.id,
                  name: tc.function.name,
                  input: JSON.parse(tc.function.arguments),
                },
              });
            }
          );
        }

        if (m.role === MessageRole.TOOL) {
          const toolContent: ContentBlock[] = [];

          // If content is a JSON string that might be a ToolResult, try to parse it
          // Actually, the Agent core already passes the text part if it's a ToolResult
          // But if we want to pass images back to the model, we need to handle it here.
          // Wait, the Message interface doesn't store the full ToolResult, only the text content is added to history currently.

          toolContent.push({ text: m.content || '' });

          // In 2026, we also support passing attachments from previous turns
          if (m.attachments) {
            m.attachments.forEach((att) => {
              if (imgFormats.includes(att.mimeType?.split('/')[1] || '')) {
                const format = (att.mimeType?.split('/')[1] || 'png') as
                  | 'png'
                  | 'jpeg'
                  | 'gif'
                  | 'webp';
                toolContent.push({
                  image: {
                    format,
                    source: {
                      bytes: att.base64 ? Buffer.from(att.base64, 'base64') : new Uint8Array(),
                    },
                  },
                });
              }
            });
          }

          content.push({
            toolResult: {
              toolUseId: m.tool_call_id!,
              content: toolContent as ToolResultContentBlock[],
              status: 'success',
            },
          });
        }

        return { role, content };
      });

    const system: SystemContentBlock[] = messages
      .filter((m) => m.role === MessageRole.SYSTEM || m.role === MessageRole.DEVELOPER)
      .map((m) => ({ text: m.content || '' }));

    const bedrockTools: BedrockTool[] | undefined = tools
      ?.filter((t) => !t.type || t.type === 'function' || t.type === 'computer_use')
      .map((t) => {
        if (t.type === 'computer_use') {
          // 2026: Specialized mapping for Anthropic Computer Use on Bedrock
          return {
            [t.name]: {
              display_name: t.name,
              type: t.type,
              ...(t.name === 'computer'
                ? {
                    options: { display_height: 768, display_width: 1024, display_number: 0 },
                  }
                : {}),
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any;
        }
        return {
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: {
              json: t.parameters as unknown as Record<string, unknown>,
            },
          },
        };
      }) as unknown as BedrockTool[];

    const command = new ConverseCommand({
      modelId: activeModelId,
      messages: bedrockMessages,
      system,
      toolConfig: bedrockTools ? { tools: bedrockTools } : undefined,
      inferenceConfig: {
        maxTokens: reasoningConfig.maxTokens,
        temperature: reasoningConfig.temperature,
        topP: 0.9,
      },
      additionalModelRequestFields: {
        ...(reasoningConfig.thinkingEnabled
          ? {
              thinking: {
                type: 'enabled',
                budget_tokens: reasoningConfig.thinkingBudget,
              },
            }
          : {}),
      },
    });

    const response = await client.send(command);

    if (response.output?.message) {
      const msg = response.output.message;

      interface ReasoningBlock {
        reasoningContent?: {
          reasoningText?: {
            text?: string;
          };
        };
      }

      const reasoning = (msg.content as (ContentBlock | ReasoningBlock)[])
        ?.filter((c) => !!(c as ReasoningBlock).reasoningContent)
        .map((c) => (c as ReasoningBlock).reasoningContent?.reasoningText?.text || '')
        .join('\n\n');

      if (reasoning) {
        logger.debug(`[Bedrock Reasoning] for ${activeModelId}:`, reasoning);
      }

      // Aggregate all text blocks (model might return multiple)
      const content = msg.content
        ?.filter((c) => c.text)
        .map((c) => c.text)
        .join('\n\n');

      return {
        role: MessageRole.ASSISTANT,
        content: content || '',
        tool_calls: msg.content
          ?.filter((c) => c.toolUse)
          .map((c) => ({
            id: c.toolUse!.toolUseId!,
            type: 'function',
            function: {
              name: c.toolUse!.name!,
              arguments: JSON.stringify(c.toolUse!.input),
            },
          })),
      } as Message;
    }

    return { role: MessageRole.ASSISTANT, content: 'Empty response from Bedrock.' } as Message;
  }

  async getCapabilities(model?: string) {
    const activeModelId = model || this.modelId;
    const isClaude46 = activeModelId.includes('claude-sonnet-4-6');
    return {
      supportedReasoningProfiles: isClaude46
        ? [
            ReasoningProfile.FAST,
            ReasoningProfile.STANDARD,
            ReasoningProfile.THINKING,
            ReasoningProfile.DEEP,
          ]
        : [ReasoningProfile.FAST, ReasoningProfile.STANDARD],
    };
  }
}
